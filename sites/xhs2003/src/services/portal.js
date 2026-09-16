// 门户公共数据：频道、公告、广告、标签云、排行等，多个页面共用
import { now } from '../lib/format.js';

const TAG_STYLES = [
  'font-size:16px;font-family:var(--f-song-16);color:#c00;font-weight:bold',
  'font-size:15px;font-family:var(--f-song-15);color:#009',
  'font-size:14px;font-family:var(--f-song-14);color:#060',
  'font-size:13px;font-family:var(--f-song-13);color:#630',
  'font-size:13px;font-family:var(--f-song-13);color:#909',
];
export const RANK_BG = ['#c00', '#e60', '#c90'];

export function channels(ctx) {
  return ctx.db.prepare('SELECT * FROM channels ORDER BY sort, id').all();
}

export function channelBySlug(ctx, slug) {
  return ctx.db.prepare('SELECT * FROM channels WHERE slug = ?').get(slug);
}

export function links(ctx) {
  return ctx.db.prepare('SELECT * FROM links ORDER BY sort, id').all();
}

export function marquee(ctx) {
  return ctx.db.prepare('SELECT content FROM announcements WHERE active = 1 ORDER BY sort, id').all().map((r) => r.content);
}

export function pickAd(ctx, slot) {
  const ads = ctx.db.prepare('SELECT * FROM ads WHERE slot = ? AND active = 1 ORDER BY sort, id').all(slot);
  if (!ads.length) return null;
  return ads[Math.floor(Math.random() * ads.length)];
}

export function hotTags(ctx, limit = 12) {
  const tags = ctx.db.prepare('SELECT id, name, use_count FROM tags WHERE use_count > 0 ORDER BY use_count DESC, id LIMIT ?').all(limit);
  tags.forEach((t, i) => { t.style = TAG_STYLES[i] || ''; });
  return tags.sort((a, b) => a.id - b.id);
}

export function rankNotes(ctx, { limit = 10, channelId = null, by = 'hits', sinceDays = 0 } = {}) {
  const col = { hits: 'n.hits', likes: 'n.likes', flowers: 'n.flowers', comments: 'n.comment_count' }[by] || 'n.hits';
  const where = ["n.status = 'published'"];
  const args = [];
  if (channelId) { where.push('n.channel_id = ?'); args.push(channelId); }
  if (sinceDays) { where.push('n.created_at >= ?'); args.push(now() - sinceDays * 86400); }
  const rows = ctx.db.prepare(`
    SELECT n.id, n.title, n.hits, n.likes, n.flowers, n.comment_count, n.created_at, u.username, u.id AS user_id
    FROM notes n JOIN users u ON u.id = n.user_id
    WHERE ${where.join(' AND ')} ORDER BY ${col} DESC, n.id DESC LIMIT ?`).all(...args, limit);
  rows.forEach((r, i) => { r.rank = i + 1; r.bg = RANK_BG[Math.min(i, 2)]; r.value = r[by === 'comments' ? 'comment_count' : by] ?? r.hits; });
  return rows;
}

export function latestNotes(ctx, { limit = 12, offset = 0, channelId = null } = {}) {
  const newHours = ctx.settings.int('new_badge_hours') || 24;
  const args = [];
  let where = "n.status = 'published'";
  if (channelId) { where += ' AND n.channel_id = ?'; args.push(channelId); }
  const rows = ctx.db.prepare(`
    SELECT n.id, n.title, n.has_image, n.created_at, n.hits, n.comment_count, n.cover, u.username, u.id AS user_id,
           c.name AS channel_name, c.slug AS channel_slug
    FROM notes n JOIN users u ON u.id = n.user_id JOIN channels c ON c.id = n.channel_id
    WHERE ${where} ORDER BY n.created_at DESC, n.id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset);
  const cutoff = now() - newHours * 3600;
  rows.forEach((r) => { r.isNew = r.created_at >= cutoff; });
  return rows;
}

export function featuredNotes(ctx, limit = 6) {
  const rows = ctx.db.prepare(`
    SELECT n.id, n.title, n.hits, n.cover, u.username, u.id AS user_id
    FROM notes n JOIN users u ON u.id = n.user_id
    WHERE n.status = 'published' AND n.featured = 1 AND n.cover <> ''
    ORDER BY n.hits DESC, n.id DESC LIMIT ?`).all(limit);
  if (rows.length < limit) {
    const ids = rows.map((r) => r.id);
    const more = ctx.db.prepare(`
      SELECT n.id, n.title, n.hits, n.cover, u.username, u.id AS user_id
      FROM notes n JOIN users u ON u.id = n.user_id
      WHERE n.status = 'published' AND n.cover <> '' AND n.featured = 0 AND n.created_at >= ?
      ORDER BY n.hits DESC LIMIT ?`).all(now() - 30 * 86400, limit);
    for (const m of more) if (rows.length < limit && !ids.includes(m.id)) rows.push(m);
  }
  return rows;
}

export function featuredProducts(ctx, limit = 5) {
  return ctx.db.prepare(`SELECT id, name, price_cents FROM products WHERE status = 'on'
    ORDER BY featured DESC, sort, id LIMIT ?`).all(limit);
}

export function hotThreads(ctx, limit = 5) {
  return ctx.db.prepare(`SELECT id, title, reply_count, is_poll FROM forum_threads WHERE status = 'published'
    ORDER BY reply_count DESC, last_post_at DESC LIMIT ?`).all(limit);
}

export function counterDigits(ctx) {
  const n = ctx.settings.int('counter_base') + ctx.settings.int('visitor_count');
  return String(n).padStart(8, '0').split('');
}
