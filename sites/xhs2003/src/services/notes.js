import { analyze, summarize } from '../lib/ubb.js';
import { now } from '../lib/format.js';
import { awardPoints, sendSystemMessage } from './points.js';

export class ValidationError extends Error {
  constructor(message) { super(message); this.status = 400; }
}

export function parseTags(input) {
  const seen = new Set();
  const out = [];
  for (const raw of String(input || '').split(/[\s,，、;；#]+/)) {
    const t = raw.trim().slice(0, 12);
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
    if (out.length >= 8) break;
  }
  return out;
}

export function validateNote(ctx, { title, content, channelId }) {
  const t = String(title || '').trim();
  const c = String(content || '').replace(/\r\n?/g, '\n').trim();
  if ([...t].length < 4 || [...t].length > 60) throw new ValidationError('标题长度需要在 4 到 60 个字之间');
  if ([...c].length < 10) throw new ValidationError('正文太短了，至少写 10 个字吧');
  if (c.length > 50000) throw new ValidationError('正文太长了，请控制在 5 万字以内');
  const channel = ctx.db.prepare('SELECT id FROM channels WHERE id = ?').get(Number(channelId));
  if (!channel) throw new ValidationError('请选择笔记所属频道');
  return { title: t, content: c, channelId: channel.id };
}

function setTags(ctx, noteId, tags) {
  const { db } = ctx;
  const old = db.prepare('SELECT tag_id FROM note_tags WHERE note_id = ?').all(noteId).map((r) => r.tag_id);
  db.prepare('DELETE FROM note_tags WHERE note_id = ?').run(noteId);
  const insTag = db.prepare('INSERT INTO tags (name) VALUES (?) ON CONFLICT(name) DO NOTHING');
  const getTag = db.prepare('SELECT id FROM tags WHERE name = ?');
  const link = db.prepare('INSERT OR IGNORE INTO note_tags (note_id, tag_id, sort) VALUES (?, ?, ?)');
  const ids = tags.map((name, i) => {
    insTag.run(name);
    const id = getTag.get(name).id;
    link.run(noteId, id, i);
    return id;
  });
  recountTags(ctx, [...new Set([...old, ...ids])]);
}

export function recountTags(ctx, tagIds) {
  const upd = ctx.db.prepare(`UPDATE tags SET use_count = (
    SELECT COUNT(*) FROM note_tags nt JOIN notes n ON n.id = nt.note_id
    WHERE nt.tag_id = tags.id AND n.status = 'published') WHERE id = ?`);
  for (const id of tagIds) upd.run(id);
}

export function recountNoteOwners(ctx, { channelIds = [], userIds = [] }) {
  const ch = ctx.db.prepare("UPDATE channels SET note_count = (SELECT COUNT(*) FROM notes WHERE channel_id = channels.id AND status = 'published') WHERE id = ?");
  const us = ctx.db.prepare("UPDATE users SET note_count = (SELECT COUNT(*) FROM notes WHERE user_id = users.id AND status = 'published') WHERE id = ?");
  for (const id of new Set(channelIds)) ch.run(id);
  for (const id of new Set(userIds)) us.run(id);
}

export function recountComments(ctx, noteId) {
  ctx.db.prepare("UPDATE notes SET comment_count = (SELECT COUNT(*) FROM comments WHERE note_id = ? AND status = 'approved') WHERE id = ?")
    .run(noteId, noteId);
}

function derived(content) {
  const { images } = analyze(content);
  return { cover: images[0] || '', hasImage: images.length ? 1 : 0, summary: summarize(content, 140) };
}

export function createNote(ctx, userId, input) {
  const v = validateNote(ctx, input);
  const tags = parseTags(input.tags);
  const d = derived(v.content);
  return ctx.db.transaction(() => {
    const id = Number(ctx.db.prepare(`INSERT INTO notes (user_id, channel_id, title, content, summary, cover, has_image)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(userId, v.channelId, v.title, v.content, d.summary, d.cover, d.hasImage).lastInsertRowid);
    setTags(ctx, id, tags);
    recountNoteOwners(ctx, { channelIds: [v.channelId], userIds: [userId] });
    awardPoints(ctx, userId, 'note');
    return id;
  })();
}

export function updateNote(ctx, note, editor, input) {
  const v = validateNote(ctx, input);
  const tags = parseTags(input.tags);
  const d = derived(v.content);
  ctx.db.transaction(() => {
    ctx.db.prepare(`UPDATE notes SET channel_id = ?, title = ?, content = ?, summary = ?, cover = ?, has_image = ?,
      edited_at = ?, edited_by = ?, updated_at = ? WHERE id = ?`)
      .run(v.channelId, v.title, v.content, d.summary, d.cover, d.hasImage, now(), editor.username, now(), note.id);
    setTags(ctx, note.id, tags);
    recountNoteOwners(ctx, { channelIds: [note.channel_id, v.channelId], userIds: [note.user_id] });
  })();
}

export function setNoteStatus(ctx, note, status) {
  ctx.db.transaction(() => {
    ctx.db.prepare('UPDATE notes SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), note.id);
    const tagIds = ctx.db.prepare('SELECT tag_id FROM note_tags WHERE note_id = ?').all(note.id).map((r) => r.tag_id);
    recountTags(ctx, tagIds);
    recountNoteOwners(ctx, { channelIds: [note.channel_id], userIds: [note.user_id] });
  })();
}

export function deleteNote(ctx, note) {
  ctx.db.transaction(() => {
    const tagIds = ctx.db.prepare('SELECT tag_id FROM note_tags WHERE note_id = ?').all(note.id).map((r) => r.tag_id);
    ctx.db.prepare('DELETE FROM notes WHERE id = ?').run(note.id);
    recountTags(ctx, tagIds);
    recountNoteOwners(ctx, { channelIds: [note.channel_id], userIds: [note.user_id] });
  })();
}

export function getNote(ctx, id) {
  return ctx.db.prepare(`
    SELECT n.*, c.name AS channel_name, c.slug AS channel_slug
    FROM notes n JOIN channels c ON c.id = n.channel_id WHERE n.id = ?`).get(Number(id));
}

// 留言通过审核（或直接发布）后的连带效果：计数、积分、通知
function onCommentApproved(ctx, comment) {
  const note = ctx.db.prepare('SELECT id, user_id, title FROM notes WHERE id = ?').get(comment.note_id);
  if (!note) return;
  recountComments(ctx, note.id);
  if (comment.user_id) awardPoints(ctx, comment.user_id, 'comment');
  if (note.user_id !== comment.user_id) {
    awardPoints(ctx, note.user_id, 'commented');
    const who = comment.user_id
      ? ctx.db.prepare('SELECT username FROM users WHERE id = ?').get(comment.user_id)?.username
      : `游客「${comment.guest_name}」`;
    const text = comment.content.length > 60 ? comment.content.slice(0, 60) + '……' : comment.content;
    sendSystemMessage(ctx, note.user_id, `${who} 在你的笔记里留言了`,
      `${who} 在你的笔记 [url=/notes/${note.id}#floor-${comment.floor}]《${note.title}》[/url] 里留言：\n[quote]${text.replace(/\[\/?quote[^\]]*\]/gi, '')}[/quote]`);
  }
}

export function addComment(ctx, { note, user, guestName, content, ip }) {
  const text = String(content || '').replace(/\r\n?/g, '\n').trim();
  if ([...text].length < 2) throw new ValidationError('留言内容至少 2 个字');
  if ([...text].length > 2000) throw new ValidationError('留言内容不能超过 2000 字');
  const review = user
    ? ctx.settings.bool('comment_review_member') && !['admin', 'moderator'].includes(user.role)
    : ctx.settings.bool('comment_review_guest');
  const status = review ? 'pending' : 'approved';
  return ctx.db.transaction(() => {
    const floor = (ctx.db.prepare('SELECT MAX(floor) AS f FROM comments WHERE note_id = ?').get(note.id).f || 0) + 1;
    const id = Number(ctx.db.prepare(`INSERT INTO comments (note_id, user_id, guest_name, content, floor, status, ip)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(note.id, user?.id ?? null, user ? '' : guestName, text, floor, status, ip || '').lastInsertRowid);
    const comment = ctx.db.prepare('SELECT * FROM comments WHERE id = ?').get(id);
    if (status === 'approved') onCommentApproved(ctx, comment);
    return comment;
  })();
}

export function approveComment(ctx, commentId) {
  const c = ctx.db.prepare('SELECT * FROM comments WHERE id = ?').get(commentId);
  if (!c || c.status === 'approved') return false;
  ctx.db.transaction(() => {
    ctx.db.prepare("UPDATE comments SET status = 'approved' WHERE id = ?").run(commentId);
    onCommentApproved(ctx, { ...c, status: 'approved' });
  })();
  return true;
}

export function removeComment(ctx, commentId) {
  const c = ctx.db.prepare('SELECT * FROM comments WHERE id = ?').get(commentId);
  if (!c) return false;
  ctx.db.prepare("UPDATE comments SET status = 'deleted' WHERE id = ?").run(commentId);
  recountComments(ctx, c.note_id);
  return true;
}

export function toggleFavorite(ctx, userId, noteId) {
  const has = ctx.db.prepare('SELECT 1 FROM favorites WHERE user_id = ? AND note_id = ?').get(userId, noteId);
  ctx.db.transaction(() => {
    if (has) ctx.db.prepare('DELETE FROM favorites WHERE user_id = ? AND note_id = ?').run(userId, noteId);
    else ctx.db.prepare('INSERT INTO favorites (user_id, note_id) VALUES (?, ?)').run(userId, noteId);
    ctx.db.prepare('UPDATE notes SET favorites = (SELECT COUNT(*) FROM favorites WHERE note_id = ?) WHERE id = ?').run(noteId, noteId);
  })();
  return !has;
}
