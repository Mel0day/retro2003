// 购物业务：分类、下单扣库存、取消恢复库存、订单状态流转与通知
import crypto from 'node:crypto';
import { now, dayKey, yuan } from '../lib/format.js';
import { sendSystemMessage } from './points.js';
import { ValidationError } from './notes.js';

export { ValidationError };

export const STATUS_LABELS = {
  pending: '待确认', confirmed: '已确认', shipped: '已发货', done: '已完成', cancelled: '已取消',
};
export const STATUS_FLOW = ['pending', 'confirmed', 'shipped', 'done'];

export const PAYMENT_LABELS = { cod: '货到付款', postal: '邮局汇款', bank: '银行转账' };

export function paymentTip(payment, site) {
  const name = site?.site_name || '本站';
  return {
    cod: '快递员送货上门时当面付款，请保持电话畅通。签收前请检查商品是否完好。',
    postal: `请在 3 天内到邮局汇款，收款人：${name}社区，汇款附言请填写订单号。汇款后站长会在 1-2 个工作日内确认。`,
    bank: '请在 3 天内完成银行转账，转账附言请填写订单号，转账后可发短消息给站长告知汇款人姓名，便于核对。',
  }[payment] || '';
}

// 「19.9」→ 1990 分；非法返回 null
export function parseYuan(v, { allowZero = false } = {}) {
  const s = String(v ?? '').trim();
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(s)) return null;
  const cents = Math.round(parseFloat(s) * 100);
  if (!allowZero && cents <= 0) return null;
  return cents;
}

export function listCategories(ctx, { includeOff = false } = {}) {
  const where = includeOff ? '' : "WHERE status = 'on'";
  return ctx.db.prepare(`SELECT category AS name, COUNT(*) AS count FROM products ${where}
    GROUP BY category ORDER BY MIN(sort), MIN(id)`).all().filter((c) => c.name !== '');
}

export const getProduct = (ctx, id) => ctx.db.prepare('SELECT * FROM products WHERE id = ?').get(Number(id));

export const getOrder = (ctx, orderNo) => ctx.db.prepare(`
  SELECT o.*, u.username FROM orders o JOIN users u ON u.id = o.user_id WHERE o.order_no = ?`).get(String(orderNo));

function newOrderNo(ctx) {
  const day = dayKey().replace(/-/g, '');
  for (let i = 0; i < 20; i++) {
    const no = day + String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    if (!ctx.db.prepare('SELECT 1 FROM orders WHERE order_no = ?').get(no)) return no;
  }
  throw new Error('生成订单号失败');
}

export function validateOrderInput(input) {
  const qtyRaw = String(input.qty ?? '').trim();
  const qty = /^\d{1,3}$/.test(qtyRaw) ? Number(qtyRaw) : NaN;
  const receiver = String(input.receiver || '').trim();
  const phone = String(input.phone || '').trim();
  const address = String(input.address || '').trim();
  const payment = String(input.payment || '');
  const remark = String(input.remark || '').trim();
  if (!Number.isInteger(qty) || qty < 1 || qty > 99) throw new ValidationError('购买数量需为 1-99 件');
  if ([...receiver].length < 2 || [...receiver].length > 20) throw new ValidationError('请填写 2-20 个字的收货人姓名');
  if (!/^[0-9+\-() ]{7,20}$/.test(phone)) throw new ValidationError('请填写正确的联系电话（7-20 位数字）');
  if ([...address].length < 5 || [...address].length > 120) throw new ValidationError('请填写 5-120 个字的详细收货地址');
  if (!Object.hasOwn(PAYMENT_LABELS, payment)) throw new ValidationError('请选择付款方式');
  if ([...remark].length > 200) throw new ValidationError('备注不能超过 200 字');
  return { qty, receiver, phone, address, payment, remark };
}

