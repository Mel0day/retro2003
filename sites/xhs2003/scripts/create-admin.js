// 用法：npm run create-admin -- 用户名 密码
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db/index.js';
import { hashPassword } from '../src/lib/password.js';

const [username, password] = process.argv.slice(2);
if (!username || !password || password.length < 6) {
  console.error('用法：npm run create-admin -- <用户名> <密码（至少 6 位）>');
  process.exit(1);
}
const config = loadConfig();
const db = openDb(config.dbFile);
const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
if (existing) {
  db.prepare("UPDATE users SET role = 'admin', password_hash = ?, banned = 0 WHERE id = ?").run(hashPassword(password), existing.id);
  console.log(`已将 ${username} 设为站长并重置密码`);
} else {
  db.prepare("INSERT INTO users (username, password_hash, role, avatar_color) VALUES (?, ?, 'admin', '#c00')").run(username, hashPassword(password));
  console.log(`已创建站长账号 ${username}`);
}
db.close();
