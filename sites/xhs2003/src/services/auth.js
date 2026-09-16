import { sha256, randomToken } from '../lib/password.js';
import { now, dayKey } from '../lib/format.js';
import { awardPoints } from './points.js';

const DAY = 86400;
const REMEMBER_TTL = 14 * DAY;
const SESSION_TTL = DAY;

export function createSession(ctx, req, res, userId, remember) {
  const token = randomToken();
  const ttl = remember ? REMEMBER_TTL : SESSION_TTL;
  ctx.db.prepare('INSERT INTO sessions (id, user_id, remember, expires_at, ip, ua) VALUES (?, ?, ?, ?, ?, ?)')
    .run(sha256(token), userId, remember ? 1 : 0, now() + ttl, req.ip || '', (req.headers['user-agent'] || '').slice(0, 200));
  ctx.db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now(), userId);
  res.setCookie('sid', token, remember ? { maxAge: REMEMBER_TTL } : {});
}

export function destroySession(ctx, req, res) {
  if (req.cookies.sid) ctx.db.prepare('DELETE FROM sessions WHERE id = ?').run(sha256(req.cookies.sid));
  res.clearCookie('sid');
}

export function destroyUserSessions(ctx, userId) {
  ctx.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export function loadUser(ctx) {
  const find = ctx.db.prepare(`
    SELECT s.id AS sid, s.remember, s.expires_at, u.*
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.id = ? AND s.expires_at > ?`);
  const extend = ctx.db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?');
  const seen = ctx.db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?');
  const bonusDay = ctx.db.prepare('UPDATE users SET last_bonus_day = ? WHERE id = ? AND last_bonus_day <> ?');
  let lastSweep = 0;

  return (req, res, next) => {
    req.user = null;
    const token = req.cookies.sid;
    if (token) {
      const row = find.get(sha256(token), now());
      if (row && !row.banned) {
        const t = now();
        if (!row.remember && row.expires_at - t < SESSION_TTL / 2) extend.run(t + SESSION_TTL, row.sid);
        if (!row.last_seen_at || t - row.last_seen_at > 300) seen.run(t, row.id);
        const today = dayKey(t);
        if (row.last_bonus_day !== today && bonusDay.run(today, row.id, today).changes) {
          awardPoints(ctx, row.id, 'dailyLogin');
          row.points += 5;
        }
        delete row.password_hash;
        delete row.answer_hash;
        req.user = row;
      } else if (row?.banned || !row) {
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

export const isMod = (user) => !!user && (user.role === 'moderator' || user.role === 'admin');
export const isAdmin = (user) => !!user && user.role === 'admin';

export function requireLogin(req, res, next) {
  if (req.user) return next();
  if (req.xhr || req.path.startsWith('/api/') || req.accepts(['html', 'json']) === 'json') {
    return res.status(401).json({ ok: false, error: '请先登录' });
  }
  res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
}

export function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) return requireLogin(req, res, next);
    const ok = role === 'admin' ? isAdmin(req.user) : isMod(req.user);
    if (ok) return next();
    const err = new Error('您没有权限访问该页面');
    err.status = 403;
    next(err);
  };
}
