// WAP 2.0 手机版：纯服务端渲染，零 JS 可用，数字快捷键导航
import express from 'express';
import * as portal from '../services/portal.js';
import * as notes from '../services/notes.js';
import * as forum from '../services/forum.js';
import { postChatMessage, recentChat } from '../services/chat.js';
import { createSession, destroySession } from '../services/auth.js';
import { createUser } from '../services/bootstrap.js';
import { hashPassword, verifyPassword, normalizeAnswer } from '../lib/password.js';
import { renderPages, render as ubbRender } from '../lib/ubb.js';
import { paginate } from '../lib/pager.js';
import { levelInfo } from '../lib/levels.js';
import { now, clock, fileSize, yuan } from '../lib/format.js';
import { httpError, intParam, USERNAME_RE, RESERVED_NAMES } from '../lib/http.js';

const KB_MARK = '%%WAP_PAGE_KB%%';
const PER_PAGE = 10;
const CHARS_PER_PAGE = 350;

// 页脚显示本页真实字节数：先用等长占位测量，再替换
export function applyPageSize(html) {
  if (!html.includes(KB_MARK)) return html;
  const probe = html.split(KB_MARK).join('00.0KB');
  const kb = `${(Buffer.byteLength(probe) / 1024).toFixed(1)}KB`;
  return html.split(KB_MARK).join(kb);
}

