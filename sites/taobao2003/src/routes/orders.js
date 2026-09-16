import { Router } from 'express';
import { httpError } from '../lib/http.js';
import { line } from '../lib/text.js';
import { requireLogin } from '../services/auth.js';
import { orderFor, orderItems, shipOrder, confirmOrder, closeOrder, rateOrder, ratingsOfOrder, LOGISTICS } from '../services/orders.js';

export const CANCEL_REASONS = ['我不想买了', '信息填写错误，重新拍', '卖家缺货', '和卖家协商一致', '其他原因'];
export const CLOSE_REASONS = ['宝贝缺货', '买家要求取消', '宝贝信息有误', '其他原因'];

export default function orderRoutes(ctx) {
  const { db, limiter } = ctx;
  const r = Router();

  const load = (req) => {
    const o = orderFor(db, req.params.no, req.user);
    if (!o) throw httpError(404, '订单不存在。');
    return o;
  };
  const done = (res, o, text) => res.message({ title: '操作成功', text, redirect: `/order/${o.no}` });
  const act = (fn) => (req, res) => {
    if (!limiter.check(`order-act:${req.user.id}`, 60, 600_000)) return res.message({ title: '请稍候', text: '操作太频繁，请稍后再试。', ok: false, status: 429 });
    try { fn(req, res, load(req)); } catch (e) {
      if (e.status === 409 || e.status === 400) return res.message({ title: '操作失败', text: e.message, ok: false, status: e.status });
      throw e;
    }
  };

  r.get('/order/:no', requireLogin, (req, res) => {
    const o = load(req);
    const role = o.buyer_id === req.user.id ? 'buyer' : o.seller_id === req.user.id ? 'seller' : 'admin';
    const logs = db.prepare('SELECT * FROM order_logs WHERE order_id = ? ORDER BY created_at, id').all(o.id);
    res.render('order.njk', {
      title: `订单 ${o.no}`,
      crumbs: [role === 'seller' ? { text: '已卖出的宝贝', url: '/my/sold' } : { text: '已买到的宝贝', url: '/my/bought' }, { text: o.no }],
      nav: 'orders', o, role, items: orderItems(db, o.id), logs, ...ratingsOfOrder(db, o.id),
      LOGISTICS, CANCEL_REASONS, CLOSE_REASONS,
    });
  });

  // 买家：取消（未发货）
  r.post('/order/:no/cancel', requireLogin, act((req, res, o) => {
    if (o.buyer_id !== req.user.id) throw httpError(404, '订单不存在。');
    const reason = CANCEL_REASONS.includes(req.body.reason) ? req.body.reason : '我不想买了';
    closeOrder(ctx, o, { by: 'buyer', actorName: req.user.username, reason });
    done(res, o, `交易已取消，￥${(o.total_cents / 100).toFixed(2)} 已退回您的支付宝账户。`);
  }));

  // 买家：确认收货
  r.post('/order/:no/confirm', requireLogin, act((req, res, o) => {
    if (o.buyer_id !== req.user.id) throw httpError(404, '订单不存在。');
    confirmOrder(ctx, o, req.user.username);
    res.message({ title: '交易成功', text: '您已确认收货，支付宝已把货款打给卖家。别忘了给卖家一个评价！', redirect: `/order/${o.no}#rate` });
  }));

  // 卖家：发货
  r.post('/order/:no/ship', requireLogin, act((req, res, o) => {
    if (o.seller_id !== req.user.id) throw httpError(404, '订单不存在。');
    const company = LOGISTICS.includes(req.body.company) ? req.body.company : '';
    const trackingNo = line(req.body.tracking_no, 30);
    if (!company) throw httpError(400, '请选择物流公司');
    if (trackingNo && !/^[A-Za-z0-9-]{4,30}$/.test(trackingNo)) throw httpError(400, '运单号只能是字母、数字和横线');
    shipOrder(ctx, o, { company, trackingNo }, req.user.username);
    done(res, o, '已发货，等待买家确认收货。');
  }));

  // 卖家：关闭交易（未发货，货款退回买家）
  r.post('/order/:no/close', requireLogin, act((req, res, o) => {
    if (o.seller_id !== req.user.id) throw httpError(404, '订单不存在。');
    const reason = CLOSE_REASONS.includes(req.body.reason) ? req.body.reason : '其他原因';
    closeOrder(ctx, o, { by: 'seller', actorName: req.user.username, reason });
    done(res, o, '交易已关闭，货款已退回买家的支付宝账户，库存已恢复。');
  }));

  // 双方：评价
  r.post('/order/:no/rate', requireLogin, act((req, res, o) => {
    if (o.buyer_id !== req.user.id && o.seller_id !== req.user.id) throw httpError(404, '订单不存在。');
    const grade = ['1', '0', '-1'].includes(req.body.grade) ? Number(req.body.grade) : null;
    if (grade === null) throw httpError(400, '请选择好评、中评或差评');
    const text = line(req.body.text, 200);
    if (grade !== 1 && [...text].length < 5) throw httpError(400, '给中评或差评时，请写明原因（至少 5 个字）');
    rateOrder(ctx, o, req.user, { grade, text: text || '好评！' });
    done(res, o, '评价成功，感谢您的反馈。');
  }));

  // 被评价方解释（每条评价一次）
  r.post('/order/:no/reply', requireLogin, act((req, res, o) => {
    const rating = db.prepare('SELECT * FROM ratings WHERE order_id = ? AND to_id = ?').get(o.id, req.user.id);
    if (!rating) throw httpError(400, '对方还没有评价您');
    if (rating.reply) throw httpError(409, '已经解释过了');
    const text = line(req.body.text, 200);
    if ([...text].length < 2) throw httpError(400, '解释内容至少 2 个字');
    db.prepare("UPDATE ratings SET reply = ? WHERE id = ? AND reply = ''").run(text, rating.id);
    done(res, o, '解释已发布。');
  }));

  return r;
}
