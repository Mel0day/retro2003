// 在线备份数据库（不停服）：npm run backup
// 备份文件在 <DATA_DIR>/backups/，默认保留最近 14 份。上传的图片在 <DATA_DIR>/uploads/，请一并用 rsync 等工具备份。
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { loadConfig } from '../src/config.js';

const config = loadConfig();
const keep = Number(process.env.BACKUP_KEEP || 14);
const dir = path.join(config.dataDir, 'backups');
fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13);
const dest = path.join(dir, `xhs2003-${stamp}.db`);

const db = new Database(config.dbFile, { readonly: true, fileMustExist: true });
await db.backup(dest);
db.close();
console.log(`备份完成：${dest}（${(fs.statSync(dest).size / 1024).toFixed(0)}KB）`);

const files = fs.readdirSync(dir).filter((f) => /^xhs2003-.*\.db$/.test(f)).sort();
for (const f of files.slice(0, Math.max(0, files.length - keep))) {
  fs.rmSync(path.join(dir, f));
  console.log(`删除旧备份：${f}`);
}