// WAP 内部跳转地址只允许 /wap 开头
function wapNext(v, fallback = '/wap') {
  const s = String(v || '');
  return /^\/wap(?:[/?#]|$)/.test(s) && !s.startsWith('//') ? s : fallback;
}

export default function wapRoutes(ctx) {
  const r = express.Router();
  const { db, settings, captcha, limiter } = ctx;

  r.use((req, res, next) => {
    res.locals.wapOnline = ctx.online.count();
    res.locals.backUrl = '/wap';
    const ref = req.get('referer');
    if (ref) {
      try {
        const u = new URL(ref);
        if (u.host === req.get('host') && u.pathname.startsWith('/wap')) res.locals.backUrl = u.pathname + u.search;
      } catch { /* 忽略非法 Referer */ }
    }
    const render = res.render.bind(res);
    res.render = (view, options, cb) => {
      if (typeof options === 'function') { cb = options; options = {}; }
      render(view, options || {}, (err, html) => {
        if (cb) return cb(err, err ? undefined : applyPageSize(html));
        if (err) {
          console.error(err);
          return res.status(500).type('text/plain').send('页面渲染出错');
        }
        res.type('html').send(applyPageSize(html));
      });
    };
    next();
  });

  const msg = (res, opts) => res.message({ wap: true, ...opts });
  const needLogin = (req, res, next) => {
    if (req.user) return next();
    const back = req.method === 'GET' ? req.originalUrl : wapNext(req.body?.back, '/wap');
    res.redirect(303, `/wap/login?next=${encodeURIComponent(back)}`);
  };

  // 上传图片大小缓存（按 /uploads/ 路径）
  const sizeStmt = db.prepare('SELECT size FROM uploads WHERE path = ?');
  const sizeOf = (url) => {
    const m = /^\/uploads\/(.+)$/.exec(String(url).replace(/&amp;/g, '&'));
    if (!m) return '';
    const row = sizeStmt.get(m[1]);
    return row ? fileSize(row.size) : '';
  };

  // UBB 渲染结果的手机适配：图注后加图片大小，站内链接改到 WAP
  const FIG_RE = /<figure class="(ubb-fig[^"]*)"><a href="([^"]+)"([^>]*)>(<img[^>]*>)<\/a>(?:<figcaption>([\s\S]*?)<\/figcaption>)?<\/figure>/g;
  function decorate(html) {
    return html
      .replace(FIG_RE, (m, cls, href, attrs, img, cap) => {
        const size = sizeOf(href);
        const text = [cap || '', size ? `(${size})` : ''].filter(Boolean).join(' ');
        return `<figure class="${cls}"><a href="${href}"${attrs}>${img}</a>${text ? `<figcaption>${text}</figcaption>` : ''}</figure>`;
      })
      .replace(/href="\/notes\/(\d+)[^"]*"/g, 'href="/wap/note/$1"')
      .replace(/href="\/forum\/thread\/(\d+)[^"]*"/g, 'href="/wap/forum/thread/$1"')
      .replace(/ target="_blank"/g, '');
  }

  const newCutoff = () => now() - (settings.int('new_badge_hours') || 24) * 3600;

  // ---------- 首页 ----------
  r.get('/', (req, res) => {
    const featured = portal.featuredNotes(ctx, 1)[0] || null;
    const hot = portal.rankNotes(ctx, { limit: 4 }).filter((n) => !featured || n.id !== featured.id).slice(0, 3);
    const channels = portal.channels(ctx).slice(0, 4).map((c) => ({ ...c, short: [...c.name].slice(0, 2).join('') }));
    const hasNew = !!db.prepare("SELECT 1 FROM notes WHERE status = 'published' AND created_at >= ? LIMIT 1").get(newCutoff());
    res.render('wap/index.njk', { featured, hot, channels, hasNew, backUrl: '/wap' });
  });

  // ---------- 笔记 ----------
  r.get('/channels', (req, res) => {
    res.render('wap/channels.njk', { title: '频道', channels: portal.channels(ctx), backUrl: '/wap' });
  });

  r.get('/notes', (req, res) => {
    const channel = req.query.channel ? portal.channelBySlug(ctx, String(req.query.channel)) : null;
    if (req.query.channel && !channel) throw httpError(404, '频道不存在');
    const total = channel
      ? db.prepare("SELECT COUNT(*) AS n FROM notes WHERE status = 'published' AND channel_id = ?").get(channel.id).n
      : db.prepare("SELECT COUNT(*) AS n FROM notes WHERE status = 'published'").get().n;
    const pager = paginate({ total, page: req.query.page, perPage: PER_PAGE, baseUrl: channel ? `/wap/notes?channel=${channel.slug}` : '/wap/notes' });
    const list = portal.latestNotes(ctx, { limit: PER_PAGE, offset: pager.offset, channelId: channel?.id });
    res.render('wap/notes.njk', {
      title: channel ? channel.name : '最新笔记', channel, list, pager,
      backUrl: channel ? '/wap/channels' : '/wap', footInfo: `第 ${pager.current}/${pager.pages} 页`,
    });
  });

  const loadNote = (req) => {
    const id = intParam(req.params.id);
    const note = id ? notes.getNote(ctx, id) : null;
    if (!note || note.status !== 'published') throw httpError(404, '笔记不存在或已被删除');
    return note;
  };
  const noteBack = (req, id) => wapNext(req.body?.back, `/wap/note/${id}`);

  r.get('/note/:id', (req, res) => {
    const note = loadNote(req);
    if (ctx.countHit?.('notes', note.id, req.vid)) note.hits += 1;
    const author = db.prepare('SELECT id, username FROM users WHERE id = ?').get(note.user_id);
    const pages = renderPages(note.content, CHARS_PER_PAGE);
    const total = pages.length;
    const all = req.query.all === '1';
    const p = Math.min(Math.max(1, intParam(req.query.p, 1)), total);
    const html = decorate(all ? pages.join('') : pages[p - 1]);
    const prev = db.prepare("SELECT id, title FROM notes WHERE channel_id = ? AND status = 'published' AND id < ? ORDER BY id DESC LIMIT 1").get(note.channel_id, note.id);
    const next = db.prepare("SELECT id, title FROM notes WHERE channel_id = ? AND status = 'published' AND id > ? ORDER BY id ASC LIMIT 1").get(note.channel_id, note.id);
    const favorited = req.user ? !!db.prepare('SELECT 1 FROM favorites WHERE user_id = ? AND note_id = ?').get(req.user.id, note.id) : false;
    res.render('wap/note.njk', {
      title: note.title, note, author, html, p, total, all, prev, next, favorited,
      self: all ? `/wap/note/${note.id}?all=1` : `/wap/note/${note.id}${p > 1 ? `?p=${p}` : ''}`,
      backUrl: `/wap/notes?channel=${note.channel_slug}`,
      footInfo: all ? '全文' : `第 ${p}/${total} 页`,
    });
  });

  r.post('/note/:id/like', (req, res) => {
    const note = loadNote(req);
    const back = noteBack(req, note.id);
    if (!limiter.check(`like:${req.ip}`, 60, 60_000)) return msg(res, { title: '操作太快', text: '操作太快了，歇一会儿再来', ok: false, status: 429 });
    const voter = req.user ? `u:${req.user.id}` : `v:${req.vid}`;
    const info = db.prepare('INSERT OR IGNORE INTO note_likes (note_id, voter) VALUES (?, ?)').run(note.id, voter);
    if (!info.changes) return msg(res, { title: '提示', text: '您已经顶过这篇笔记了', ok: false, back: true, backUrl: back });
    db.prepare('UPDATE notes SET likes = likes + 1 WHERE id = ?').run(note.id);
    res.redirect(303, back);
  });

  r.post('/note/:id/favorite', needLogin, (req, res) => {
    const note = loadNote(req);
    notes.toggleFavorite(ctx, req.user.id, note.id);
    res.redirect(303, noteBack(req, note.id));
  });

  r.get('/note/:id/comments', (req, res) => {
    const note = loadNote(req);
    const total = db.prepare("SELECT COUNT(*) AS n FROM comments WHERE note_id = ? AND status = 'approved'").get(note.id).n;
    const pager = paginate({ total, page: req.query.page, perPage: PER_PAGE, baseUrl: `/wap/note/${note.id}/comments` });
    const comments = db.prepare(`
      SELECT c.id, c.floor, c.content, c.created_at, c.user_id, c.guest_name, u.username
      FROM comments c LEFT JOIN users u ON u.id = c.user_id
      WHERE c.note_id = ? AND c.status = 'approved' ORDER BY c.floor LIMIT ? OFFSET ?`).all(note.id, PER_PAGE, pager.offset);
    comments.forEach((c) => { c.html = decorate(ubbRender(c.content, 'comment')); });
    res.render('wap/comments.njk', {
      title: `回复：${note.title}`, note, comments, pager,
      review: req.user ? settings.bool('comment_review_member') : settings.bool('comment_review_guest'),
      allowGuest: settings.bool('allow_guest_comment'),
      backUrl: `/wap/note/${note.id}`, footInfo: `回复 ${total} 条`,
    });
  });

  r.post('/note/:id/comments', (req, res) => {
    const note = loadNote(req);
    const back = `/wap/note/${note.id}/comments`;
    const fail = (text, status = 400) => msg(res, { title: '回复失败', text, ok: false, status, back: true, backUrl: back });
    const key = req.user ? `comment:u${req.user.id}` : `comment:${req.ip}`;
    if (!limiter.check(key, req.user ? 10 : 5, 5 * 60_000)) return fail('回复太频繁了，请稍后再试', 429);
    let guestName = '';
    if (!req.user) {
      if (!settings.bool('allow_guest_comment')) return fail('本站暂不允许游客留言，请先登录');
      if (!captcha.verify(req.vid, 'wap', req.body.captcha)) return fail('验证码错误');
      guestName = String(req.body.nickname || '').trim();
      if ([...guestName].length < 2 || [...guestName].length > 16) return fail('游客请填写 2-16 个字的昵称');
      if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(guestName)) return fail('该昵称已被注册会员使用，请换一个或先登录');
    }
    try {
      const c = notes.addComment(ctx, { note, user: req.user, guestName, content: req.body.content, ip: req.ip });
      if (c.status === 'pending') return msg(res, { title: '回复已提交', text: '回复提交成功，审核通过后显示。', redirect: back });
      const n = db.prepare("SELECT COUNT(*) AS n FROM comments WHERE note_id = ? AND status = 'approved' AND floor <= ?").get(note.id, c.floor).n;
      const page = Math.ceil(n / PER_PAGE);
      res.redirect(303, `${back}${page > 1 ? `?page=${page}` : ''}#floor-${c.floor}`);
    } catch (e) {
      if (!(e instanceof notes.ValidationError)) throw e;
      fail(e.message);
    }
  });

  // ---------- 登录 / 注册 / 退出 ----------
  r.get('/login', (req, res) => {
    const next = wapNext(req.query.next, '/wap/my');
    if (req.user) return res.redirect(next);
    res.render('wap/login.njk', { title: '登录', next, needCaptcha: settings.bool('captcha_login'), backUrl: '/wap' });
  });

  r.post('/login', (req, res) => {
    const username = String(req.body.username || '').trim();
    const next = wapNext(req.body.next, '/wap');
    const fail = (error, status = 400) => res.status(status).render('wap/login.njk', {
      title: '登录', next, username, error, needCaptcha: settings.bool('captcha_login'), backUrl: '/wap',
    });
    if (!limiter.check(`login-ip:${req.ip}`, 20, 15 * 60_000) || !limiter.check(`login-user:${username.toLowerCase()}`, 8, 15 * 60_000)) {
      return fail('登录尝试次数过多，请 15 分钟后再试', 429);
    }
    if (settings.bool('captcha_login') && !captcha.verify(req.vid, 'wap', req.body.captcha)) return fail('验证码错误');
    const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!u || !verifyPassword(String(req.body.password || ''), u.password_hash)) return fail('用户名或密码错误');
    if (u.banned) return fail('该账号已被封禁');
    createSession(ctx, req, res, u.id, req.body.remember === '1');
    limiter.reset(`login-user:${username.toLowerCase()}`);
    msg(res, { title: '登录成功', text: `欢迎回来，${u.username}！`, redirect: next });
  });

  r.get('/logout', (req, res) => {
    res.render('wap/logout.njk', { title: '退出', backUrl: '/wap' });
  });

  r.post('/logout', (req, res) => {
    destroySession(ctx, req, res);
    msg(res, { title: '已退出', text: '您已安全退出，欢迎下次再来！', redirect: '/wap' });
  });

  r.get('/register', (req, res) => {
    if (req.user) return res.redirect('/wap/my');
    if (!settings.bool('register_open')) return msg(res, { title: '暂停注册', text: '本站暂时关闭了新会员注册。', ok: false });
    res.render('wap/register.njk', { title: '注册', form: {}, backUrl: '/wap' });
  });

  r.post('/register', (req, res) => {
    if (!settings.bool('register_open')) return msg(res, { title: '暂停注册', text: '本站暂时关闭了新会员注册。', ok: false, status: 403 });
    const form = {
      username: String(req.body.username || '').trim(),
      question: String(req.body.question || '').trim().slice(0, 50),
    };
    const { password = '', password2 = '', answer = '' } = req.body;
    const fail = (error, status = 400) => res.status(status).render('wap/register.njk', { title: '注册', form, error, backUrl: '/wap' });
    if (!limiter.check(`register:${req.ip}`, 5, 3600_000)) return fail('注册太频繁了，请一小时后再试', 429);
    if (!captcha.verify(req.vid, 'wap', req.body.captcha)) return fail('验证码错误');
    if (!USERNAME_RE.test(form.username)) return fail('用户名需为 2-16 位中文、字母、数字或下划线');
    if (RESERVED_NAMES.some((n) => n.toLowerCase() === form.username.toLowerCase())) return fail('该用户名为系统保留');
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(form.username)) return fail('该用户名已被注册');
    if (password.length < 6 || password.length > 32) return fail('密码长度需为 6-32 位');
    if (password !== password2) return fail('两次输入的密码不一致');
    if (!form.question || !normalizeAnswer(answer)) return fail('请设置密码提示问题和答案');
    const id = createUser(ctx, { username: form.username, password, question: form.question, answerHash: hashPassword(normalizeAnswer(answer)) });
    createSession(ctx, req, res, id, false);
    msg(res, { title: '注册成功', text: `欢迎加入${settings.get('site_name')}！`, redirect: '/wap/my' });
  });

  // ---------- 论坛 ----------
  r.get('/forum', (req, res) => {
    res.render('wap/forum.njk', { title: '论坛', groups: forum.listBoardsGrouped(ctx), backUrl: '/wap' });
  });

  const loadBoard = (req) => {
    const board = forum.getBoard(ctx, intParam(req.params.id));
    if (!board) throw httpError(404, '版块不存在');
    return board;
  };

  r.get('/forum/board/:id', (req, res) => {
    const board = loadBoard(req);
    const total = db.prepare("SELECT COUNT(*) AS n FROM forum_threads WHERE board_id = ? AND status = 'published'").get(board.id).n;
    const pager = paginate({ total, page: req.query.page, perPage: PER_PAGE, baseUrl: `/wap/forum/board/${board.id}` });
    const threads = db.prepare(`
      SELECT t.id, t.title, t.sticky, t.digest, t.locked, t.is_poll, t.reply_count, t.last_post_at, u.username
      FROM forum_threads t JOIN users u ON u.id = t.user_id
      WHERE t.board_id = ? AND t.status = 'published'
      ORDER BY t.sticky DESC, t.last_post_at DESC, t.id DESC LIMIT ? OFFSET ?`).all(board.id, PER_PAGE, pager.offset);
    res.render('wap/board.njk', { title: board.name, board, threads, pager, backUrl: '/wap/forum', footInfo: `第 ${pager.current}/${pager.pages} 页` });
  });

  r.get('/forum/board/:id/new', needLogin, (req, res) => {
    const board = loadBoard(req);
    res.render('wap/thread-new.njk', { title: '发新帖', board, form: {}, backUrl: `/wap/forum/board/${board.id}` });
  });

  r.post('/forum/board/:id/new', needLogin, (req, res) => {
    const board = loadBoard(req);
    if (!limiter.check(`thread:${req.user.id}`, 5, 10 * 60_000)) return msg(res, { title: '发帖失败', text: '发帖太频繁了', ok: false, status: 429 });
    try {
      const tid = forum.createThread(ctx, { boardId: board.id, user: req.user, title: req.body.title, content: req.body.content });
      res.redirect(303, `/wap/forum/thread/${tid}`);
    } catch (e) {
      if (!(e instanceof forum.ValidationError)) throw e;
      res.status(400).render('wap/thread-new.njk', { title: '发新帖', board, form: req.body, error: e.message, backUrl: `/wap/forum/board/${board.id}` });
    }
  });

  const loadThread = (req) => {
    const thread = forum.getThread(ctx, intParam(req.params.id));
    if (!thread || thread.status !== 'published') throw httpError(404, '主题不存在或已被删除');
    return thread;
  };

  r.get('/forum/thread/:id', (req, res) => {
    const thread = loadThread(req);
    if (ctx.countHit?.('forum_threads', thread.id, req.vid)) thread.hits += 1;
    const total = db.prepare("SELECT COUNT(*) AS n FROM forum_posts WHERE thread_id = ? AND status = 'published'").get(thread.id).n;
    const pager = paginate({ total, page: req.query.p, perPage: PER_PAGE, baseUrl: `/wap/forum/thread/${thread.id}`, param: 'p' });
    const posts = db.prepare(`
      SELECT p.id, p.floor, p.content, p.created_at, p.user_id, u.username
      FROM forum_posts p JOIN users u ON u.id = p.user_id
      WHERE p.thread_id = ? AND p.status = 'published' ORDER BY p.floor LIMIT ? OFFSET ?`).all(thread.id, PER_PAGE, pager.offset);
    posts.forEach((p) => { p.html = decorate(ubbRender(p.content, 'post')); });
    const poll = thread.is_poll ? forum.pollOf(ctx, thread.id, req.user?.id) : null;
    res.render('wap/thread.njk', {
      title: thread.title, thread, posts, pager, poll,
      canReply: !thread.locked || ['admin', 'moderator'].includes(req.user?.role),
      backUrl: `/wap/forum/board/${thread.board_id}`, footInfo: `第 ${pager.current}/${pager.pages} 页`,
    });
  });

  r.post('/forum/thread/:id/reply', needLogin, (req, res) => {
    const thread = loadThread(req);
    const back = `/wap/forum/thread/${thread.id}`;
    if (!limiter.check(`reply:${req.user.id}`, 10, 5 * 60_000)) return msg(res, { title: '回帖失败', text: '回帖太频繁了，请稍后再试', ok: false, status: 429 });
    try {
      const { floor } = forum.createReply(ctx, { thread, user: req.user, content: req.body.content });
      const n = db.prepare("SELECT COUNT(*) AS n FROM forum_posts WHERE thread_id = ? AND status = 'published' AND floor <= ?").get(thread.id, floor).n;
      const page = Math.ceil(n / PER_PAGE);
      res.redirect(303, `${back}${page > 1 ? `?p=${page}` : ''}#floor-${floor}`);
    } catch (e) {
      if (!(e instanceof forum.ValidationError)) throw e;
      msg(res, { title: '回帖失败', text: e.message, ok: false, status: 400, back: true, backUrl: back });
    }
  });

  // ---------- 聊天室（刷新式） ----------
  r.get('/chat', (req, res) => {
    const rooms = db.prepare('SELECT * FROM chat_rooms ORDER BY sort, id').all()
      .map((room) => ({ ...room, online: ctx.chat.count(room.id) }));
    res.render('wap/chat-rooms.njk', { title: '聊天室', rooms, backUrl: '/wap' });
  });

  const loadRoom = (req) => {
    const room = db.prepare('SELECT * FROM chat_rooms WHERE slug = ?').get(String(req.params.slug));
    if (!room) throw httpError(404, '聊天室不存在');
    return room;
  };

  r.get('/chat/:slug', (req, res) => {
    const room = loadRoom(req);
    const messages = recentChat(ctx, room.id, 15).reverse().map((m) => ({ ...m, time: clock(m.created_at) }));
    res.render('wap/chat.njk', { title: room.name, room, messages, backUrl: '/wap/chat', footInfo: `${room.name} · ${clock()}` });
  });

  r.post('/chat/:slug', needLogin, (req, res) => {
    const room = loadRoom(req);
    const back = `/wap/chat/${room.slug}`;
    if (!limiter.check(`chat:u${req.user.id}`, 1, 1500) || !limiter.check(`chat-minute:${req.user.id}`, 20, 60_000)) {
      return msg(res, { title: '发言太快', text: '说话太快了，歇口气再说吧（每 1.5 秒一句）', ok: false, status: 429, back: true, backUrl: back });
    }
    try {
      postChatMessage(ctx, { room, user: req.user, content: req.body.content, color: req.body.color, toName: req.body.to });
      res.redirect(303, back);
    } catch (e) {
      if (!e.status || e.status >= 500) throw e;
      msg(res, { title: '发言失败', text: e.message, ok: false, status: e.status, back: true, backUrl: back });
    }
  });

  // ---------- 相册 ----------
  r.get('/album', (req, res) => {
    const total = db.prepare('SELECT COUNT(*) AS n FROM photos').get().n;
    const pager = paginate({ total, page: req.query.page, perPage: PER_PAGE, baseUrl: '/wap/album' });
    const photos = db.prepare(`
      SELECT p.id, p.path, p.size, p.caption, p.hits, p.created_at, a.id AS album_id, a.title AS album_title, u.username
      FROM photos p JOIN albums a ON a.id = p.album_id JOIN users u ON u.id = p.user_id
      ORDER BY p.created_at DESC, p.id DESC LIMIT ? OFFSET ?`).all(PER_PAGE, pager.offset);
    res.render('wap/album.njk', { title: '相册', photos, pager, backUrl: '/wap', footInfo: `第 ${pager.current}/${pager.pages} 页` });
  });

  r.get('/album/a/:id', (req, res) => {
    const album = db.prepare('SELECT a.*, u.username FROM albums a JOIN users u ON u.id = a.user_id WHERE a.id = ?').get(intParam(req.params.id));
    if (!album) throw httpError(404, '相册不存在');
    const photos = db.prepare('SELECT id, path, size, caption FROM photos WHERE album_id = ? ORDER BY id').all(album.id);
    res.render('wap/album-view.njk', { title: album.title, album, photos, backUrl: '/wap/album' });
  });

  r.get('/album/photo/:id', (req, res) => {
    const photo = db.prepare(`
      SELECT p.*, a.title AS album_title, u.username FROM photos p
      JOIN albums a ON a.id = p.album_id JOIN users u ON u.id = p.user_id WHERE p.id = ?`).get(intParam(req.params.id));
    if (!photo) throw httpError(404, '照片不存在');
    if (ctx.countHit?.('photos', photo.id, req.vid)) photo.hits += 1;
    const prev = db.prepare('SELECT id FROM photos WHERE album_id = ? AND id < ? ORDER BY id DESC LIMIT 1').get(photo.album_id, photo.id);
    const next = db.prepare('SELECT id FROM photos WHERE album_id = ? AND id > ? ORDER BY id ASC LIMIT 1').get(photo.album_id, photo.id);
    res.render('wap/photo.njk', { title: photo.caption || '照片', photo, prev, next, backUrl: `/wap/album/a/${photo.album_id}` });
  });

  // ---------- 好物 ----------
  r.get('/shop', (req, res) => {
    const total = db.prepare("SELECT COUNT(*) AS n FROM products WHERE status = 'on'").get().n;
    const pager = paginate({ total, page: req.query.page, perPage: PER_PAGE, baseUrl: '/wap/shop' });
    const products = db.prepare(`SELECT id, name, price_cents, image, sales FROM products WHERE status = 'on'
      ORDER BY featured DESC, sort, id LIMIT ? OFFSET ?`).all(PER_PAGE, pager.offset);
    products.forEach((p) => { p.price = yuan(p.price_cents); });
    res.render('wap/shop.njk', { title: '好物推荐', products, pager, backUrl: '/wap' });
  });

  r.get('/shop/:id', (req, res) => {
    const product = db.prepare("SELECT * FROM products WHERE id = ? AND status = 'on'").get(intParam(req.params.id));
    if (!product) throw httpError(404, '商品不存在或已下架');
    product.price = yuan(product.price_cents);
    product.market = product.market_price_cents ? yuan(product.market_price_cents) : '';
    res.render('wap/product.njk', { title: product.name, product, html: decorate(ubbRender(product.description, 'post')), backUrl: '/wap/shop' });
  });

  // ---------- 我的小红书 / 短消息 ----------
  const myNotes = (userId, limit, offset = 0) => db.prepare(`SELECT id, title, created_at, hits, comment_count FROM notes
    WHERE user_id = ? AND status = 'published' ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(userId, limit, offset);
  const myFavs = (userId, limit, offset = 0) => db.prepare(`SELECT n.id, n.title, f.created_at FROM favorites f
    JOIN notes n ON n.id = f.note_id WHERE f.user_id = ? AND n.status = 'published' ORDER BY f.created_at DESC LIMIT ? OFFSET ?`).all(userId, limit, offset);

  r.get('/my', needLogin, (req, res) => {
    const favTotal = db.prepare("SELECT COUNT(*) AS n FROM favorites f JOIN notes n ON n.id = f.note_id WHERE f.user_id = ? AND n.status = 'published'").get(req.user.id).n;
    res.render('wap/my.njk', {
      title: `我的${settings.get('site_name')}`, level: levelInfo(req.user),
      notes: myNotes(req.user.id, 5), favorites: myFavs(req.user.id, 5), favTotal, backUrl: '/wap',
    });
  });

  r.get('/my/notes', needLogin, (req, res) => {
    const total = db.prepare("SELECT COUNT(*) AS n FROM notes WHERE user_id = ? AND status = 'published'").get(req.user.id).n;
    const pager = paginate({ total, page: req.query.page, perPage: PER_PAGE, baseUrl: '/wap/my/notes' });
    res.render('wap/my-list.njk', { title: '我的笔记', items: myNotes(req.user.id, PER_PAGE, pager.offset), pager, backUrl: '/wap/my' });
  });

  r.get('/my/favorites', needLogin, (req, res) => {
    const total = db.prepare("SELECT COUNT(*) AS n FROM favorites f JOIN notes n ON n.id = f.note_id WHERE f.user_id = ? AND n.status = 'published'").get(req.user.id).n;
    const pager = paginate({ total, page: req.query.page, perPage: PER_PAGE, baseUrl: '/wap/my/favorites' });
    res.render('wap/my-list.njk', { title: '我的收藏', items: myFavs(req.user.id, PER_PAGE, pager.offset), pager, backUrl: '/wap/my' });
  });

  r.get('/pm', needLogin, (req, res) => {
    const total = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE to_id = ? AND receiver_deleted = 0').get(req.user.id).n;
    const pager = paginate({ total, page: req.query.page, perPage: PER_PAGE, baseUrl: '/wap/pm' });
    const list = db.prepare(`
      SELECT m.id, m.title, m.read_at, m.created_at, m.from_id, u.username AS from_name
      FROM messages m LEFT JOIN users u ON u.id = m.from_id
      WHERE m.to_id = ? AND m.receiver_deleted = 0 ORDER BY m.created_at DESC, m.id DESC LIMIT ? OFFSET ?`).all(req.user.id, PER_PAGE, pager.offset);
    res.render('wap/pm.njk', { title: '短消息', list, pager, backUrl: '/wap/my' });
  });

  r.get('/pm/:id', needLogin, (req, res) => {
    const m = db.prepare(`
      SELECT m.*, u.username AS from_name FROM messages m LEFT JOIN users u ON u.id = m.from_id
      WHERE m.id = ? AND m.to_id = ? AND m.receiver_deleted = 0`).get(intParam(req.params.id), req.user.id);
    if (!m) throw httpError(404, '短消息不存在');
    if (!m.read_at) {
      db.prepare('UPDATE messages SET read_at = ? WHERE id = ?').run(now(), m.id);
      res.locals.unread = Math.max(0, (res.locals.unread || 0) - 1);
    }
    res.render('wap/pm-view.njk', { title: m.title, m, html: decorate(ubbRender(m.body, 'comment')), backUrl: '/wap/pm' });
  });

  return r;
}
