import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));

// 迁移按顺序执行，PRAGMA user_version 记录已执行到第几个。
const MIGRATIONS = [
  () => fs.readFileSync(path.join(DIR, 'schema.sql'), 'utf8'),
];

export function openDb(file) {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  migrate(db);
  return db;
}

function migrate(db) {
  const current = db.pragma('user_version', { simple: true });
  for (let i = current; i < MIGRATIONS.length; i++) {
    const sql = MIGRATIONS[i]();
    db.transaction(() => {
      db.exec(sql);
      db.pragma(`user_version = ${i + 1}`);
    })();
  }
}
