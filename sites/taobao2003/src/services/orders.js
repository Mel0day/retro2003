// 交易：下单付款（支付宝担保）→ 卖家发货 → 买家确认收货（货款打给卖家）→ 双方互评。
// 未发货前买家可以取消、卖家可以关闭，货款原路退回支付宝，库存退回。
import crypto from 'node:crypto';
import { now } from '../lib/format.js';
import { httpError } from '../lib/http.js';
import { buyProblem, getItem } from './items.js';
import { insertRating } from './credit.js';

export const STATUS = {
  paid: { label: '买家已付款，等待卖家发货', short: '等待发货', color: '#ff6600' },
  shipped: { label: '卖家已发货，等待买家确认收货', short: '卖家已发货', color: '#ff6600' },
  done: { label: '交易成功', short: '交易成功', color: '#1a8a1a' },
  closed: { label: '交易关闭', short: '交易关闭', color: '#999999' },
};
export const SHIP = {
  post: { label: '平邮 (5-10 天)', fee: 0 },
  ems: { label: 'EMS (2-3 天)', fee: 2000 },
};
export const LOGISTICS = ['中国邮政平邮', 'EMS', '申通快递', '圆通速递', '中通快递', '宅急送', '其他'];
export const MAX_ADDRESSES = 8;

// 支付宝记账（演示资金）。amount 为负数时余额不足会抛错。在调用方事务里执行。
export function alipay(db, userId, amount, text, orderNo = '', at = now()) {
  const r = amount < 0
    ? db.prepare('UPDATE users SET balance_cents = balance_cents + ? WHERE id = ? AND balance_cents >= ?').run(amount, userId, -amount)
    : db.prepare('UPDATE users SET balance_cents = balance_cents + ? WHERE id = ?').run(amount, userId);
  if (!r.changes) throw httpError(400, '支付宝账户余额不足');
  const balance = db.prepare('SELECT balance_cents FROM users WHERE id = ?').get(userId).balance_cents;
  db.prepare('INSERT INTO alipay_logs (user_id, amount_cents, balance_cents, order_no, text, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(userId, amount, balance, orderNo, text, at);
  return balance;
}

export function orderLog(db, orderId, actor, text, at = now()) {
  db.prepare('INSERT INTO order_logs (order_id, actor, text, created_at) VALUES (?, ?, ?, ?)').run(orderId, actor, text, at);
}

export function newOrderNo(db) {
  const exists = db.prepare('SELECT 1 FROM orders WHERE no = ?');
  let no;
  do { no = `TB${crypto.randomInt(10000000, 100000000)}`; } while (exists.get(no));
  return no;
}

// 买家或卖家本人才能看订单；别人一律当作不存在（404），不泄露订单号是否存在
export function orderFor(db, no, user) {
  if (typeof no !== 'string' || !/^TB\d{8}$/.test(no)) return null;
  const o = db.prepare(`SELECT o.*, b.username AS buyer_name, s.username AS seller_name
    FROM orders o JOIN users b ON b.id = o.buyer_id JOIN users s ON s.id = o.seller_id WHERE o.no = ?`).get(no);
  if (!o) return null;
  if (user && (user.role === 'admin' || o.buyer_id === user.id || o.seller_id === user.id)) return o;
  return null;
}

export function orderItems(db, orderId) {
  return db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(orderId);
}

// 下单：lines = [{ itemId, qty }]，opts = { receiver, address, tel, ship: { sellerId: 'post'|'ems' }, note: { sellerId: '...' }, fromCart }
// 在一个事务里：校验每件宝贝 → 按卖家拆单 → 校验余额 → 扣款 → 建订单和快照 → 扣库存加销量 → 清购物车 → 保存地址
export function placeOrders(ctx, buyer, lines, opts) {
  const { db } = ctx;
  return db.transaction(() => {
    const t = now();
    const groups = new Map();
    for (const { itemId, qty } of lines) {
      const item = getItem(db, itemId);
      const problem = buyProblem(item, buyer);
      if (problem) throw httpError(400, `「${item?.title || '宝贝'}」${problem.replace(/^该宝贝/, '')}`);
      if (!Number.isInteger(qty) || qty < 1 || qty > 99) throw httpError(400, `「${item.title}」购买数量不正确`);
      if (item.stock < qty) throw httpError(400, `「${item.title}」库存只剩 ${item.stock} 件，请调整数量`);
      if (!groups.has(item.seller_id)) groups.set(item.seller_id, { sellerId: item.seller_id, sellerName: item.seller_name, lines: [] });
      groups.get(item.seller_id).lines.push({ item, qty });
    }
    if (!groups.size) throw httpError(400, '没有可以结算的宝贝');

    const plans = [...groups.values()].map((g) => {
      const ship = opts.ship?.[g.sellerId] === 'ems' ? 'ems' : 'post';
      const goods = g.lines.reduce((a, l) => a + l.item.price_cents * l.qty, 0);
      const fee = SHIP[ship].fee;
      return { ...g, ship, goods, fee, total: goods + fee, note: opts.note?.[g.sellerId] || '' };
    });
    const grand = plans.reduce((a, p) => a + p.total, 0);
    const balance = db.prepare('SELECT balance_cents FROM users WHERE id = ?').get(buyer.id).balance_cents;
    if (balance < grand) throw httpError(400, `支付宝账户余额不足：需要支付 ￥${(grand / 100).toFixed(2)}，余额 ￥${(balance / 100).toFixed(2)}`);

    const insOrder = db.prepare(`INSERT INTO orders (no, buyer_id, seller_id, goods_cents, ship, ship_fee_cents, total_cents, receiver, address, tel, note, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'paid', ?)`);
    const insItem = db.prepare('INSERT INTO order_items (order_id, item_id, title, cat, image, price_cents, qty) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const takeStock = db.prepare('UPDATE items SET stock = stock - ?, sold = sold + ? WHERE id = ? AND stock >= ?');
    const nos = [];
    for (const p of plans) {
      const no = newOrderNo(db);
      const orderId = insOrder.run(no, buyer.id, p.sellerId, p.goods, p.ship, p.fee, p.total, opts.receiver, opts.address, opts.tel, p.note, t).lastInsertRowid;
      for (const { item, qty } of p.lines) {
        if (!takeStock.run(qty, qty, item.id, qty).changes) throw httpError(409, `「${item.title}」刚刚被别人买走了，库存不足`);
        insItem.run(orderId, item.id, item.title, item.cat, item.cover, item.price_cents, qty);
        if (opts.fromCart) db.prepare('DELETE FROM carts WHERE owner_key = ? AND item_id = ?').run(`u:${buyer.id}`, item.id);
      }
      alipay(db, buyer.id, -p.total, `付款给卖家 ${p.sellerName}（担保交易，确认收货后打给卖家）`, no, t);
      orderLog(db, orderId, buyer.username, `买家拍下宝贝并通过支付宝付款 ￥${(p.total / 100).toFixed(2)}`, t);
      nos.push(no);
    }
    saveAddress(db, buyer.id, opts, t);
    return nos;
  })();
}

export function saveAddress(db, userId, { receiver, address, tel }, t = now()) {
  const same = db.prepare('SELECT id FROM addresses WHERE user_id = ? AND receiver = ? AND address = ? AND tel = ?').get(userId, receiver, address, tel);
  if (same) return db.prepare('UPDATE addresses SET updated_at = ? WHERE id = ?').run(t, same.id);
  db.prepare('INSERT INTO addresses (user_id, receiver, address, tel, updated_at) VALUES (?, ?, ?, ?, ?)').run(userId, receiver, address, tel, t);
  db.prepare('DELETE FROM addresses WHERE user_id = ? AND id NOT IN (SELECT id FROM addresses WHERE user_id = ? ORDER BY updated_at DESC, id DESC LIMIT ?)').run(userId, userId, MAX_ADDRESSES);
}

// 状态迁移都用「WHERE status = 旧状态」的条件更新，重复提交或并发只会有一次生效
function transition(db, order, from, set, params) {
  const froms = Array.isArray(from) ? from : [from];
  const r = db.prepare(`UPDATE orders SET ${set} WHERE id = ? AND status IN (${froms.map(() => '?').join(',')})`).run(...params, order.id, ...froms);
  if (!r.changes) {
    const cur = db.prepare('SELECT status FROM orders WHERE id = ?').get(order.id)?.status;
    throw httpError(409, `订单当前状态是「${STATUS[cur]?.short || cur}」，不能进行这个操作`);
  }
}

export function shipOrder(ctx, order, { company, trackingNo }, actorName) {
  const { db, config } = ctx;
  db.transaction(() => {
    const t = now();
    transition(db, order, 'paid', "status = 'shipped', shipped_at = ?, auto_confirm_at = ?, logistics_company = ?, logistics_no = ?",
      [t, t + config.autoConfirmDays * 86400, company, trackingNo]);
    orderLog(db, order.id, actorName, `卖家已发货：${company}${trackingNo ? ` 运单号 ${trackingNo}` : ''}`, t);
  })();
}

export function confirmOrder(ctx, order, actorName, { system = false } = {}) {
  const { db } = ctx;
  db.transaction(() => {
    const t = now();
    transition(db, order, 'shipped', "status = 'done', done_at = ?", [t]);
    alipay(db, order.seller_id, order.total_cents, `交易成功，买家确认收货，货款到账`, order.no, t);
    orderLog(db, order.id, actorName, system ? '买家超时未确认，系统自动确认收货，货款已打给卖家' : '买家确认收货，支付宝已把货款打给卖家', t);
  })();
}

// 关闭交易并退款。by：buyer 买家取消 / seller 卖家关闭（只限未发货）/ admin 淘宝小二处理纠纷（未发货或已发货）
export function closeOrder(ctx, order, { by, actorName, reason }) {
  const { db } = ctx;
  const from = by === 'admin' ? ['paid', 'shipped'] : ['paid'];
  db.transaction(() => {
    const t = now();
    transition(db, order, from, "status = 'closed', closed_at = ?, closed_by = ?, close_reason = ?", [t, by, reason]);
    alipay(db, order.buyer_id, order.total_cents, `交易关闭，货款退回（${reason}）`, order.no, t);
    const back = db.prepare('UPDATE items SET stock = MIN(9999, stock + ?), sold = MAX(0, sold - ?) WHERE id = ?');
    for (const it of orderItems(db, order.id)) back.run(it.qty, it.qty, it.item_id);
    const who = { buyer: '买家取消了交易', seller: '卖家关闭了交易', admin: '淘宝小二关闭了交易' }[by];
    orderLog(db, order.id, actorName, `${who}：${reason}。货款已退回买家支付宝，库存已退回`, t);
  })();
}

// 发货超过期限买家还没确认的，系统自动确认收货
export function autoConfirm(ctx) {
  const due = ctx.db.prepare("SELECT * FROM orders WHERE status = 'shipped' AND auto_confirm_at IS NOT NULL AND auto_confirm_at <= ? LIMIT 200").all(now());
  let n = 0;
  for (const o of due) {
    try { confirmOrder(ctx, o, '系统', { system: true }); n++; } catch { /* 并发下已被确认 */ }
  }
  return n;
}

// 评价：交易成功后买家评卖家、卖家评买家，各一次
export function rateOrder(ctx, order, user, { grade, text }) {
  const { db } = ctx;
  if (order.status !== 'done') throw httpError(400, '交易成功后才能评价');
  const asBuyer = order.buyer_id === user.id;
  const asSeller = order.seller_id === user.id;
  if (!asBuyer && !asSeller) throw httpError(404, '订单不存在');
  const role = asBuyer ? 'seller' : 'buyer';
  const first = orderItems(db, order.id)[0];
  db.transaction(() => {
    if (db.prepare('SELECT 1 FROM ratings WHERE order_id = ? AND role = ?').get(order.id, role)) throw httpError(409, '这笔交易您已经评价过了');
    insertRating(db, {
      orderId: order.id, itemId: first?.item_id ?? null, itemTitle: first?.title ?? '', role,
      fromId: user.id, toId: asBuyer ? order.seller_id : order.buyer_id, grade, text,
    });
    orderLog(db, order.id, user.username, asBuyer ? '买家对卖家做出了评价' : '卖家对买家做出了评价');
  })();
}

export function ratingsOfOrder(db, orderId) {
  const rows = db.prepare('SELECT * FROM ratings WHERE order_id = ?').all(orderId);
  return { bySeller: rows.find((r) => r.role === 'buyer') || null, byBuyer: rows.find((r) => r.role === 'seller') || null };
}
