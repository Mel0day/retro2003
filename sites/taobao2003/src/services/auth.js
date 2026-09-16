import { sha256, randomToken, hashPassword } from '../lib/password.js';
import { now } from '../lib/format.js';

const DAY = 86400;
const REMEMBER_TTL = 14 * DAY;
const SESSION_TTL = DAY;

export function createSession(ctx, req, res, userId, remember) {
  const token = randomToken();
  const ttl = remember ? REMEMBER_TTL : SESSION_TTL;
  ctx.db.prepare('INSERT INTO sessions (id, user_id, remember, expires_at, ip, ua) VALUES (?, ?, ?, ?, ?, ?)')
    .run(sha256(token), userId, remember ? 1 : 0, now() + ttl, req.ip || '', String(req.headers['user-agent'] || '').slice(0, 200));
  ctx.db.prepare('UPDATE users SET last_login_at = ?, last_ip = ? WHERE id = ?').run(now(), req.ip || '', userId);
  res.setCookie('sid', token, remember ? { maxAge: REMEMBER_TTL } : {});
}

export function destroySession(ctx, req, res) {
  if (req.cookies.sid) ctx.db.prepare('DELETE FROM sessions WHERE id = ?').run(sha256(req.cookies.sid));
  res.clearCookie('sid');
}

export function destroyUserSessions(ctx, userId, exceptToken) {
  if (exceptToken) ctx.db.prepare('DELETE FROM sessions WHERE user_id = ? AND id <> ?').run(userId, sha256(exceptToken));
  else ctx.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export function loadUser(ctx) {
  const find = ctx.db.prepare(`
    SELECT s.id AS sid, s.remember, s.expires_at, u.*
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.id = ? AND s.expires_at > ?`);
  const extend = ctx.db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?');
  let lastSweep = 0;

  return (req, res, next) => {
    req.user = null;
    const token = req.cookies.sid;
    if (token) {
      const row = find.get(sha256(token), now());
      if (row && !row.banned) {
        const t = now();
        if (!row.remember && row.expires_at - t < SESSION_TTL / 2) extend.run(t + SESSION_TTL, row.sid);
        delete row.password_hash;
        req.user = row;
      } else {
        res.clearCookie('sid');
      }
    }
    if (Date.now() - lastSweep > 3600_000) {
      lastSweep = Date.now();
      ctx.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now());
    }
    next();
  };
}

export const isAdmin = (user) => !!user && user.role === 'admin';

// 未登录：GET 回到原地址；表单提交回到提交表单的页面（同源 Referer），拿不到就回首页
export function requireLogin(req, res, next) {
  if (req.user) return next();
  if (req.path.startsWith('/api/') || req.get('x-requested-with') === 'fetch') {
    return res.status(401).json({ ok: false, error: '请先登录' });
  }
  let back = '/';
  if (req.method === 'GET' || req.method === 'HEAD') back = req.originalUrl;
  else {
    try {
      const u = new URL(req.get('referer') || '');
      if (u.host === req.get('host')) back = u.pathname + u.search;
    } catch { /* 没有来源页 */ }
  }
  res.redirect(`/login?next=${encodeURIComponent(back)}`);
}

export function requireAdmin(req, res, next) {
  if (!req.user) return requireLogin(req, res, next);
  if (isAdmin(req.user)) return next();
  const err = new Error('您没有权限访问该页面');
  err.status = 403;
  next(err);
}

export function createUser(ctx, { username, password, passwordHash, role = 'user', city = '', balanceCents, createdAt }) {
  const { db, config } = ctx;
  const balance = balanceCents ?? config.newMemberCents;
  return db.transaction(() => {
    const id = Number(db.prepare('INSERT INTO users (username, password_hash, role, city, balance_cents, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(username, passwordHash || hashPassword(password), role, city, balance, createdAt ?? now()).lastInsertRowid);
    if (balance > 0) {
      db.prepare('INSERT INTO alipay_logs (user_id, amount_cents, balance_cents, text, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(id, balance, balance, '新会员体验金（演示用虚拟资金）', createdAt ?? now());
    }
    return id;
  })();
}

export function ensureAdmin(ctx) {
  const { adminUsername, adminPassword } = ctx.config;
  if (adminUsername && adminPassword) {
    const existing = ctx.db.prepare('SELECT id, role FROM users WHERE username = ?').get(adminUsername);
    if (!existing) {
      createUser(ctx, { username: adminUsername, password: adminPassword, role: 'admin', balanceCents: 0 });
      if (!ctx.config.isTest) console.log(`[taobao2003] 已创建站长账号：${adminUsername}`);
    } else if (existing.role !== 'admin') {
      ctx.db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(existing.id);
    }
  } else if (!ctx.config.isTest && !ctx.db.prepare("SELECT 1 FROM users WHERE role = 'admin'").get()) {
    console.warn('[taobao2003] 尚无站长账号：请设置 ADMIN_USERNAME / ADMIN_PASSWORD 环境变量，或运行 npm run create-admin');
  }
}
