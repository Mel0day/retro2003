import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';

export const HARD_LIMIT_BYTES = 10 * 1024 * 1024;

const SIGNATURES = [
  { mime: 'image/jpeg', ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', ext: 'png', test: (b) => b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/gif', ext: 'gif', test: (b) => b.slice(0, 4).toString('latin1') === 'GIF8' },
  { mime: 'image/webp', ext: 'webp', test: (b) => b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP' },
];

export function sniffImage(buf) {
  if (!buf || buf.length < 12) return null;
  return SIGNATURES.find((s) => s.test(buf)) || null;
}

export const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: HARD_LIMIT_BYTES, files: 10, fields: 50 },
});

export class UploadError extends Error {}

// 保存图片并登记到 uploads 表，返回 { id, url, size }
export function saveImage(ctx, { buffer, userId, purpose = 'note', maxBytes }) {
  const kind = sniffImage(buffer);
  if (!kind) throw new UploadError('只支持 JPG / PNG / GIF / WEBP 格式的图片');
  const limit = maxBytes ?? ctx.settings.int('upload_max_kb') * 1024;
  if (buffer.length > limit) {
    throw new UploadError(`图片太大了，单张不能超过 ${Math.round(limit / 1024)}KB`);
  }
  const d = new Date();
  const sub = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
  const dir = path.join(ctx.config.uploadDir, sub);
  fs.mkdirSync(dir, { recursive: true });
  const name = `${crypto.randomBytes(12).toString('hex')}.${kind.ext}`;
  fs.writeFileSync(path.join(dir, name), buffer);
  const rel = `${sub}/${name}`;
  const info = ctx.db.prepare('INSERT INTO uploads (user_id, path, mime, size, purpose) VALUES (?, ?, ?, ?, ?)')
    .run(userId ?? null, rel, kind.mime, buffer.length, purpose);
  return { id: Number(info.lastInsertRowid), url: `/uploads/${rel}`, path: rel, size: buffer.length };
}

export function deleteUploadFile(ctx, rel) {
  if (!rel || rel.includes('..')) return;
  const file = path.join(ctx.config.uploadDir, rel.replace(/^\/uploads\//, ''));
  fs.rm(file, { force: true }, () => {});
}
