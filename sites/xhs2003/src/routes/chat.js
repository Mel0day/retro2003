import express from 'express';
import { postChatMessage, postSystemChat, recentChat, CHAT_COLORS, CHAT_ACTIONS } from '../services/chat.js';
import { httpError, intParam } from '../lib/http.js';
import { TZ } from '../lib/format.js';

const COLOR_NAMES = { '#000000': '黑色', '#cc0000': '红色', '#006600': '绿色', '#000099': '蓝色', '#993399': '紫色', '#cc6600': '橙色', '#008080': '青色', '#ff3399': '粉色' };
const LEAVE_DELAY_MS = 5000;

export default function chatRoutes(ctx) {
  const r = express.Router();
  const { db, limiter } = ctx;

  const rooms = () => db.prepare('SELECT * FROM chat_rooms ORDER BY sort, id').all();
  const roomBySlug = (slug) => db.prepare('SELECT * FROM chat_rooms WHERE slug = ?').get(String(slug));
  const loadRoom = (req) => {
    const room = roomBySlug(req.params.slug);
    if (!room) throw httpError(404, '聊天室不存在');
    return room;
  };

  // 刷新页面会断开再连上，离开提示延迟发送，短时间内回来就不提示进出
  const pendingLeave = new Map();

  r.get('/chat', (req, res) => {
    const list = rooms().map((room) => ({
      ...room,
      online: ctx.chat.presence(room.id),
      last: db.prepare("SELECT username, content, created_at FROM chat_messages WHERE room_id = ? AND kind = 'msg' ORDER BY id DESC LIMIT 1").get(room.id),
      today: db.prepare("SELECT COUNT(*) AS n FROM chat_messages WHERE room_id = ? AND kind = 'msg' AND created_at >= unixepoch() - 86400").get(room.id).n,
    }));
    res.render('chat/index.njk', { title: '聊天室', nav: 'chat', crumbs: [['聊天室']], rooms: list });
  });

  r.get('/chat/:slug', (req, res) => {
    const room = loadRoom(req);
    res.render('chat/room.njk', {
      title: `${room.name} - 聊天室`, nav: 'chat', crumbs: [['聊天室', '/chat'], [room.name]],
      room, rooms: rooms(), messages: recentChat(ctx, room.id, 50), presence: ctx.chat.presence(room.id),
      colors: CHAT_COLORS.map((c) => ({ value: c, name: COLOR_NAMES[c] || c })), actions: CHAT_ACTIONS,
      tz: TZ,
    });
  });

  r.get('/api/chat/:slug/stream', (req, res) => {
    const room = loadRoom(req);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();
    res.write('retry: 3000\n\n');
    const user = req.user ? { id: req.user.id, username: req.user.username } : null;
    const client = { res, user };
    const { firstConnection } = ctx.chat.join(room.id, client);
    if (user) {
      const key = `${room.id}:${user.id}`;
      if (pendingLeave.has(key)) {
        clearTimeout(pendingLeave.get(key));
        pendingLeave.delete(key);
      } else if (firstConnection) {
        try { postSystemChat(ctx, room, `欢迎 ${user.username} 进入聊天室`); } catch { /* 忽略 */ }
      }
    }
    // 连接建立后立即推一次在线名单
    res.write(`event: presence\ndata: ${JSON.stringify(ctx.chat.presence(room.id))}\n\n`);

    req.on('close', () => {
      const { lastConnection } = ctx.chat.leave(room.id, client);
      if (!user || !lastConnection) return;
      const key = `${room.id}:${user.id}`;
      const timer = setTimeout(() => {
        pendingLeave.delete(key);
        const still = ctx.chat.presence(room.id).members.some((m) => m.id === user.id);
        if (still) return;
        try { postSystemChat(ctx, room, `${user.username} 离开了聊天室`); } catch { /* 应用已关闭 */ }
      }, LEAVE_DELAY_MS);
      timer.unref();
      pendingLeave.set(key, timer);
    });
  });

  r.post('/api/chat/:slug/send', (req, res) => {
    const room = roomBySlug(req.params.slug);
    if (!room) return res.status(404).json({ ok: false, error: '聊天室不存在' });
    if (!req.user) return res.status(401).json({ ok: false, error: '游客只能旁观，请先登录再发言', login: true });
    if (!limiter.check(`chat:u${req.user.id}`, 1, 1500) || !limiter.check(`chat-minute:${req.user.id}`, 20, 60_000)) {
      return res.status(429).json({ ok: false, error: '说话太快了，歇口气再说吧' });
    }
    try {
      const msg = postChatMessage(ctx, {
        room, user: req.user,
        content: req.body.content, color: req.body.color, toName: req.body.to, action: req.body.action,
      });
      res.json({ ok: true, message: msg });
    } catch (e) {
      if (e.status === 400) return res.status(400).json({ ok: false, error: e.message });
      throw e;
    }
  });

  r.get('/api/chat/:slug/messages', (req, res) => {
    const room = roomBySlug(req.params.slug);
    if (!room) return res.status(404).json({ ok: false, error: '聊天室不存在' });
    const after = intParam(req.query.after);
    const messages = after
      ? db.prepare(`SELECT id, username, user_id, color, to_name, action, content, kind, created_at
          FROM chat_messages WHERE room_id = ? AND id > ? ORDER BY id LIMIT 100`).all(room.id, after)
      : recentChat(ctx, room.id, 50);
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, messages, presence: ctx.chat.presence(room.id) });
  });

  return r;
}
