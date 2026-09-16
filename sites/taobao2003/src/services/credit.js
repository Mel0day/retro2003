// 信用评价：好评 +1、中评 0、差评 -1。同一评价人对同一会员（同一身份）30 天内的多次评价只有第一次计分。
import { now } from '../lib/format.js';
import { starsText, levelOf, levelTitle, goodRate } from '../lib/credit.js';

export const GRADES = { 1: '好评', 0: '中评', '-1': '差评' };
const WINDOW = 30 * 86400;

export function creditOf(db, userId, role) {
  const row = db.prepare(`SELECT
      COALESCE(SUM(grade), 0) AS score,
      COALESCE(SUM(grade = 1), 0) AS good,
      COALESCE(SUM(grade = 0), 0) AS neutral,
      COALESCE(SUM(grade = -1), 0) AS bad
    FROM ratings WHERE to_id = ? AND role = ? AND counted = 1`).get(userId, role);
  const total = row.good + row.neutral + row.bad;
  return {
    ...row,
    score: Math.max(0, row.score),
    rawScore: row.score,
    total,
    rate: goodRate(row.good, total),
    stars: starsText(row.score),
    level: levelOf(row.score),
    title: levelTitle(row.score),
  };
}

// 每个请求里缓存一次，列表页 10 个卖家不会重复查询
export function creditCache(db) {
  const cache = new Map();
  return (userId, role = 'seller') => {
    const key = `${userId}:${role}`;
    if (!cache.has(key)) cache.set(key, creditOf(db, userId, role));
    return cache.get(key);
  };
}

// 在调用方的事务里执行
export function insertRating(db, { orderId = null, itemId = null, itemTitle = '', role, fromId, toId, grade, text, createdAt = now() }) {
  const recent = db.prepare('SELECT 1 FROM ratings WHERE from_id = ? AND to_id = ? AND role = ? AND counted = 1 AND created_at > ? AND created_at <= ? LIMIT 1')
    .get(fromId, toId, role, createdAt - WINDOW, createdAt);
  return db.prepare('INSERT INTO ratings (order_id, item_id, item_title, role, from_id, to_id, grade, text, counted, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(orderId, itemId, itemTitle, role, fromId, toId, grade, text, recent ? 0 : 1, createdAt).lastInsertRowid;
}
