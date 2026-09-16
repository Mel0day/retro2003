import express from 'express';
import { paginate } from '../lib/pager.js';
import { levelInfo } from '../lib/levels.js';
import { summarize } from '../lib/ubb.js';
import * as portal from '../services/portal.js';

const PER_PAGE = 20;
const TYPES = { note: '笔记', user: '用户', goods: '商品', thread: '帖子' };

// LIKE 通配符转义，配合 ESCAPE '\'
export const likeEscape = (s) => `%${String(s).replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

export default function searchRoutes(ctx) {
  const r = express.Router();
  const { db, limiter } = ctx;

  r.get('/search', (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 50);
    const type = TYPES[req.query.type] ? req.query.type : 'note';
    const base = { title: q ? `搜索：${q}` : '站内搜索', crumbs: [['站内搜索']], q, searchType: type, types: TYPES, tags: portal.hotTags(ctx, 12) };
    if (!q) return res.render('search/index.njk', { ...base, results: [], pager: null, empty: true });
    if (!limiter.check(`search:${req.ip}`, 60, 60_000)) {
      return res.status(429).render('search/index.njk', { ...base, results: [], pager: null, error: '搜索太频繁了，请稍后再试' });
    }

    const like = likeEscape(q);
    const baseUrl = `/search?${new URLSearchParams({ q, type })}`;
    let total = 0;
    let results = [];
    let pager;

    if (type === 'note') {
      const where = "n.status = 'published' AND (n.title LIKE @like ESCAPE '\\' OR n.content LIKE @like ESCAPE '\\')";
      total = db.prepare(`SELECT COUNT(*) AS n FROM notes n WHERE ${where}`).get({ like }).n;
      pager = paginate({ total, page: req.query.page, perPage: PER_PAGE, baseUrl });
      results = db.prepare(`
        SELECT n.id, n.title, n.summary, n.has_image, n.hits, n.comment_count, n.created_at,
               u.id AS user_id, u.username, c.name AS channel_name, c.slug AS channel_slug
        FROM notes n JOIN users u ON u.id = n.user_id JOIN channels c ON c.id = n.channel_id
        WHERE ${where} ORDER BY (n.title LIKE @like ESCAPE '\\') DESC, n.created_at DESC LIMIT @limit OFFSET @offset`)
        .all({ like, limit: PER_PAGE, offset: pager.offset });
    } else if (type === 'user') {
      const where = "u.username LIKE @like ESCAPE '\\'";
      total = db.prepare(`SELECT COUNT(*) AS n FROM users u WHERE ${where}`).get({ like }).n;
      pager = paginate({ total, page: req.query.page, perPage: PER_PAGE, baseUrl });
      results = db.prepare(`SELECT u.id, u.username, u.avatar_color, u.avatar_path, u.points, u.title, u.note_count, u.post_count,
          u.location, u.created_at, u.banned
        FROM users u WHERE ${where} ORDER BY (u.username = @exact) DESC, u.points DESC LIMIT @limit OFFSET @offset`)
        .all({ like, exact: q, limit: PER_PAGE, offset: pager.offset });
      results.forEach((u) => { u.level = levelInfo(u); });
    } else if (type === 'goods') {
      const where = "p.status = 'on' AND (p.name LIKE @like ESCAPE '\\' OR p.description LIKE @like ESCAPE '\\' OR p.category LIKE @like ESCAPE '\\')";
      total = db.prepare(`SELECT COUNT(*) AS n FROM products p WHERE ${where}`).get({ like }).n;
      pager = paginate({ total, page: req.query.page, perPage: PER_PAGE, baseUrl });
      results = db.prepare(`SELECT p.* FROM products p WHERE ${where} ORDER BY (p.name LIKE @like ESCAPE '\\') DESC, p.sales DESC LIMIT @limit OFFSET @offset`)
        .all({ like, limit: PER_PAGE, offset: pager.offset });
      results.forEach((p) => { p.summary = summarize(p.description, 80); });
    } else {
      const where = `t.status = 'published' AND (t.title LIKE @like ESCAPE '\\' OR EXISTS (
        SELECT 1 FROM forum_posts p WHERE p.thread_id = t.id AND p.status = 'published' AND p.content LIKE @like ESCAPE '\\'))`;
      total = db.prepare(`SELECT COUNT(*) AS n FROM forum_threads t WHERE ${where}`).get({ like }).n;
      pager = paginate({ total, page: req.query.page, perPage: PER_PAGE, baseUrl });
      results = db.prepare(`
        SELECT t.id, t.title, t.reply_count, t.hits, t.created_at, t.is_poll, t.digest, u.id AS user_id, u.username, b.id AS board_id, b.name AS board_name,
               (SELECT content FROM forum_posts WHERE thread_id = t.id AND floor = 1) AS first_content
        FROM forum_threads t JOIN users u ON u.id = t.user_id JOIN forum_boards b ON b.id = t.board_id
        WHERE ${where} ORDER BY (t.title LIKE @like ESCAPE '\\') DESC, t.last_post_at DESC LIMIT @limit OFFSET @offset`)
        .all({ like, limit: PER_PAGE, offset: pager.offset });
      results.forEach((t) => { t.summary = summarize(t.first_content || '', 100); });
    }

    res.render('search/index.njk', { ...base, results, pager, total });
  });

  return r;
}
