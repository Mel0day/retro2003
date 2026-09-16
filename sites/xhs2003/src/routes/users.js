import express from 'express';
import { requireLogin } from '../services/auth.js';
import { sendSystemMessage } from '../services/points.js';
import { hashPassword, verifyPassword, normalizeAnswer } from '../lib/password.js';
import { memoryUpload, saveImage, deleteUploadFile } from '../lib/uploads.js';
import { paginate } from '../lib/pager.js';
import { LEVELS, POINT_RULES, levelInfo, levelOf, starsText } from '../lib/levels.js';
import { httpError, intParam } from '../lib/http.js';
import { now } from '../lib/format.js';
import { toggleFavorite } from '../services/notes.js';

export const AVATAR_COLORS = ['#69c', '#c96', '#9c6', '#5a7', '#c69', '#96c', '#c66', '#6ac', '#a85', '#7a9', '#c00', '#036', '#e90', '#58a', '#963', '#a7a'];
const AVATAR_MAX_BYTES = 300 * 1024;
const GENDER_TEXT = { male: '男', female: '女', '': '保密' };

export default function usersRoutes(ctx) {
  const r = express.Router();
  const { db } = ctx;

  const panel = (res, view, data) => res.render(`user/${view}.njk`, data);
  const crumbs = (label) => [['控制面板', '/my'], [label]];

  // ---------- 个人主页 ----------
  r.get('/u/:id', (req, res) => {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(intParam(req.params.id));
    if (!u) throw httpError(404, '该会员不存在');
    delete u.password_hash;
    delete u.answer_hash;
    const tab = ['notes', 'posts', 'albums', 'friends'].includes(req.query.tab) ? req.query.tab : 'notes';
    const isSelf = req.user?.id === u.id;
    const data = {
      title: `${u.username} 的个人主页`,
      crumbs: [['会员', null], [u.username]],
      profile: u, profileLevel: levelInfo(u), tab, isSelf,
      genderText: GENDER_TEXT[u.gender] ?? '保密',
      isFriend: req.user ? !!db.prepare('SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ?').get(req.user.id, u.id) : false,
      counts: {
        albums: db.prepare('SELECT COUNT(*) AS n FROM albums WHERE user_id = ?').get(u.id).n,
        friends: db.prepare('SELECT COUNT(*) AS n FROM friends WHERE user_id = ?').get(u.id).n,
        threads: db.prepare("SELECT COUNT(*) AS n FROM forum_threads WHERE user_id = ? AND status = 'published'").get(u.id).n,
      },
    };
    if (!u.banned) {
      if (tab === 'notes') {
        const total = db.prepare("SELECT COUNT(*) AS n FROM notes WHERE user_id = ? AND status = 'published'").get(u.id).n;
        data.pager = paginate({ total, page: req.query.page, perPage: 20, baseUrl: `/u/${u.id}` });
        data.list = db.prepare(`SELECT n.id, n.title, n.has_image, n.hits, n.comment_count, n.created_at, c.name AS channel_name, c.slug AS channel_slug
          FROM notes n JOIN channels c ON c.id = n.channel_id WHERE n.user_id = ? AND n.status = 'published'
          ORDER BY n.created_at DESC LIMIT ? OFFSET ?`).all(u.id, 20, data.pager.offset);
      } else if (tab === 'posts') {
        data.threads = db.prepare(`SELECT t.id, t.title, t.reply_count, t.hits, t.created_at, t.is_poll, b.id AS board_id, b.name AS board_name
          FROM forum_threads t JOIN forum_boards b ON b.id = t.board_id WHERE t.user_id = ? AND t.status = 'published'
          ORDER BY t.created_at DESC LIMIT 20`).all(u.id);
        data.replies = db.prepare(`SELECT p.id, p.floor, p.content, p.created_at, t.id AS thread_id, t.title
          FROM forum_posts p JOIN forum_threads t ON t.id = p.thread_id
          WHERE p.user_id = ? AND p.floor > 1 AND p.status = 'published' AND t.status = 'published'
          ORDER BY p.created_at DESC LIMIT 20`).all(u.id);
      } else if (tab === 'albums') {
        data.albums = db.prepare('SELECT * FROM albums WHERE user_id = ? ORDER BY updated_at DESC').all(u.id);
      } else {
        data.friends = db.prepare(`SELECT u.id, u.username, u.avatar_color, u.avatar_path, u.points, u.title, u.location
          FROM friends f JOIN users u ON u.id = f.friend_id WHERE f.user_id = ? ORDER BY f.created_at DESC`).all(u.id);
        data.friends.forEach((f) => { f.levelName = levelInfo(f).name; });
      }
    }
    res.render('user/profile.njk', data);
  });

  // ---------- 好友 ----------
  r.post('/api/friends/:id', (req, res) => {
    if (!req.user) return res.status(401).json({ ok: false, error: '加好友需要先登录', login: true });
    const target = db.prepare('SELECT id, username FROM users WHERE id = ?').get(intParam(req.params.id));
    if (!target) return res.status(404).json({ ok: false, error: '该会员不存在' });
    if (target.id === req.user.id) return res.json({ ok: false, error: '不能加自己为好友哦' });
    const has = db.prepare('SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ?').get(req.user.id, target.id);
    if (has) {
      db.prepare('DELETE FROM friends WHERE user_id = ? AND friend_id = ?').run(req.user.id, target.id);
      return res.json({ ok: true, friend: false, label: '[加好友]', message: `已将 ${target.username} 从好友中删除` });
    }
    if (!ctx.limiter.check(`friend:${req.user.id}`, 30, 3600_000)) return res.status(429).json({ ok: false, error: '操作太频繁了' });
    const count = db.prepare('SELECT COUNT(*) AS n FROM friends WHERE user_id = ?').get(req.user.id).n;
    if (count >= 500) return res.json({ ok: false, error: '好友数量已达上限（500 人）' });
    db.prepare('INSERT INTO friends (user_id, friend_id) VALUES (?, ?)').run(req.user.id, target.id);
    const mutual = !!db.prepare('SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ?').get(target.id, req.user.id);
    sendSystemMessage(ctx, target.id, `${req.user.username} 加你为好友`,
      `[url=/u/${req.user.id}]${req.user.username}[/url] 把你加为了好友。${mutual ? '你们已经互为好友啦！' : `[url=/u/${req.user.id}]去看看 TA 的主页[/url]，也加 TA 为好友吧。`}`);
    res.json({ ok: true, friend: true, label: '[已是好友]', message: `已将 ${target.username} 加为好友` });
  });

  // ---------- 控制面板 ----------
  r.get('/my', requireLogin, (req, res) => {
    const u = req.user;
    const lv = levelOf(u.points);
    const next = LEVELS.find((l) => l.min > u.points) || null;
    const progress = next ? Math.round(((u.points - lv.min) / (next.min - lv.min)) * 100) : 100;
    panel(res, 'my_home', {
      title: '控制面板', crumbs: [['控制面板']], panelNav: 'home',
      level: levelInfo(u), nextLevel: next, progress,
      recentNotes: db.prepare(`SELECT id, title, hits, comment_count, created_at, status FROM notes WHERE user_id = ? ORDER BY created_at DESC LIMIT 5`).all(u.id),
      inbox: db.prepare(`SELECT m.id, m.title, m.read_at, m.created_at, m.from_id, u.username AS from_name
        FROM messages m LEFT JOIN users u ON u.id = m.from_id WHERE m.to_id = ? AND m.receiver_deleted = 0
        ORDER BY m.created_at DESC LIMIT 5`).all(u.id),
      stats: {
        favorites: db.prepare('SELECT COUNT(*) AS n FROM favorites WHERE user_id = ?').get(u.id).n,
        friends: db.prepare('SELECT COUNT(*) AS n FROM friends WHERE user_id = ?').get(u.id).n,
        albums: db.prepare('SELECT COUNT(*) AS n FROM albums WHERE user_id = ?').get(u.id).n,
        flowers: db.prepare('SELECT COALESCE(SUM(flowers), 0) AS n FROM notes WHERE user_id = ?').get(u.id).n,
      },
    });
  });

  const profilePage = (req, res, extra = {}, status = 200) => {
    res.status(status);
    panel(res, 'my_profile', {
      title: '修改资料', crumbs: crumbs('修改资料'), panelNav: 'profile',
      form: { location: req.user.location, gender: req.user.gender, signature: req.user.signature, question: req.user.question },
      ...extra,
    });
  };

  r.get('/my/profile', requireLogin, (req, res) => profilePage(req, res));

  r.post('/my/profile', requireLogin, (req, res) => {
    const form = {
      location: String(req.body.location || '').trim(),
      gender: String(req.body.gender || ''),
      signature: String(req.body.signature || '').replace(/\r\n?/g, '\n').trim(),
      question: String(req.body.question || '').trim(),
    };
    const fail = (error) => profilePage(req, res, { form, error }, 400);
    if ([...form.location].length > 30) return fail('「来自」不能超过 30 个字');
    if (!['', 'male', 'female'].includes(form.gender)) return fail('性别选择有误');
    if ([...form.signature].length > 100) return fail('签名不能超过 100 个字');

    const changeQuestion = form.question !== req.user.question || String(req.body.answer || '').trim() !== '';
    if (changeQuestion) {
      if (!form.question || [...form.question].length > 50) return fail('密码提示问题不能为空，且不超过 50 个字');
      if (!normalizeAnswer(req.body.answer)) return fail('修改提示问题时请同时填写新的答案');
      const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
      if (!verifyPassword(String(req.body.current_password || ''), row.password_hash)) return fail('修改密码提示问题需要输入正确的当前密码');
    }
    db.transaction(() => {
      db.prepare('UPDATE users SET location = ?, gender = ?, signature = ? WHERE id = ?').run(form.location, form.gender, form.signature, req.user.id);
      if (changeQuestion) {
        db.prepare('UPDATE users SET question = ?, answer_hash = ? WHERE id = ?').run(form.question, hashPassword(normalizeAnswer(req.body.answer)), req.user.id);
      }
    })();
    res.message({ title: '保存成功', text: '个人资料已更新。', redirect: '/my/profile' });
  });

  r.get('/my/avatar', requireLogin, (req, res) => {
    panel(res, 'my_avatar', {
      title: '修改头像', crumbs: crumbs('修改头像'), panelNav: 'avatar',
      colors: AVATAR_COLORS, maxKb: AVATAR_MAX_BYTES / 1024,
    });
  });

  r.post('/my/avatar', requireLogin, memoryUpload.single('avatar'), (req, res) => {
    if (!req.file) return res.message({ title: '上传失败', text: '请选择要上传的头像图片', ok: false, status: 400 });
    if (!ctx.limiter.check(`avatar:${req.user.id}`, 10, 3600_000)) return res.message({ title: '上传失败', text: '修改太频繁了，请稍后再试', ok: false, status: 429 });
    const saved = saveImage(ctx, { buffer: req.file.buffer, userId: req.user.id, purpose: 'avatar', maxBytes: AVATAR_MAX_BYTES });
    const old = req.user.avatar_path;
    db.prepare('UPDATE users SET avatar_path = ? WHERE id = ?').run(saved.path, req.user.id);
    if (old && !old.startsWith('seed/')) {
      db.prepare('DELETE FROM uploads WHERE path = ?').run(old);
      deleteUploadFile(ctx, old);
    }
    res.message({ title: '头像已更新', text: '新头像上传成功！', redirect: '/my/avatar' });
  });

  r.post('/my/avatar/color', requireLogin, (req, res) => {
    const color = String(req.body.color || '');
    if (!AVATAR_COLORS.includes(color)) return res.message({ title: '修改失败', text: '请从调色板中选择颜色', ok: false, status: 400 });
    const old = req.user.avatar_path;
    db.prepare("UPDATE users SET avatar_color = ?, avatar_path = '' WHERE id = ?").run(color, req.user.id);
    if (old && !old.startsWith('seed/')) {
      db.prepare('DELETE FROM uploads WHERE path = ?').run(old);
      deleteUploadFile(ctx, old);
    }
    res.message({ title: '头像已更新', text: '已换成纯色头像。', redirect: '/my/avatar' });
  });

  r.get('/my/password', requireLogin, (req, res) => {
    panel(res, 'my_password', { title: '修改密码', crumbs: crumbs('修改密码'), panelNav: 'password' });
  });

  r.post('/my/password', requireLogin, (req, res) => {
    const fail = (error, status = 400) => res.status(status) && panel(res, 'my_password', { title: '修改密码', crumbs: crumbs('修改密码'), panelNav: 'password', error });
    if (!ctx.limiter.check(`password:${req.user.id}`, 10, 3600_000)) return fail('尝试次数过多，请一小时后再试', 429);
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    const { old_password: oldPw = '', password = '', password2 = '' } = req.body;
    if (!verifyPassword(String(oldPw), row.password_hash)) return fail('当前密码不正确');
    if (password.length < 6 || password.length > 32) return fail('新密码长度需为 6-32 位');
    if (password !== password2) return fail('两次输入的新密码不一致');
    if (password === oldPw) return fail('新密码不能和当前密码相同');
    db.transaction(() => {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), req.user.id);
      // 注销其他设备上的登录，保留当前会话
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND id <> ?').run(req.user.id, req.user.sid);
    })();
    res.message({ title: '密码已修改', text: '新密码设置成功，其他设备上的登录已失效。', redirect: '/my' });
  });

  r.get('/my/notes', requireLogin, (req, res) => {
    const total = db.prepare('SELECT COUNT(*) AS n FROM notes WHERE user_id = ?').get(req.user.id).n;
    const pager = paginate({ total, page: req.query.page, perPage: 20, baseUrl: '/my/notes' });
    const list = db.prepare(`SELECT n.id, n.title, n.status, n.has_image, n.hits, n.likes, n.flowers, n.comment_count, n.featured, n.created_at,
        c.name AS channel_name, c.slug AS channel_slug
      FROM notes n JOIN channels c ON c.id = n.channel_id WHERE n.user_id = ?
      ORDER BY n.created_at DESC LIMIT ? OFFSET ?`).all(req.user.id, 20, pager.offset);
    panel(res, 'my_notes', { title: '我的笔记', crumbs: crumbs('我的笔记'), panelNav: 'notes', list, pager });
  });

  r.get('/my/favorites', requireLogin, (req, res) => {
    const total = db.prepare(`SELECT COUNT(*) AS n FROM favorites f JOIN notes n ON n.id = f.note_id WHERE f.user_id = ?`).get(req.user.id).n;
    const pager = paginate({ total, page: req.query.page, perPage: 20, baseUrl: '/my/favorites' });
    const list = db.prepare(`SELECT n.id, n.title, n.status, n.has_image, n.hits, n.comment_count, f.created_at AS fav_at,
        u.id AS user_id, u.username, c.name AS channel_name
      FROM favorites f JOIN notes n ON n.id = f.note_id JOIN users u ON u.id = n.user_id JOIN channels c ON c.id = n.channel_id
      WHERE f.user_id = ? ORDER BY f.created_at DESC LIMIT ? OFFSET ?`).all(req.user.id, 20, pager.offset);
    panel(res, 'my_favorites', { title: '我的收藏', crumbs: crumbs('我的收藏'), panelNav: 'favorites', list, pager });
  });

  r.post('/my/favorites/:noteId/delete', requireLogin, (req, res) => {
    const noteId = intParam(req.params.noteId);
    if (db.prepare('SELECT 1 FROM favorites WHERE user_id = ? AND note_id = ?').get(req.user.id, noteId)) {
      toggleFavorite(ctx, req.user.id, noteId);
    }
    res.redirect(303, '/my/favorites');
  });

  r.get('/my/posts', requireLogin, (req, res) => {
    const threads = db.prepare(`SELECT t.id, t.title, t.status, t.reply_count, t.hits, t.is_poll, t.digest, t.sticky, t.created_at, b.id AS board_id, b.name AS board_name
      FROM forum_threads t JOIN forum_boards b ON b.id = t.board_id WHERE t.user_id = ? ORDER BY t.created_at DESC LIMIT 50`).all(req.user.id);
    const total = db.prepare(`SELECT COUNT(*) AS n FROM forum_posts p JOIN forum_threads t ON t.id = p.thread_id WHERE p.user_id = ? AND p.floor > 1`).get(req.user.id).n;
    const pager = paginate({ total, page: req.query.page, perPage: 20, baseUrl: '/my/posts' });
    const replies = db.prepare(`SELECT p.id, p.floor, p.content, p.status, p.created_at, t.id AS thread_id, t.title
      FROM forum_posts p JOIN forum_threads t ON t.id = p.thread_id WHERE p.user_id = ? AND p.floor > 1
      ORDER BY p.created_at DESC LIMIT ? OFFSET ?`).all(req.user.id, 20, pager.offset);
    panel(res, 'my_posts', { title: '我的帖子', crumbs: crumbs('我的帖子'), panelNav: 'posts', threads, replies, pager });
  });

  r.get('/my/friends', requireLogin, (req, res) => {
    const decorate = (rows) => rows.map((f) => ({ ...f, levelName: levelInfo(f).name }));
    const friends = decorate(db.prepare(`SELECT u.id, u.username, u.avatar_color, u.avatar_path, u.points, u.title, u.location, u.last_seen_at, f.created_at AS since,
        EXISTS (SELECT 1 FROM friends x WHERE x.user_id = u.id AND x.friend_id = f.user_id) AS mutual
      FROM friends f JOIN users u ON u.id = f.friend_id WHERE f.user_id = ? ORDER BY f.created_at DESC`).all(req.user.id));
    const fans = decorate(db.prepare(`SELECT u.id, u.username, u.avatar_color, u.avatar_path, u.points, u.title, f.created_at AS since
      FROM friends f JOIN users u ON u.id = f.user_id
      WHERE f.friend_id = ? AND NOT EXISTS (SELECT 1 FROM friends x WHERE x.user_id = f.friend_id AND x.friend_id = f.user_id)
      ORDER BY f.created_at DESC LIMIT 50`).all(req.user.id));
    panel(res, 'my_friends', { title: '我的好友', crumbs: crumbs('我的好友'), panelNav: 'friends', friends, fans, onlineCutoff: now() - 900 });
  });

  r.post('/my/friends/:id/delete', requireLogin, (req, res) => {
    db.prepare('DELETE FROM friends WHERE user_id = ? AND friend_id = ?').run(req.user.id, intParam(req.params.id));
    res.redirect(303, '/my/friends');
  });

  r.get('/my/points', requireLogin, (req, res) => {
    const total = db.prepare('SELECT COUNT(*) AS n FROM points_log WHERE user_id = ?').get(req.user.id).n;
    const pager = paginate({ total, page: req.query.page, perPage: 20, baseUrl: '/my/points' });
    const logs = db.prepare('SELECT * FROM points_log WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?').all(req.user.id, 20, pager.offset);
    const levels = LEVELS.map((l, i) => ({ ...l, starsText: starsText(l.stars), max: LEVELS[i + 1] ? LEVELS[i + 1].min - 1 : null }));
    panel(res, 'my_points', {
      title: '积分记录', crumbs: crumbs('积分记录'), panelNav: 'points',
      logs, pager, levels, rules: Object.values(POINT_RULES), level: levelInfo(req.user),
    });
  });

  return r;
}
