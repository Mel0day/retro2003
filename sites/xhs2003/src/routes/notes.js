import express from 'express';
import * as portal from '../services/portal.js';
import * as notes from '../services/notes.js';
import { requireLogin, isMod } from '../services/auth.js';
import { paginate } from '../lib/pager.js';
import { levelInfo } from '../lib/levels.js';
import { now, dayKey } from '../lib/format.js';
import { awardPoints, sendSystemMessage } from '../services/points.js';
import { httpError, intParam, safeNext } from '../lib/http.js';

const PER_PAGE_LIST = 30;
const PER_PAGE_COMMENTS = 10;

export default function noteRoutes(ctx) {
  const r = express.Router();
  const { db, settings, captcha, limiter } = ctx;

  // 同一访客 30 分钟内重复打开只算一次点击
  const hitSeen = new Map();
  const hitTimer = setInterval(() => {
    const cutoff = Date.now() - 30 * 60_000;
    for (const [k, t] of hitSeen) if (t < cutoff) hitSeen.delete(k);
  }, 5 * 60_000);
  hitTimer.unref();
  const countHit = (table, id, vid) => {
    const key = `${table}:${id}:${vid}`;
    if (hitSeen.has(key)) return false;
    if (hitSeen.size > 200_000) hitSeen.clear();
    hitSeen.set(key, Date.now());
    db.prepare(`UPDATE ${table} SET hits = hits + 1 WHERE id = ?`).run(id);
    return true;
  };
  ctx.countHit = countHit;

  const loadNote = (req) => {
    const note = notes.getNote(ctx, req.params.id);
    if (!note) throw httpError(404, '笔记不存在或已被删除');
    const canManage = req.user && (req.user.id === note.user_id || isMod(req.user));
    if (note.status !== 'published' && !canManage) throw httpError(404, '笔记不存在或已被删除');
    return { note, canManage };
  };

  // ---------- 列表 ----------
  r.get('/notes', (req, res) => {
    const channel = req.query.channel ? portal.channelBySlug(ctx, String(req.query.channel)) : null;
    const sort = ['new', 'hot', 'featured', 'comments'].includes(req.query.sort) ? req.query.sort : 'new';
    const where = ["n.status = 'published'"];
    const args = [];
    if (channel) { where.push('n.channel_id = ?'); args.push(channel.id); }
    if (sort === 'featured') where.push('n.featured = 1');
    const order = { new: 'n.created_at DESC', hot: 'n.hits DESC', featured: 'n.created_at DESC', comments: 'n.comment_count DESC' }[sort];
    const total = db.prepare(`SELECT COUNT(*) AS n FROM notes n WHERE ${where.join(' AND ')}`).get(...args).n;
    const baseUrl = `/notes?${new URLSearchParams({ ...(channel ? { channel: channel.slug } : {}), ...(sort !== 'new' ? { sort } : {}) })}`;
    const pager = paginate({ total, page: req.query.page, perPage: PER_PAGE_LIST, baseUrl });
    const list = db.prepare(`
      SELECT n.id, n.title, n.has_image, n.hits, n.comment_count, n.likes, n.featured, n.created_at,
             u.id AS user_id, u.username, c.name AS channel_name, c.slug AS channel_slug
      FROM notes n JOIN users u ON u.id = n.user_id JOIN channels c ON c.id = n.channel_id
      WHERE ${where.join(' AND ')} ORDER BY ${order}, n.id DESC LIMIT ? OFFSET ?`).all(...args, PER_PAGE_LIST, pager.offset);
    const newCutoff = now() - (settings.int('new_badge_hours') || 24) * 3600;
    list.forEach((n) => { n.isNew = n.created_at >= newCutoff; });
    res.render('notes/list.njk', {
      title: channel ? channel.name : '笔记',
      nav: 'notes',
      crumbs: channel ? [['笔记', '/notes'], [channel.name]] : [['笔记']],
      channel, sort, list, pager,
      channels: portal.channels(ctx),
      tags: portal.hotTags(ctx, 20),
      ranking: portal.rankNotes(ctx, { limit: 10, channelId: channel?.id, sinceDays: 0 }),
      heading: channel ? `${channel.name}` : ({ new: '最新笔记', hot: '最热笔记', featured: '推荐笔记', comments: '热评笔记' }[sort]),
    });
  });

  r.get('/channel/:slug', (req, res) => res.redirect(301, `/notes?channel=${encodeURIComponent(req.params.slug)}`));

  r.get('/tags/:name', (req, res) => {
    const tag = db.prepare('SELECT * FROM tags WHERE name = ?').get(req.params.name);
    if (!tag) throw httpError(404, '标签不存在');
    const total = db.prepare(`SELECT COUNT(*) AS n FROM note_tags nt JOIN notes n ON n.id = nt.note_id WHERE nt.tag_id = ? AND n.status = 'published'`).get(tag.id).n;
    const pager = paginate({ total, page: req.query.page, perPage: PER_PAGE_LIST, baseUrl: `/tags/${encodeURIComponent(tag.name)}` });
    const list = db.prepare(`
      SELECT n.id, n.title, n.has_image, n.hits, n.comment_count, n.likes, n.featured, n.created_at,
             u.id AS user_id, u.username, c.name AS channel_name, c.slug AS channel_slug
      FROM note_tags nt JOIN notes n ON n.id = nt.note_id JOIN users u ON u.id = n.user_id JOIN channels c ON c.id = n.channel_id
      WHERE nt.tag_id = ? AND n.status = 'published' ORDER BY n.created_at DESC LIMIT ? OFFSET ?`).all(tag.id, PER_PAGE_LIST, pager.offset);
    res.render('notes/list.njk', {
      title: `标签：${tag.name}`, nav: 'notes', crumbs: [['笔记', '/notes'], [`标签：${tag.name}`]],
      tag, list, pager, sort: 'new', heading: `标签「${tag.name}」下的笔记`,
      channels: portal.channels(ctx), tags: portal.hotTags(ctx, 20), ranking: portal.rankNotes(ctx, { limit: 10 }),
    });
  });

  // ---------- 发表 / 编辑 ----------
  const formPage = (res, data) => res.render('notes/form.njk', {
    nav: 'notes', channels: portal.channels(ctx), ...data,
  });

  r.get('/notes/new', requireLogin, (req, res) => {
    const ch = req.query.channel ? portal.channelBySlug(ctx, String(req.query.channel)) : null;
    formPage(res, { title: '发表笔记', crumbs: [['笔记', '/notes'], ['发表笔记']], form: { channel_id: ch?.id }, action: '/notes' });
  });

  r.post('/notes', requireLogin, (req, res) => {
    const input = { title: req.body.title, content: req.body.content, channelId: req.body.channel_id, tags: req.body.tags };
    if (!limiter.check(`note:${req.user.id}`, 10, 3600_000)) {
      return formPage(res.status(429), { title: '发表笔记', form: { ...req.body }, action: '/notes', error: '发表太频繁了，休息一会儿再来吧' });
    }
    try {
      const id = notes.createNote(ctx, req.user.id, input);
      res.message({ title: '发表成功', text: '笔记发表成功，积分 +10！', redirect: `/notes/${id}` });
    } catch (e) {
      if (!(e instanceof notes.ValidationError)) throw e;
      formPage(res.status(400), { title: '发表笔记', crumbs: [['笔记', '/notes'], ['发表笔记']], form: { ...req.body }, action: '/notes', error: e.message });
    }
  });

  r.get('/notes/:id/edit', requireLogin, (req, res) => {
    const { note, canManage } = loadNote(req);
    if (!canManage) throw httpError(403, '只能编辑自己的笔记');
    const tags = db.prepare('SELECT t.name FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.note_id = ? ORDER BY nt.sort').all(note.id).map((t) => t.name).join(' ');
    formPage(res, {
      title: '编辑笔记', crumbs: [['笔记', '/notes'], [note.title, `/notes/${note.id}`], ['编辑']],
      form: { ...note, tags }, action: `/notes/${note.id}/edit`, editing: note,
    });
  });

  r.post('/notes/:id/edit', requireLogin, (req, res) => {
    const { note, canManage } = loadNote(req);
    if (!canManage) throw httpError(403, '只能编辑自己的笔记');
    try {
      notes.updateNote(ctx, note, req.user, { title: req.body.title, content: req.body.content, channelId: req.body.channel_id, tags: req.body.tags });
      res.message({ title: '保存成功', text: '笔记已更新。', redirect: `/notes/${note.id}` });
    } catch (e) {
      if (!(e instanceof notes.ValidationError)) throw e;
      formPage(res.status(400), { title: '编辑笔记', form: { ...note, ...req.body }, action: `/notes/${note.id}/edit`, editing: note, error: e.message });
    }
  });

  r.post('/notes/:id/delete', requireLogin, (req, res) => {
    const { note, canManage } = loadNote(req);
    if (!canManage) throw httpError(403, '只能删除自己的笔记');
    notes.deleteNote(ctx, note);
    if (req.user.id !== note.user_id) {
      sendSystemMessage(ctx, note.user_id, '你的笔记被管理员删除', `你的笔记《${note.title}》因违反社区规定已被删除。如有疑问请联系站长。`);
    }
    res.message({ title: '删除成功', text: '笔记已删除。', redirect: `/notes?channel=${note.channel_slug}` });
  });

  // ---------- 详情 ----------
  r.get('/notes/:id', (req, res) => {
    const { note, canManage } = loadNote(req);
    if (note.status === 'published') countHit('notes', note.id, req.vid) && (note.hits += 1);

    const author = db.prepare('SELECT * FROM users WHERE id = ?').get(note.user_id);
    const tags = db.prepare('SELECT t.id, t.name FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.note_id = ? ORDER BY nt.sort').all(note.id);

    const showPendingFor = canManage;
    const commentWhere = showPendingFor ? "c.note_id = ? AND c.status IN ('approved','pending')" : "c.note_id = ? AND c.status = 'approved'";
    const total = db.prepare(`SELECT COUNT(*) AS n FROM comments c WHERE ${commentWhere}`).get(note.id).n;
    const pager = paginate({ total, page: req.query.page, perPage: PER_PAGE_COMMENTS, baseUrl: `/notes/${note.id}` });
    const comments = db.prepare(`
      SELECT c.*, u.username, u.avatar_color, u.avatar_path, u.points, u.title AS user_title, u.signature
      FROM comments c LEFT JOIN users u ON u.id = c.user_id
      WHERE ${commentWhere} ORDER BY c.floor LIMIT ? OFFSET ?`).all(note.id, PER_PAGE_COMMENTS, pager.offset);
    comments.forEach((c) => {
      c.level = c.user_id ? levelInfo({ points: c.points, title: c.user_title }).name : '游客';
      c.displayName = c.user_id ? c.username : c.guest_name;
    });

    const prev = db.prepare(`SELECT id, title FROM notes WHERE channel_id = ? AND status = 'published' AND id < ? ORDER BY id DESC LIMIT 1`).get(note.channel_id, note.id);
    const next = db.prepare(`SELECT id, title FROM notes WHERE channel_id = ? AND status = 'published' AND id > ? ORDER BY id ASC LIMIT 1`).get(note.channel_id, note.id);

    let related = [];
    if (tags.length) {
      related = db.prepare(`
        SELECT n.id, n.title, COUNT(*) AS score FROM note_tags nt JOIN notes n ON n.id = nt.note_id
        WHERE nt.tag_id IN (${tags.map(() => '?').join(',')}) AND n.id <> ? AND n.status = 'published'
        GROUP BY n.id ORDER BY score DESC, n.hits DESC LIMIT 6`).all(...tags.map((t) => t.id), note.id);
    }
    if (related.length < 5) {
      const more = db.prepare(`SELECT id, title FROM notes WHERE channel_id = ? AND id <> ? AND status = 'published' ORDER BY created_at DESC LIMIT 6`).all(note.channel_id, note.id);
      for (const m of more) if (related.length < 6 && !related.some((x) => x.id === m.id)) related.push(m);
    }

    const voter = req.user ? `u:${req.user.id}` : `v:${req.vid}`;
    const state = {
      liked: !!db.prepare('SELECT 1 FROM note_likes WHERE note_id = ? AND voter = ?').get(note.id, voter),
      favorited: req.user ? !!db.prepare('SELECT 1 FROM favorites WHERE user_id = ? AND note_id = ?').get(req.user.id, note.id) : false,
      friend: req.user ? !!db.prepare('SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ?').get(req.user.id, author.id) : false,
    };

    res.render('notes/detail.njk', {
      title: note.title,
      description: note.summary,
      nav: 'notes',
      crumbs: [['笔记', '/notes'], [note.channel_name, `/notes?channel=${note.channel_slug}`], ['正文']],
      note, author, authorLevel: levelInfo(author), tags, comments, pager, prev, next, related, canManage, state,
      channelHot: portal.rankNotes(ctx, { limit: 8, channelId: note.channel_id }),
      pendingNotice: req.query.pending === '1',
    });
  });

  r.get('/notes/:id/print', (req, res) => {
    const { note } = loadNote(req);
    const author = db.prepare('SELECT id, username FROM users WHERE id = ?').get(note.user_id);
    res.render('notes/print.njk', { title: note.title, note, author });
  });

  // ---------- 互动 ----------
  r.post('/api/notes/:id/like', (req, res) => {
    const { note } = loadNote(req);
    if (!limiter.check(`like:${req.ip}`, 60, 60_000)) return res.status(429).json({ ok: false, error: '操作太快了' });
    const voter = req.user ? `u:${req.user.id}` : `v:${req.vid}`;
    const info = db.prepare('INSERT OR IGNORE INTO note_likes (note_id, voter) VALUES (?, ?)').run(note.id, voter);
    if (!info.changes) return res.json({ ok: false, error: '您已经顶过这篇笔记了', count: note.likes });
    db.prepare('UPDATE notes SET likes = likes + 1 WHERE id = ?').run(note.id);
    res.json({ ok: true, count: note.likes + 1, message: '顶成功！感谢您的支持 ^_^' });
  });

  r.post('/api/notes/:id/favorite', (req, res) => {
    if (!req.user) return res.status(401).json({ ok: false, error: '收藏需要先登录', login: true });
    const { note } = loadNote(req);
    const on = notes.toggleFavorite(ctx, req.user.id, note.id);
    const count = db.prepare('SELECT favorites FROM notes WHERE id = ?').get(note.id).favorites;
    res.json({ ok: true, favorited: on, count, label: on ? '已收藏' : '收藏', message: on ? '收藏成功，可以在「控制面板 → 我的收藏」里找到它' : '已取消收藏' });
  });

  r.post('/api/notes/:id/flower', (req, res) => {
    if (!req.user) return res.status(401).json({ ok: false, error: '送花需要先登录', login: true });
    const { note } = loadNote(req);
    if (note.user_id === req.user.id) return res.json({ ok: false, error: '不能给自己的笔记送花哦' });
    const info = db.prepare('INSERT OR IGNORE INTO flowers (note_id, user_id, day) VALUES (?, ?, ?)').run(note.id, req.user.id, dayKey());
    if (!info.changes) return res.json({ ok: false, error: '今天已经给这篇笔记送过花了，明天再来吧' });
    db.prepare('UPDATE notes SET flowers = flowers + 1 WHERE id = ?').run(note.id);
    awardPoints(ctx, note.user_id, 'flowerReceived');
    sendSystemMessage(ctx, note.user_id, `${req.user.username} 给你送了一朵花`, `${req.user.username} 给你的笔记 [url=/notes/${note.id}]《${note.title}》[/url] 送了一朵小红花，积分 +5！`);
    res.json({ ok: true, count: note.flowers + 1, message: '送花成功！作者获得 5 积分' });
  });

  r.post('/notes/:id/comments', (req, res) => {
    const { note } = loadNote(req);
    const back = `/notes/${note.id}`;
    const fail = (text, status = 400) => res.message({ title: '留言失败', text, ok: false, status });
    if (note.status !== 'published') return fail('该笔记暂不能留言');
    const key = req.user ? `comment:u${req.user.id}` : `comment:${req.ip}`;
    if (!limiter.check(key, req.user ? 10 : 5, 5 * 60_000)) return fail('留言太频繁了，请稍后再试', 429);

    let guestName = '';
    if (!req.user) {
      if (!settings.bool('allow_guest_comment')) return fail('本站暂不允许游客留言，请先登录');
      if (!captcha.verify(req.vid, 'comment', req.body.captcha)) return fail('验证码错误，请返回重新输入');
      guestName = String(req.body.nickname || '').trim();
      if ([...guestName].length < 2 || [...guestName].length > 16) return fail('游客请填写 2-16 个字的昵称');
      if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(guestName)) return fail('该昵称已被注册会员使用，请换一个或先登录');
    }
    try {
      const c = notes.addComment(ctx, { note, user: req.user, guestName, content: req.body.content, ip: req.ip });
      if (c.status === 'pending') {
        return res.message({ title: '留言已提交', text: '留言提交成功，审核通过后显示。', redirect: back });
      }
      const page = Math.ceil(db.prepare("SELECT COUNT(*) AS n FROM comments WHERE note_id = ? AND status = 'approved' AND floor <= ?").get(note.id, c.floor).n / PER_PAGE_COMMENTS);
      res.redirect(303, `${back}${page > 1 ? `?page=${page}` : ''}#floor-${c.floor}`);
    } catch (e) {
      if (!(e instanceof notes.ValidationError)) throw e;
      fail(e.message);
    }
  });

  r.post('/api/comments/:id/delete', requireLogin, (req, res) => {
    const c = db.prepare('SELECT c.*, n.user_id AS note_owner FROM comments c JOIN notes n ON n.id = c.note_id WHERE c.id = ?').get(intParam(req.params.id));
    if (!c) return res.status(404).json({ ok: false, error: '留言不存在' });
    if (!(isMod(req.user) || c.user_id === req.user.id)) return res.status(403).json({ ok: false, error: '没有权限删除这条留言' });
    notes.removeComment(ctx, c.id);
    res.json({ ok: true, reload: true });
  });

  r.post('/api/comments/:id/approve', requireLogin, (req, res) => {
    if (!isMod(req.user)) return res.status(403).json({ ok: false, error: '没有权限' });
    notes.approveComment(ctx, intParam(req.params.id));
    res.json({ ok: true, reload: true });
  });

  // ---------- 举报 ----------
  const REPORT_TYPES = {
    note: (id) => db.prepare('SELECT id, title FROM notes WHERE id = ?').get(id),
    comment: (id) => db.prepare("SELECT id, substr(content, 1, 40) AS title, note_id FROM comments WHERE id = ?").get(id),
    thread: (id) => db.prepare('SELECT id, title FROM forum_threads WHERE id = ?').get(id),
    post: (id) => db.prepare("SELECT id, substr(content, 1, 40) AS title FROM forum_posts WHERE id = ?").get(id),
    photo: (id) => db.prepare("SELECT id, caption AS title FROM photos WHERE id = ?").get(id),
    user: (id) => db.prepare('SELECT id, username AS title FROM users WHERE id = ?').get(id),
  };

  r.get('/report', requireLogin, (req, res) => {
    const type = String(req.query.type || '');
    const id = intParam(req.query.id);
    const target = REPORT_TYPES[type]?.(id);
    if (!target) throw httpError(404, '举报对象不存在');
    res.render('notes/report.njk', { title: '举报', crumbs: [['举报']], type, target, back: safeNext(req.query.back, '/') });
  });

  r.post('/report', requireLogin, (req, res) => {
    const type = String(req.body.type || '');
    const id = intParam(req.body.id);
    const target = REPORT_TYPES[type]?.(id);
    if (!target) throw httpError(404, '举报对象不存在');
    const reason = [req.body.category, String(req.body.reason || '').trim()].filter(Boolean).join('：').slice(0, 500);
    if (!reason) return res.message({ title: '举报失败', text: '请选择或填写举报理由', ok: false, status: 400 });
    if (!limiter.check(`report:${req.user.id}`, 10, 3600_000)) return res.message({ title: '举报失败', text: '举报太频繁了', ok: false, status: 429 });
    db.prepare('INSERT INTO reports (target_type, target_id, reporter_id, reason) VALUES (?, ?, ?, ?)').run(type, id, req.user.id, reason);
    res.message({ title: '举报成功', text: '感谢您的举报，管理员会尽快处理。', redirect: safeNext(req.body.back, '/') });
  });

  return r;
}
