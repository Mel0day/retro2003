import express from 'express';
import { RANK_BG } from '../services/portal.js';
import { now } from '../lib/format.js';

const RANGES = { week: ['本周', 7], month: ['本月', 30], all: ['总榜', 0] };

function ranked(rows, urlOf, unit) {
  return rows.map((r, i) => ({ ...r, rank: i + 1, bg: RANK_BG[Math.min(i, 2)], url: urlOf(r), unit }));
}

export default function rankRoutes(ctx) {
  const r = express.Router();
  const { db } = ctx;

  r.get('/rank', (req, res) => {
    const range = RANGES[req.query.range] ? req.query.range : 'all';
    const days = RANGES[range][1];
    const since = days ? now() - days * 86400 : 0;
    const L = 10;
    const noteUrl = (x) => `/notes/${x.id}`;

    // 笔记点击榜：点击数是累计值，时间窗口按发表时间筛选
    const hits = db.prepare(`SELECT n.id, n.title, n.hits AS value FROM notes n
      WHERE n.status = 'published' AND n.created_at >= ? ORDER BY n.hits DESC, n.id DESC LIMIT ?`).all(since, L);

    const likes = days
      ? db.prepare(`SELECT n.id, n.title, COUNT(*) AS value FROM note_likes l JOIN notes n ON n.id = l.note_id
          WHERE l.created_at >= ? AND n.status = 'published' GROUP BY n.id ORDER BY value DESC, n.id DESC LIMIT ?`).all(since, L)
      : db.prepare(`SELECT id, title, likes AS value FROM notes WHERE status = 'published' AND likes > 0 ORDER BY likes DESC, id DESC LIMIT ?`).all(L);

    const flowers = days
      ? db.prepare(`SELECT n.id, n.title, COUNT(*) AS value FROM flowers f JOIN notes n ON n.id = f.note_id
          WHERE f.created_at >= ? AND n.status = 'published' GROUP BY n.id ORDER BY value DESC, n.id DESC LIMIT ?`).all(since, L)
      : db.prepare(`SELECT id, title, flowers AS value FROM notes WHERE status = 'published' AND flowers > 0 ORDER BY flowers DESC, id DESC LIMIT ?`).all(L);

    const comments = days
      ? db.prepare(`SELECT n.id, n.title, COUNT(*) AS value FROM comments c JOIN notes n ON n.id = c.note_id
          WHERE c.created_at >= ? AND c.status = 'approved' AND n.status = 'published' GROUP BY n.id ORDER BY value DESC, n.id DESC LIMIT ?`).all(since, L)
      : db.prepare(`SELECT id, title, comment_count AS value FROM notes WHERE status = 'published' AND comment_count > 0 ORDER BY comment_count DESC, id DESC LIMIT ?`).all(L);

    const points = days
      ? db.prepare(`SELECT u.id, u.username AS title, SUM(p.delta) AS value FROM points_log p JOIN users u ON u.id = p.user_id
          WHERE p.created_at >= ? AND u.banned = 0 GROUP BY u.id HAVING value > 0 ORDER BY value DESC, u.id LIMIT ?`).all(since, L)
      : db.prepare(`SELECT id, username AS title, points AS value FROM users WHERE banned = 0 ORDER BY points DESC, id LIMIT ?`).all(L);

    const posters = days
      ? db.prepare(`SELECT u.id, u.username AS title, COUNT(*) AS value FROM forum_posts p JOIN users u ON u.id = p.user_id
          WHERE p.created_at >= ? AND p.status = 'published' AND u.banned = 0 GROUP BY u.id ORDER BY value DESC, u.id LIMIT ?`).all(since, L)
      : db.prepare(`SELECT id, username AS title, post_count AS value FROM users WHERE banned = 0 AND post_count > 0 ORDER BY post_count DESC, id LIMIT ?`).all(L);

    const threads = days
      ? db.prepare(`SELECT t.id, t.title, COUNT(*) AS value FROM forum_posts p JOIN forum_threads t ON t.id = p.thread_id
          WHERE p.created_at >= ? AND p.floor > 1 AND p.status = 'published' AND t.status = 'published' GROUP BY t.id ORDER BY value DESC, t.id DESC LIMIT ?`).all(since, L)
      : db.prepare(`SELECT id, title, reply_count AS value FROM forum_threads WHERE status = 'published' ORDER BY reply_count DESC, id DESC LIMIT ?`).all(L);

    const goods = days
      ? db.prepare(`SELECT p.id, p.name AS title, SUM(o.qty) AS value FROM orders o JOIN products p ON p.id = o.product_id
          WHERE o.created_at >= ? AND o.status <> 'cancelled' AND p.status = 'on' GROUP BY p.id ORDER BY value DESC, p.id LIMIT ?`).all(since, L)
      : db.prepare(`SELECT id, name AS title, sales AS value FROM products WHERE status = 'on' ORDER BY sales DESC, id LIMIT ?`).all(L);

    const userUrl = (x) => `/u/${x.id}`;
    const boards = [
      { key: 'hits', title: '笔记点击榜', note: days ? `${RANGES[range][0]}发表` : '', items: ranked(hits, noteUrl, '点击') },
      { key: 'likes', title: '笔记被顶榜', items: ranked(likes, noteUrl, '顶') },
      { key: 'flowers', title: '笔记送花榜', items: ranked(flowers, noteUrl, '朵') },
      { key: 'comments', title: '笔记热评榜', items: ranked(comments, noteUrl, '条') },
      { key: 'points', title: '会员积分榜', note: days ? '期间获得' : '', items: ranked(points, userUrl, '分') },
      { key: 'posters', title: '论坛发帖达人', items: ranked(posters, userUrl, '帖') },
      { key: 'threads', title: '论坛热帖榜', items: ranked(threads, (x) => `/forum/thread/${x.id}`, '回复') },
      { key: 'goods', title: '好物销量榜', items: ranked(goods, (x) => `/shop/${x.id}`, '件') },
    ];

    res.render('rank/index.njk', {
      title: `排行榜 · ${RANGES[range][0]}`, nav: 'rank', crumbs: [['排行榜']],
      range, ranges: Object.entries(RANGES).map(([k, v]) => ({ key: k, label: v[0] })), boards,
    });
  });

  return r;
}
