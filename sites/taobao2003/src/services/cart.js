// 购物车：游客按访客 id 保存，登录后合并到账号
import { decorate } from './items.js';

export const MAX_QTY = 99;
export const ownerKey = (req) => (req.user ? `u:${req.user.id}` : `v:${req.vid}`);

export function cartCount(db, key) {
  return db.prepare("SELECT COALESCE(SUM(c.qty), 0) AS n FROM carts c JOIN items i ON i.id = c.item_id WHERE c.owner_key = ? AND i.status <> 'deleted'").get(key).n;
}

export function cartQty(db, key, itemId) {
  return db.prepare('SELECT qty FROM carts WHERE owner_key = ? AND item_id = ?').get(key, itemId)?.qty || 0;
}

// 设置数量（不超过库存和 99）；qty <= 0 删除
export function setQty(db, key, itemId, qty) {
  if (qty <= 0) return db.prepare('DELETE FROM carts WHERE owner_key = ? AND item_id = ?').run(key, itemId);
  return db.prepare('INSERT INTO carts (owner_key, item_id, qty) VALUES (?, ?, ?) ON CONFLICT(owner_key, item_id) DO UPDATE SET qty = excluded.qty')
    .run(key, itemId, Math.min(qty, MAX_QTY));
}

// 登录时把游客购物车合并进账号：同一宝贝数量相加，但不超过库存和 99；自己发布的宝贝不合并
export function mergeCart(db, vid, user) {
  const from = `v:${vid}`;
  const to = `u:${user.id}`;
  db.transaction(() => {
    const rows = db.prepare('SELECT c.item_id, c.qty, i.stock, i.seller_id FROM carts c JOIN items i ON i.id = c.item_id WHERE c.owner_key = ?').all(from);
    for (const r of rows) {
      if (r.seller_id === user.id) continue;
      const have = cartQty(db, to, r.item_id);
      const qty = Math.min(have + r.qty, Math.max(r.stock, have, 1), MAX_QTY);
      setQty(db, to, r.item_id, qty);
    }
    db.prepare('DELETE FROM carts WHERE owner_key = ?').run(from);
  })();
}

// 购物车页面数据：按卖家分组，每行带「能否结算」的问题说明
export function cartView(db, key, user) {
  const rows = db.prepare(`SELECT c.item_id, c.qty, i.*, u.username AS seller_name, u.banned AS seller_banned
    FROM carts c JOIN items i ON i.id = c.item_id JOIN users u ON u.id = i.seller_id
    WHERE c.owner_key = ? AND i.status <> 'deleted' ORDER BY c.created_at, c.item_id`).all(key).map((r) => {
    const it = decorate(r);
    let problem = '';
    if (it.blocked) problem = '已被淘宝网下架';
    else if (it.seller_banned) problem = '卖家账号已冻结';
    else if (it.status !== 'onsale') problem = '已下架';
    else if (user && it.seller_id === user.id) problem = '这是您自己的宝贝';
    else if (it.stock < 1) problem = '已卖完';
    else if (it.stock < r.qty) problem = `库存仅 ${it.stock} 件`;
    return { ...it, qty: r.qty, sub_cents: it.price_cents * r.qty, problem };
  });
  const groups = [];
  for (const r of rows) {
    let g = groups.find((x) => x.seller_id === r.seller_id);
    if (!g) { g = { seller_id: r.seller_id, seller_name: r.seller_name, lines: [] }; groups.push(g); }
    g.lines.push(r);
  }
  const ok = rows.filter((r) => !r.problem);
  return {
    rows, groups,
    count: rows.reduce((a, r) => a + r.qty, 0),
    total_cents: ok.reduce((a, r) => a + r.sub_cents, 0),
    hasProblem: rows.some((r) => r.problem),
  };
}
