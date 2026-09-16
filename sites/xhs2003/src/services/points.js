import { POINT_RULES } from '../lib/levels.js';

export function awardPoints(ctx, userId, rule, overrideDelta, overrideReason) {
  if (!userId) return;
  const r = POINT_RULES[rule] || { delta: overrideDelta ?? 0, reason: overrideReason ?? rule };
  const delta = overrideDelta ?? r.delta;
  const reason = overrideReason ?? r.reason;
  if (!delta) return;
  ctx.db.prepare('UPDATE users SET points = MAX(0, points + ?) WHERE id = ?').run(delta, userId);
  ctx.db.prepare('INSERT INTO points_log (user_id, delta, reason) VALUES (?, ?, ?)').run(userId, delta, reason);
}

export function sendSystemMessage(ctx, toId, title, body) {
  if (!toId) return;
  ctx.db.prepare('INSERT INTO messages (from_id, to_id, title, body) VALUES (NULL, ?, ?, ?)').run(toId, title, body);
}

export function sendMessage(ctx, fromId, toId, title, body) {
  return Number(ctx.db.prepare('INSERT INTO messages (from_id, to_id, title, body) VALUES (?, ?, ?, ?)')
    .run(fromId, toId, title, body).lastInsertRowid);
}
