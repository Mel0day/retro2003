import express from 'express';
import { requireRole } from '../../services/auth.js';
import { intParam } from '../../lib/http.js';

const requireAdmin = requireRole('admin');
const SLUG_RE = /^[a-z0-9-]{2,20}$/;

export default function adminChat(ctx) {
  const r = express.Router();
  const { db } = ctx;

  const back = (res, { msg, err } = {}) => res.redirect(303, `/admin/chat?${new URLSearchParams(err ? { err } : { msg })}`);

  function validate(body) {
    const room = {
      slug: String(body.slug || '').trim().toLowerCase(),
      name: String(body.name || '').trim(),
      topic: String(body.topic || '').trim(),
      sort: parseInt(body.sort, 10) || 0,
    };
    if (!SLUG_RE.test(room.slug)) return { error: '房间标识只能是 2-20 位小写字母、数字或短横线' };
    if (!room.name || [...room.name].length > 20) return { error: '房间名称不能为空，且不超过 20 个字' };
    if ([...room.topic].length > 100) return { error: '话题不能超过 100 个字' };
    return { room };
  }

  r.get('/chat', requireAdmin, (req, res) => {
    const rooms = db.prepare(`SELECT r.*, (SELECT COUNT(*) FROM chat_messages m WHERE m.room_id = r.id) AS message_count,
        (SELECT MAX(created_at) FROM chat_messages m WHERE m.room_id = r.id) AS last_at
      FROM chat_rooms r ORDER BY r.sort, r.id`).all();
    rooms.forEach((room) => { room.online = ctx.chat.count(room.id); });
    res.render('admin/chat.njk', { title: '聊天室管理', adminNav: 'chat', rooms });
  });

  r.post('/chat/rooms', requireAdmin, (req, res) => {
    const { room, error } = validate(req.body);
    if (error) return back(res, { err: error });
    if (db.prepare('SELECT 1 FROM chat_rooms WHERE slug = ?').get(room.slug)) return back(res, { err: `房间标识「${room.slug}」已存在` });
    db.prepare('INSERT INTO chat_rooms (slug, name, topic, sort) VALUES (?, ?, ?, ?)').run(room.slug, room.name, room.topic, room.sort);
    back(res, { msg: `已添加聊天室「${room.name}」` });
  });

  r.post('/chat/rooms/:id', requireAdmin, (req, res) => {
    const id = intParam(req.params.id);
    if (!db.prepare('SELECT 1 FROM chat_rooms WHERE id = ?').get(id)) return back(res, { err: '聊天室不存在' });
    const { room, error } = validate(req.body);
    if (error) return back(res, { err: error });
    if (db.prepare('SELECT 1 FROM chat_rooms WHERE slug = ? AND id <> ?').get(room.slug, id)) return back(res, { err: `房间标识「${room.slug}」已被其他房间使用` });
    db.prepare('UPDATE chat_rooms SET slug = ?, name = ?, topic = ?, sort = ? WHERE id = ?').run(room.slug, room.name, room.topic, room.sort, id);
    back(res, { msg: `已保存聊天室「${room.name}」` });
  });

  r.post('/chat/rooms/:id/clear', requireAdmin, (req, res) => {
    const id = intParam(req.params.id);
    const info = db.prepare('DELETE FROM chat_messages WHERE room_id = ?').run(id);
    back(res, { msg: `已清空 ${info.changes} 条聊天记录` });
  });

  r.post('/chat/rooms/:id/delete', requireAdmin, (req, res) => {
    const id = intParam(req.params.id);
    const room = db.prepare('SELECT * FROM chat_rooms WHERE id = ?').get(id);
    if (!room) return back(res, { err: '聊天室不存在' });
    if (db.prepare('SELECT COUNT(*) AS n FROM chat_rooms').get().n <= 1) return back(res, { err: '至少要保留一个聊天室' });
    db.prepare('DELETE FROM chat_rooms WHERE id = ?').run(id);
    back(res, { msg: `已删除聊天室「${room.name}」及其聊天记录` });
  });

  return r;
}