export function placeOrder(ctx, { productId, user, input }) {
  const v = validateOrderInput(input);
  return ctx.db.transaction(() => {
    const p = getProduct(ctx, productId);
    if (!p || p.status !== 'on') throw new ValidationError('商品不存在或已下架');
    if (p.stock < v.qty) throw new ValidationError(p.stock > 0 ? `库存不足，目前只剩 ${p.stock} 件` : '该商品已经卖完了');
    const upd = ctx.db.prepare('UPDATE products SET stock = stock - ?, sales = sales + ? WHERE id = ? AND stock >= ?')
      .run(v.qty, v.qty, p.id, v.qty);
    if (!upd.changes) throw new ValidationError('库存不足，请减少购买数量');
    const orderNo = newOrderNo(ctx);
    const ts = now();
    ctx.db.prepare(`INSERT INTO orders (order_no, user_id, product_id, product_name, price_cents, qty, total_cents,
      receiver, phone, address, payment, remark, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(orderNo, user.id, p.id, p.name, p.price_cents, v.qty, p.price_cents * v.qty,
        v.receiver, v.phone, v.address, v.payment, v.remark, ts, ts);
    return getOrder(ctx, orderNo);
  })();
}

function restoreStock(ctx, order) {
  if (order.product_id) {
    ctx.db.prepare('UPDATE products SET stock = stock + ?, sales = MAX(0, sales - ?) WHERE id = ?')
      .run(order.qty, order.qty, order.product_id);
  }
}

export function cancelByUser(ctx, order) {
  if (order.status !== 'pending') throw new ValidationError('只有「待确认」的订单可以取消');
  ctx.db.transaction(() => {
    const info = ctx.db.prepare("UPDATE orders SET status = 'cancelled', updated_at = ? WHERE id = ? AND status = 'pending'").run(now(), order.id);
    if (info.changes) restoreStock(ctx, order);
  })();
}

// 后台状态操作：confirm / ship / done / cancel
const TRANSITIONS = {
  confirm: { from: ['pending'], to: 'confirmed', label: '确认订单' },
  ship: { from: ['confirmed'], to: 'shipped', label: '发货' },
  done: { from: ['shipped'], to: 'done', label: '完成' },
  cancel: { from: ['pending', 'confirmed'], to: 'cancelled', label: '取消订单' },
};

export function allowedActions(status) {
  return Object.entries(TRANSITIONS).filter(([, t]) => t.from.includes(status)).map(([k, t]) => ({ key: k, label: t.label }));
}

export function adminUpdateOrder(ctx, order, action, { trackingNo = '' } = {}) {
  const t = Object.hasOwn(TRANSITIONS, action) ? TRANSITIONS[action] : null;
  if (!t) throw new ValidationError('未知操作');
  if (!t.from.includes(order.status)) throw new ValidationError(`「${STATUS_LABELS[order.status]}」状态的订单不能执行该操作`);
  const tracking = String(trackingNo || '').trim();
  if (action === 'ship' && (tracking.length < 4 || tracking.length > 40)) throw new ValidationError('发货请填写 4-40 位快递单号');
  ctx.db.transaction(() => {
    const info = ctx.db.prepare(`UPDATE orders SET status = ?, tracking_no = CASE WHEN ? <> '' THEN ? ELSE tracking_no END,
      updated_at = ? WHERE id = ? AND status = ?`).run(t.to, tracking, tracking, now(), order.id, order.status);
    if (!info.changes) throw new ValidationError('订单状态已变化，请刷新后重试');
    if (action === 'cancel') restoreStock(ctx, order);
    const link = `[url=/my/orders/${order.order_no}]${order.order_no}[/url]`;
    const texts = {
      confirm: [`订单 ${order.order_no} 已确认`, `您的订单 ${link}（${order.product_name} × ${order.qty}）已确认，我们会尽快为您发货。`],
      ship: [`订单 ${order.order_no} 已发货`, `您的订单 ${link}（${order.product_name} × ${order.qty}）已发货，快递单号：${tracking}。`],
      done: [`订单 ${order.order_no} 已完成`, `您的订单 ${link} 已完成，感谢您的支持！欢迎在社区里发笔记分享使用心得。`],
      cancel: [`订单 ${order.order_no} 已取消`, `您的订单 ${link}（${order.product_name} × ${order.qty}，¥${yuan(order.total_cents)}）已被取消。如有疑问请联系站长。`],
    };
    sendSystemMessage(ctx, order.user_id, ...texts[action]);
  })();
}

// 订单进度条：[{ label, state: 'done' | 'cur' | 'todo' }]
export function orderFlow(status) {
  if (status === 'cancelled') return [{ label: '订单已取消', state: 'cur' }];
  const idx = STATUS_FLOW.indexOf(status);
  return STATUS_FLOW.map((s, i) => ({ label: STATUS_LABELS[s], state: i < idx ? 'done' : i === idx ? 'cur' : 'todo' }));
}
