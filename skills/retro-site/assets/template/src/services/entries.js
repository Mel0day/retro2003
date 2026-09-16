// 示例业务：一条「内容」。把它换成你的产品的核心对象（帖子、宝贝、歌曲、文档……）
import { line, multiline, searchNorm, searchTerms, likeEscape } from '../lib/text.js';
import { now } from '../lib/format.js';

export const CHANNELS = ['闲聊', '分享', '求助', '公告'];
export const PER_PAGE = 10;

export function listEntries(db, { channel = '', q = '', authorId = null, limit, offset }) {
  const where = ["e.status = 'public'"];
  const params = [];
  if (channel) { where.push('e.channel = ?'); params.push(channel); }
  if (authorId) { where.push('e.author_id = ?'); params.push(authorId); }
  for (const t of searchTerms(q)) { where.push("e.search_text LIKE ? ESCAPE '\\'"); params.push(`%${likeEscape(t)}%`); }
  const whereSql = where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) AS n FROM entries e WHERE ${whereSql}`).get(...params).n;
  const rows = db.prepare(`SELECT e.*, u.username AS author_name FROM entries e JOIN users u ON u.id = e.author_id
    WHERE ${whereSql} ORDER BY e.created_at DESC, e.id DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  return { total, rows };
}

export function getEntry(db, id) {
  return db.prepare(`SELECT e.*, u.username AS author_name, u.banned AS author_banned
    FROM entries e JOIN users u ON u.id = e.author_id WHERE e.id = ?`).get(id);
}

export function channelCounts(db) {
  const rows = db.prepare("SELECT channel, COUNT(*) AS n FROM entries WHERE status = 'public' GROUP BY channel").all();
  const map = Object.fromEntries(rows.map((r) => [r.channel, r.n]));
  return CHANNELS.map((c) => ({ channel: c, n: map[c] || 0 }));
}

// 发布 / 编辑表单校验，返回 { data, errors }
export function readEntryForm(body) {
  const data = {
    channel: line(body.channel, 10),
    title: line(body.title, 60),
    body: multiline(body.body, 5000),
  };
  const errors = [];
  if (!CHANNELS.includes(data.channel)) errors.push('请选择栏目');
  if ([...data.title].length < 4) errors.push('标题至少 4 个字');
  if ([...data.body].length < 10) errors.push('正文至少 10 个字');
  return { data, errors };
}

export function insertEntry(db, { authorId, data, image = '', at = now() }) {
  return Number(db.prepare(`INSERT INTO entries (author_id, channel, title, body, image, status, search_text, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'public', ?, ?, ?)`)
    .run(authorId, data.channel, data.title, data.body, image, searchNorm(`${data.title} ${data.body}`), at, at).lastInsertRowid);
}
