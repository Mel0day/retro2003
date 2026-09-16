// 相册业务：建册、上传、配额、封面、删除（含文件清理）
import { now } from '../lib/format.js';
import { saveImage, deleteUploadFile, UploadError } from '../lib/uploads.js';
import { ValidationError } from './notes.js';

export { ValidationError };

export const photoUrl = (p) => (p && p.path ? `/uploads/${p.path}` : '');

export function quotaInfo(ctx, userId) {
  const used = ctx.db.prepare('SELECT COALESCE(SUM(size), 0) AS n FROM photos WHERE user_id = ?').get(userId).n;
  const total = Math.max(0, ctx.settings.int('album_quota_mb')) * 1024 * 1024;
  const percent = total ? Math.min(100, Math.round((used / total) * 100)) : 100;
  return { used, total, percent, left: Math.max(0, total - used) };
}

export const getAlbum = (ctx, id) => ctx.db.prepare(`
  SELECT a.*, u.username, u.avatar_color, u.avatar_path FROM albums a JOIN users u ON u.id = a.user_id WHERE a.id = ?`).get(Number(id));

export const getPhoto = (ctx, id) => ctx.db.prepare(`
  SELECT p.*, a.title AS album_title, a.user_id AS owner_id, a.cover AS album_cover, u.username
  FROM photos p JOIN albums a ON a.id = p.album_id JOIN users u ON u.id = a.user_id WHERE p.id = ?`).get(Number(id));

function cleanAlbumInput({ title, description }) {
  const t = String(title || '').trim();
  const d = String(description || '').trim();
  if ([...t].length < 1 || [...t].length > 30) throw new ValidationError('相册名称需为 1-30 个字');
  if ([...d].length > 200) throw new ValidationError('相册描述不能超过 200 字');
  return { title: t, description: d };
}

export function createAlbum(ctx, user, input) {
  const v = cleanAlbumInput(input);
  const count = ctx.db.prepare('SELECT COUNT(*) AS n FROM albums WHERE user_id = ?').get(user.id).n;
  if (count >= 50) throw new ValidationError('每人最多建 50 个相册');
  return Number(ctx.db.prepare('INSERT INTO albums (user_id, title, description) VALUES (?, ?, ?)')
    .run(user.id, v.title, v.description).lastInsertRowid);
}

export function updateAlbum(ctx, album, input) {
  const v = cleanAlbumInput(input);
  ctx.db.prepare('UPDATE albums SET title = ?, description = ?, updated_at = ? WHERE id = ?').run(v.title, v.description, now(), album.id);
}

// 重新统计照片数；封面失效时回落到第一张照片
export function refreshAlbum(ctx, albumId) {
  const a = ctx.db.prepare('SELECT * FROM albums WHERE id = ?').get(albumId);
  if (!a) return;
  const count = ctx.db.prepare('SELECT COUNT(*) AS n FROM photos WHERE album_id = ?').get(albumId).n;
  let cover = a.cover;
  const coverValid = cover && ctx.db.prepare("SELECT 1 FROM photos WHERE album_id = ? AND '/uploads/' || path = ?").get(albumId, cover);
  if (!coverValid) {
    const first = ctx.db.prepare('SELECT path FROM photos WHERE album_id = ? ORDER BY id LIMIT 1').get(albumId);
    cover = first ? `/uploads/${first.path}` : '';
  }
  ctx.db.prepare('UPDATE albums SET photo_count = ?, cover = ? WHERE id = ?').run(count, cover, albumId);
}

const CONTROL_OR_ANGLE = /[\x00-\x1f<>]/g; // eslint-disable-line no-control-regex

function fixFilename(name) {
  let n = String(name || '');
  // busboy 默认按 latin1 解析文件名，中文会乱码，这里尝试还原为 UTF-8
  if (/[\x80-\xff]/.test(n) && !/[^\x00-\xff]/.test(n)) {
    const re = Buffer.from(n, 'latin1').toString('utf8');
    if (!re.includes('�')) n = re;
  }
  return n.replace(/\.[a-z0-9]{2,5}$/i, '').replace(CONTROL_OR_ANGLE, '').trim().slice(0, 40);
}

export function addPhoto(ctx, { album, user, file, caption }) {
  const q = quotaInfo(ctx, user.id);
  if (q.used + file.buffer.length > q.total) {
    throw new UploadError(`相册空间不足：已用 ${Math.round(q.used / 1024)}KB，共 ${Math.round(q.total / 1024)}KB`);
  }
  const saved = saveImage(ctx, { buffer: file.buffer, userId: user.id, purpose: 'album' });
  const cap = String(caption ?? '').trim().slice(0, 60) || fixFilename(file.originalname);
  const id = Number(ctx.db.prepare('INSERT INTO photos (album_id, user_id, upload_id, path, size, caption) VALUES (?, ?, ?, ?, ?, ?)')
    .run(album.id, user.id, saved.id, saved.path, saved.size, cap).lastInsertRowid);
  ctx.db.prepare('UPDATE albums SET updated_at = ? WHERE id = ?').run(now(), album.id);
  refreshAlbum(ctx, album.id);
  return { id, url: saved.url, size: saved.size };
}

function removePhotoFile(ctx, photo) {
  // 演示数据的照片没有 upload_id，文件与笔记共用，不删除文件
  if (!photo.upload_id) return;
  const up = ctx.db.prepare('SELECT path FROM uploads WHERE id = ?').get(photo.upload_id);
  if (up) {
    deleteUploadFile(ctx, up.path);
    ctx.db.prepare('DELETE FROM uploads WHERE id = ?').run(photo.upload_id);
  }
}

export function deletePhoto(ctx, photo) {
  ctx.db.transaction(() => {
    removePhotoFile(ctx, photo);
    ctx.db.prepare('DELETE FROM photos WHERE id = ?').run(photo.id);
    refreshAlbum(ctx, photo.album_id);
  })();
}

export function deleteAlbum(ctx, album) {
  ctx.db.transaction(() => {
    const photos = ctx.db.prepare('SELECT * FROM photos WHERE album_id = ?').all(album.id);
    for (const p of photos) removePhotoFile(ctx, p);
    ctx.db.prepare('DELETE FROM albums WHERE id = ?').run(album.id);
  })();
}

export function setCover(ctx, photo) {
  ctx.db.prepare('UPDATE albums SET cover = ? WHERE id = ?').run(photoUrl(photo), photo.album_id);
}

export function updateCaption(ctx, photo, caption) {
  const c = String(caption || '').trim();
  if ([...c].length > 60) throw new ValidationError('照片说明不能超过 60 字');
  ctx.db.prepare('UPDATE photos SET caption = ? WHERE id = ?').run(c, photo.id);
}
