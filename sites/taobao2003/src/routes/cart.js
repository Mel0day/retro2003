import { Router } from 'express';
import { intParam, intIn, httpError } from '../lib/http.js';
import { line, TEL_RE } from '../lib/text.js';
import { requireLogin } from '../services/auth.js';
import { getItem, buyProblem } from '../services/items.js';
import { ownerKey, cartQty, setQty, cartView, MAX_QTY } from '../services/cart.js';
import { placeOrders, SHIP, orderFor, orderItems } from '../services/orders.js';

export default function cartRoutes(ctx) {
  const { db, limiter } = ctx;
  const r = Router();
  const tooFast = (req) => !limiter.check(`cart:${req.user ? req.user.id : req.ip}`, 120, 60_000);

  // 加入购物车（列表页、详情页、店铺页）
  r.post('/cart/add', (req, res) => {
    if (tooFast(req)) return res.message({ title: '请稍候', text: '操作太频繁，请稍后再试。', ok: false, status: 429 });
    const item = getItem(db, intParam(req.body.item_id));
    const problem = buyProblem(item, req.user);
    if (problem) return res.message({ title: '无法加入购物车', text: problem, ok: false, status: 400 });
    const key = ownerKey(req);
    const have = cartQty(db, key, item.id);
    const want = intIn(req.body.qty, 1, MAX_QTY) ?? 1;
    const qty = Math.min(want, item.stock - have, MAX_QTY - have);
    if (qty < 1) return res.message({ title: '库存不足', text: `购物车里已经有 ${have} 件，该宝贝库存只有 ${item.stock} 件。`, ok: false, status: 400 });
    setQty(db, key, item.id, have + qty);
    if (req.body.from === 'item') return res.redirect(`/item/${item.id}?added=${qty}`);
    res.redirect('/cart');
  });

  r.get('/cart', (req, res) => {
    const cart = cartView(db, ownerKey(req), req.user);
    res.render('cart.njk', { title: '我的购物车', crumbs: [{ text: '我的购物车' }], nav: 'cart', cart });
  });

  r.post('/cart/update', (req, res) => {
    if (tooFast(req)) return res.message({ title: '请稍候', text: '操作太频繁，请稍后再试。', ok: false, status: 429 });
    const key = ownerKey(req);
    const itemId = intParam(req.body.item_id);
    const have = cartQty(db, key, itemId);
    if (!have) return res.redirect('/cart');
    const item = getItem(db, itemId);
    const op = req.body.op;
    let qty = op === 'plus' ? have + 1 : op === 'minus' ? have - 1 : (intIn(req.body.qty, 1, MAX_QTY) ?? have);
    // 减到 1 件为止（删除用「删除」）；加不超过库存
    const cap = Math.max(1, Math.min(item?.stock ?? 1, MAX_QTY));
    qty = Math.max(1, Math.min(qty, op === 'minus' ? have : cap));
    setQty(db, key, itemId, qty);
    res.redirect('/cart');
  });

  r.post('/cart/remove', (req, res) => {
    setQty(db, ownerKey(req), intParam(req.body.item_id), 0);
    res.redirect('/cart');
  });

  // ---------- 结算 ----------
  // 两个来源：购物车（source=cart，结算其中没有问题的宝贝）或「立刻购买」（source=buy，单件，不动购物车）
  function checkoutLines(req, src) {
    if (src.source === 'buy') {
      const item = getItem(db, intParam(src.item));
      const qty = intIn(src.qty, 1, MAX_QTY) ?? 1;
      const problem = buyProblem(item, req.user);
      if (problem) throw httpError(400, problem);
      if (item.stock < qty) throw httpError(400, `库存只剩 ${item.stock} 件，请调整购买数量。`);
      return {
        source: 'buy', itemId: item.id, qty,
        groups: [{ seller_id: item.seller_id, seller_name: item.seller_name, lines: [{ ...item, qty, sub_cents: item.price_cents * qty }] }],
      };
    }
    const cart = cartView(db, `u:${req.user.id}`, req.user);
    const groups = cart.groups.map((g) => ({ ...g, lines: g.lines.filter((l) => !l.problem) })).filter((g) => g.lines.length);
    return { source: 'cart', groups, skipped: cart.rows.filter((l) => l.problem) };
  }

  function checkoutPage(req, res, src, form = {}, err = '', status = 200) {
    let data;
    try { data = checkoutLines(req, src); } catch (e) {
      if (e.status === 400) return res.message({ title: '无法购买', text: e.message, ok: false, status: 400 });
      throw e;
    }
    if (!data.groups.length) {
      const why = (data.skipped || []).map((l) => `「${l.title}」${l.problem}`).join('；');
      return res.message({ title: '没有可结算的宝贝', text: why ? `${why}。请回购物车调整后再结算。` : '购物车是空的，先去挑几件宝贝吧。', ok: false, redirect: '/cart' });
    }
    const addresses = db.prepare('SELECT * FROM addresses WHERE user_id = ? ORDER BY updated_at DESC, id DESC').all(req.user.id);
    const last = addresses[0];
    const groups = data.groups.map((g) => {
      const ship = form.ship?.[g.seller_id] === 'ems' ? 'ems' : 'post';
      const goods = g.lines.reduce((a, l) => a + l.sub_cents, 0);
      return { ...g, ship, goods, fee: SHIP[ship].fee, total: goods + SHIP[ship].fee, note: form.note?.[g.seller_id] || '' };
    });
    const me = db.prepare('SELECT balance_cents FROM users WHERE id = ?').get(req.user.id);
    res.status(status).render('checkout.njk', {
      title: '确认订单', crumbs: [{ text: '我的购物车', url: '/cart' }, { text: '确认订单' }], nav: 'cart',
      data, groups, grand: groups.reduce((a, g) => a + g.total, 0), balance: me.balance_cents, addresses,
      addr: {
        receiver: form.receiver ?? last?.receiver ?? '',
        address: form.address ?? last?.address ?? '',
        tel: form.tel ?? last?.tel ?? '',
      },
      err,
    });
  }

  r.get('/checkout', requireLogin, (req, res) => {
    checkoutPage(req, res, { source: req.query.item ? 'buy' : 'cart', item: req.query.item, qty: req.query.qty });
  });

  r.post('/checkout', requireLogin, (req, res) => {
    const b = req.body;
    const src = { source: b.source === 'buy' ? 'buy' : 'cart', item: b.item, qty: b.qty };
    const ship = {}, note = {};
    for (const [k, v] of Object.entries(b)) {
      const m = /^(ship|note)_(\d{1,9})$/.exec(k);
      if (!m) continue;
      if (m[1] === 'ship') ship[m[2]] = v === 'ems' ? 'ems' : 'post';
      else note[m[2]] = line(v, 100);
    }
    const form = { receiver: line(b.receiver, 20), address: line(b.address, 120), tel: line(b.tel, 20), ship, note };
    const fail = (msg, status = 200) => checkoutPage(req, res, src, form, msg, status);
    if (!limiter.check(`checkout:${req.user.id}`, 20, 600_000)) return fail('下单太频繁了，请 10 分钟后再试。', 429);
    if ([...form.receiver].length < 2) return fail('请填写收货人姓名（至少 2 个字）');
    if ([...form.address].length < 8) return fail('请填写详细的收货地址（至少 8 个字，写到门牌号）');
    if (!TEL_RE.test(form.tel)) return fail('联系电话格式不对，请填写手机或带区号的固定电话');
    let data;
    try { data = checkoutLines(req, src); } catch (e) {
      if (e.status === 400) return fail(e.message);
      throw e;
    }
    const lines = data.groups.flatMap((g) => g.lines.map((l) => ({ itemId: l.id, qty: l.qty })));
    if (!lines.length) return fail('没有可以结算的宝贝');
    // 防止结算页打开后价格被卖家修改：页面上显示的应付总额要和现在一致
    const expected = intIn(b.expect_cents, 1, 999999999);
    const nowTotal = data.groups.reduce((a, g) => a + g.lines.reduce((x, l) => x + l.sub_cents, 0) + SHIP[ship[g.seller_id] === 'ems' ? 'ems' : 'post'].fee, 0);
    if (expected !== null && expected !== nowTotal) return fail('宝贝价格或数量刚刚发生了变化，请核对后重新提交。');
    let nos;
    try {
      nos = placeOrders(ctx, req.user, lines, { receiver: form.receiver, address: form.address, tel: form.tel, ship, note, fromCart: src.source === 'cart' });
    } catch (e) {
      if (e.status === 400 || e.status === 409) return fail(e.message);
      throw e;
    }
    res.redirect(`/order/success?${nos.map((n) => `no=${n}`).join('&')}`);
  });

  r.get('/order/success', requireLogin, (req, res) => {
    const nos = [].concat(req.query.no || []).filter((n) => typeof n === 'string').slice(0, 20);
    const orders = nos.map((no) => orderFor(db, no, req.user)).filter((o) => o && o.buyer_id === req.user.id)
      .map((o) => ({ ...o, items: orderItems(db, o.id) }));
    if (!orders.length) throw httpError(404, '订单不存在。');
    const me = db.prepare('SELECT balance_cents FROM users WHERE id = ?').get(req.user.id);
    res.render('success.njk', { title: '付款成功', crumbs: [{ text: '付款成功' }], nav: 'orders', orders, total: orders.reduce((a, o) => a + o.total_cents, 0), balance: me.balance_cents });
  });

  return r;
}
