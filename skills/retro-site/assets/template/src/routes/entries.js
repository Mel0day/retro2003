// 内容：详情、发布、留言、顶一下。把这里换成你的产品的核心动作。
import { Router } from 'express';
import { intParam, httpError } from '../lib/http.js';
import { line } from '../lib/text.js';
import { now } from '../lib/format.js';
import { saveImage } from '../lib/uploads.js';
import { requireLogin } from '../services/auth.js';
import { CHANNELS, getEntry, readEntryForm, insertEntry } from '../services/entries.js';

export default function entryRoutes(ctx) {
  const { db, limiter, config } = ctx;
  const r = Router();

  r.get('/entry/:id', (req, res) => {
    const entry = getEntry(db, intParam(req.params.id));
    const mine = entry && req.user && req.user.id === entry.author_id;
    if (!entry || entry.status === 'deleted') throw httpError(404, '该内容不存在或已被删除。');
    if ((entry.status !== 'public' || entry.author_banned) && !mine && !res.locals.isAdmin) {
      return res.message({ title: '内容已隐藏', text: '这条内容已经不公开了。', ok: false, status: 404 });
    }
    if (!mine) db.prepare('UPDATE entries SET views = views + 1 WHERE id = ?').run(entry.id);
    const comments = db.prepare(`SELECT c.*, u.username FROM comments c JOIN users u ON u.id = c.user_id
      WHERE c.entry_id = ? AND c.hidden = 0 ORDER BY c.id`).all(entry.id);
    res.render('entry.njk', {
      title: entry.title, crumbs: [{ text: entry.channel, url: `/?channel=${encodeURIComponent(entry.channel)}` }, { text: entry.title }],
      nav: entry.channel, entry, comments, mine,
    });
  });

  r.get('/publish', requireLogin, (req, res) => {
    res.render('publish.njk', { title: '我要发布', crumbs: [{ text: '我要发布' }], form: { channel: CHANNELS.includes(req.query.channel) ? req.query.channel : '' }, errors: [] });
  });

  r.post('/publish', requireLogin, (req, res) => {
    const { data, errors } = readEntryForm(req.body);
    if (errors.length) return res.render('publish.njk', { title: '我要发布', crumbs: [{ text: '我要发布' }], form: data, errors });
    if (!limiter.check(`publish:${req.user.id}`, 30, 86400_000)) return res.render('publish.njk', { title: '我要发布', crumbs: [{ text: '我要发布' }], form: data, errors: ['今天发布得太多了，明天再来'] });
    let image = '';
    const file = (req.files || []).find((f) => f.fieldname === 'image');
    if (file) {
      try { image = saveImage(config, file); } catch (e) {
        if (e.status < 500) return res.render('publish.njk', { title: '我要发布', crumbs: [{ text: '我要发布' }], form: data, errors: [e.message] });
        throw e;
      }
    }
    const id = insertEntry(db, { authorId: req.user.id, data, image });
    res.message({ title: '发布成功', text: `「${data.title}」已经发布。`, redirect: `/entry/${id}` });
  });

  r.post('/entry/:id/comment', requireLogin, (req, res) => {
    const entry = getEntry(db, intParam(req.params.id));
    if (!entry || entry.status !== 'public') throw httpError(404, '该内容不存在。');
    const body = line(req.body.body, 300);
    if ([...body].length < 2) return res.message({ title: '留言失败', text: '留言至少 2 个字。', ok: false, status: 400 });
    if (!limiter.check(`comment:${req.user.id}`, 30, 3600_000)) return res.message({ title: '请稍候', text: '留言太频繁了。', ok: false, status: 429 });
    db.prepare('INSERT INTO comments (entry_id, user_id, body) VALUES (?, ?, ?)').run(entry.id, req.user.id, body);
    res.redirect(`/entry/${entry.id}#comments`);
  });

  // 顶一下：每个访客对每条内容只能顶一次（用 cookie 记，2003 年的做法）
  r.post('/entry/:id/like', (req, res) => {
    const entry = getEntry(db, intParam(req.params.id));
    if (!entry || entry.status !== 'public') throw httpError(404, '该内容不存在。');
    const liked = (req.cookies.liked || '').split(',').filter(Boolean);
    if (liked.includes(String(entry.id))) return res.message({ title: '已经顶过了', text: '每人每条只能顶一次哦。', ok: false, status: 400 });
    db.prepare('UPDATE entries SET likes = likes + 1 WHERE id = ?').run(entry.id);
    res.setCookie('liked', [...liked, entry.id].slice(-50).join(','), { maxAge: 30 * 86400 });
    res.redirect(`/entry/${entry.id}`);
  });

  r.post('/entry/:id/delete', requireLogin, (req, res) => {
    const entry = getEntry(db, intParam(req.params.id));
    if (!entry || (entry.author_id !== req.user.id && !res.locals.isAdmin)) throw httpError(404, '该内容不存在。');
    db.prepare("UPDATE entries SET status = 'deleted', updated_at = ? WHERE id = ?").run(now(), entry.id);
    res.message({ title: '已删除', text: '内容已删除。', redirect: '/my' });
  });

  return r;
}
