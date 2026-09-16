// 在线备份（不停服）：npm run backup
// 数据库一致性备份到 <DATA_DIR>/backups/，默认保留最近 14 份；上传的图片在 <DATA_DIR>/uploads/，同目录打包一份清单。
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { loadConfig } from '../src/config.js';

const config = loadConfig();
const keep = Number(process.env.BACKUP_KEEP || 14);
const dir = path.join(config.dataDir, 'backups');
fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13);
const dest = path.join(dir, `__SLUG__-${stamp}.db`);

const db = new Database(config.dbFile, { readonly: true, fileMustExist: true });
await db.backup(dest);
db.close();
console.log(`数据库备份完成：${dest}（${(fs.statSync(dest).size / 1024).toFixed(0)}KB）`);

const uploads = [];
const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else uploads.push(path.relative(config.uploadDir, p)); } };
if (fs.existsSync(config.uploadDir)) walk(config.uploadDir);
fs.writeFileSync(`${dest}.uploads.txt`, uploads.join('\n'));
console.log(`上传图片 ${uploads.length} 张，位于 ${config.uploadDir}，请与数据库备份一起复制（清单：${path.basename(dest)}.uploads.txt）`);

const files = fs.readdirSync(dir).filter((f) => /^__SLUG__-.*\.db$/.test(f)).sort();
for (const f of files.slice(0, Math.max(0, files.length - keep))) {
  fs.rmSync(path.join(dir, f));
  fs.rmSync(path.join(dir, `${f}.uploads.txt`), { force: true });
  console.log(`删除旧备份：${f}`);
}
