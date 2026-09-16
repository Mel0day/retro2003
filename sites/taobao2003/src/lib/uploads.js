// 图片上传：在 CSRF 校验之前统一解析 multipart 表单（内存暂存，限制大小和数量），
// 路由里用 req.files 拿文件，saveImage 落盘到 DATA_DIR/uploads/YYYYMM/<随机名>.<扩展名>。
// 只接受按文件头识别出的 JPG / PNG / GIF / WEBP，不信任文件名和浏览器给的类型，不接受 SVG。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';

export const UPLOAD_LIMITS = { fileSize: 2 * 1024 * 1024, files: 3, fields: 60, parts: 70, fieldSize: 100 * 1024 };

const SIGNATURES = [
  { mime: 'image/jpeg', ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', ext: 'png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/gif', ext: 'gif', test: (b) => b.subarray(0, 4).toString('latin1') === 'GIF8' },
  { mime: 'image/webp', ext: 'webp', test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
];

export function sniffImage(buf) {
  if (!buf || buf.length < 12) return null;
  return SIGNATURES.find((s) => s.test(buf)) || null;
}

export class UploadError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export function multipartParser(limits = UPLOAD_LIMITS) {
  const parse = multer({ storage: multer.memoryStorage(), limits }).any();
  return (req, res, next) => {
    if (!req.is('multipart/form-data')) return next();
    parse(req, res, (err) => {
      if (!err) { req.files = (req.files || []).filter((f) => f.size > 0); return next(); }
      if (err.code === 'LIMIT_FILE_SIZE') return next(new UploadError(`图片太大了，单张不能超过 ${Math.round(limits.fileSize / 1024 / 1024)}MB`, 413));
      if (err.code === 'LIMIT_FILE_COUNT') return next(new UploadError(`一次最多上传 ${limits.files} 张图片`));
      next(new UploadError('上传的表单格式不正确'));
    });
  };
}

export function saveImage(config, file) {
  const buffer = file?.buffer;
  if (!buffer || !buffer.length) throw new UploadError('请选择要上传的图片');
  const kind = sniffImage(buffer);
  if (!kind) throw new UploadError('只支持 JPG、PNG、GIF、WEBP 格式的图片');
  if (buffer.length > UPLOAD_LIMITS.fileSize) throw new UploadError('图片太大了，单张不能超过 2MB', 413);
  const d = new Date();
  const sub = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
  fs.mkdirSync(path.join(config.uploadDir, sub), { recursive: true });
  const name = `${crypto.randomBytes(12).toString('hex')}.${kind.ext}`;
  fs.writeFileSync(path.join(config.uploadDir, sub, name), buffer);
  return `/uploads/${sub}/${name}`;
}

const UPLOAD_URL = /^\/uploads\/(\d{6}|seed)\/([0-9a-z_-]{1,40}\.(?:jpg|png|gif|webp))$/;
export const isUploadUrl = (url) => UPLOAD_URL.test(String(url || ''));

// 删除 saveImage 保存的图片（只认 /uploads/YYYYMM/<名字> 形式，防止路径穿越）
export function removeImage(config, url) {
  const m = /^\/uploads\/(\d{6})\/([0-9a-f]{24}\.(?:jpg|png|gif|webp))$/.exec(String(url || ''));
  if (!m) return false;
  try { fs.unlinkSync(path.join(config.uploadDir, m[1], m[2])); return true; } catch { return false; }
}
