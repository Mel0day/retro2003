// 创建或重置淘宝小二（站长）账号：npm run create-admin -- <会员名> <密码>
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { createUser, destroyUserSessions } from '../src/services/auth.js';
import { hashPassword } from '../src/lib/password.js';

const [username, password] = process.argv.slice(2);
if (!username || !password || password.length < 12) {
  console.error('用法：npm run create-admin -- <会员名> <至少 12 位的密码>');
  process.exit(1);
}
const config = loadConfig();
const { ctx, close } = createApp(config);
const existing = ctx.db.prepare('SELECT id FROM users WHERE username = ?').get(username);
if (existing) {
  ctx.db.prepare("UPDATE users SET role = 'admin', banned = 0, password_hash = ? WHERE id = ?").run(hashPassword(password), existing.id);
  destroyUserSessions(ctx, existing.id);
  console.log(`已把 ${username} 设为淘宝小二并重置密码`);
} else {
  createUser(ctx, { username, password, role: 'admin', balanceCents: 0 });
  console.log(`已创建淘宝小二账号 ${username}`);
}
close();
