import express from 'express';
import * as shop from '../../services/shop.js';
import { requireRole } from '../../services/auth.js';
import { paginate } from '../../lib/pager.js';
import { memoryUpload, saveImage } from '../../lib/uploads.js';
import { safeUrl } from '../../lib/ubb.js';
import { httpError, intParam } from '../../lib/http.js';

// 后台：商品管理、订单管理（仅站长）
export default function adminShop(ctx) {
  const r = express.Router();
  const { db } = ctx;
  r.use(['/products', '/orders'], requireRole('admin'));

  const back = (res, url, msg, isErr = false) => res.redirect(303, `${url}${url.includes('?') ? '&' : '?'}${isErr ? 'err' : 'msg'}=${encodeURIComponent(msg)}`);

  // ---------- 商品 ----------
  r.get('/products', (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 50);
    const category = String(req.query.category || '');
    const status = ['on', 'off'].includes(req.query.status) ? req.query.status : '';
    const where = ['1 = 1'];
    const args = [];
    if (q) { where.push("name LIKE ? ESCAPE '\\'"); args.push(`%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`); }
    if (category) { where.push('category = ?'); args.push(category); }
    if (status) { where.push('status = ?'); args.push(status); }
    const total = db.prepare(`SELECT COUNT(*) AS n FROM products WHERE ${where.join(' AND ')}`).get(...args).n;
    const qs = new URLSearchParams(Object.entries({ q, category, status }).filter(([, v]) => v));
    const pager = paginate({ total, page: req.query.page, perPage: 20, baseUrl: `/admin/products?${qs}` });
    const products = db.prepare(`SELECT * FROM products WHERE ${where.join(' AND ')} ORDER BY sort, id LIMIT ? OFFSET ?`).all(...args, 20, pager.offset);
    res.render('admin/products.njk', {
      title: '商品管理', adminNav: 'products', products, pager, q, category, status,
      categories: shop.listCategories(ctx, { includeOff: true }),
    });
  });

  const formPage = (res, data) => res.render('admin/products-form.njk', {
    adminNav: 'products', categories: shop.listCategories(ctx, { includeOff: true }), ...data,
  });

  r.get('/products/new', (req, res) => {
    formPage(res, { title: '新增商品', product: { status: 'on', stock: 100, sort: 0, featured: 0 }, action: '/admin/products' });
  });

  function readProduct(req) {
    const b = req.body || {};
    const name = String(b.name || '').trim();
    const category = String(b.category || '').trim().slice(0, 20);
    const price = shop.parseYuan(b.price);
    const market = String(b.market_price ?? '').trim() === '' ? 0 : shop.parseYuan(b.market_price, { allowZero: true });
    const stock = /^\d{1,6}$/.test(String(b.stock ?? '').trim()) ? Number(b.stock) : NaN;
    const sort = /^-?\d{1,6}$/.test(String(b.sort ?? '0').trim() || '0') ? Number(String(b.sort ?? '0').trim() || 0) : NaN;
    const description = String(b.description || '').replace(/\r\n?/g, '\n').trim();
    const form = {
      name, category, stock: b.stock, sort: b.sort, description, image: String(b.image || '').trim(),
      featured: b.featured === '1' ? 1 : 0, status: b.status === 'off' ? 'off' : 'on',
      price_cents: price, market_price_cents: market, priceInput: b.price, marketInput: b.market_price,
    };
    let error = '';
    if ([...name].length < 2 || [...name].length > 60) error = '商品名称需为 2-60 个字';
    else if (price === null) error = '请填写正确的价格（大于 0，最多两位小数）';
    else if (market === null) error = '市场价格式不正确';
    else if (!Number.isInteger(stock)) error = '库存需为 0-999999 的整数';
    else if (!Number.isInteger(sort)) error = '排序需为整数';
    else if (description.length > 20000) error = '商品介绍太长了';
    else if (form.image && !safeUrl(form.image, { image: true })) error = '图片地址格式不正确';
    if (!error && req.file) {
      const saved = saveImage(ctx, { buffer: req.file.buffer, userId: req.user.id, purpose: 'product' });
      form.image = saved.url;
    }
    return { form, error, stock, sort };
  }

  r.post('/products', memoryUpload.single('image_file'), (req, res) => {
    const { form, error, stock, sort } = readProduct(req);
    if (error) return formPage(res.status(400), { title: '新增商品', product: form, action: '/admin/products', error });
    const id = db.prepare(`INSERT INTO products (category, name, price_cents, market_price_cents, stock, image, description, featured, status, sort)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(form.category, form.name, form.price_cents, form.market_price_cents, stock,
      form.image, form.description, form.featured, form.status, sort).lastInsertRowid;
    back(res, `/admin/products/${id}/edit`, '商品已添加');
  });

  const loadProduct = (req) => {
    const p = shop.getProduct(ctx, intParam(req.params.id));
    if (!p) throw httpError(404, '商品不存在');
    return p;
  };

  r.get('/products/:id/edit', (req, res) => {
    const p = loadProduct(req);
    formPage(res, { title: `编辑商品：${p.name}`, product: p, action: `/admin/products/${p.id}`, editing: p });
  });

  r.post('/products/:id', memoryUpload.single('image_file'), (req, res) => {
    const p = loadProduct(req);
    const { form, error, stock, sort } = readProduct(req);
    if (error) return formPage(res.status(400), { title: `编辑商品：${p.name}`, product: { ...p, ...form }, action: `/admin/products/${p.id}`, editing: p, error });
    db.prepare(`UPDATE products SET category = ?, name = ?, price_cents = ?, market_price_cents = ?, stock = ?, image = ?,
      description = ?, featured = ?, status = ?, sort = ? WHERE id = ?`).run(form.category, form.name, form.price_cents,
      form.market_price_cents, stock, form.image, form.description, form.featured, form.status, sort, p.id);
    back(res, `/admin/products/${p.id}/edit`, '商品已保存');
  });

  r.post('/products/:id/toggle', (req, res) => {
    const p = loadProduct(req);
    const next = p.status === 'on' ? 'off' : 'on';
    db.prepare('UPDATE products SET status = ? WHERE id = ?').run(next, p.id);
    const to = String(req.body.back || '');
    let url = '/admin/products';
    if (to.startsWith('/admin/products')) {
      const u = new URL(to, 'http://x');
      u.searchParams.delete('msg');
      u.searchParams.delete('err');
      url = u.pathname + (u.search || '');
    }
    back(res, url, next === 'on' ? `「${p.name}」已上架` : `「${p.name}」已下架`);
  });

  r.post('/products/:id/delete', (req, res) => {
    const p = loadProduct(req);
    db.prepare('DELETE FROM products WHERE id = ?').run(p.id);
    back(res, '/admin/products', `「${p.name}」已删除，历史订单保留`);
  });

  // ---------- 订单 ----------
  r.get('/orders', (req, res) => {
    const status = Object.hasOwn(shop.STATUS_LABELS, req.query.status) ? req.query.status : '';
    const q = String(req.query.q || '').trim().slice(0, 50);
    const where = ['1 = 1'];
    const args = [];
    if (status) { where.push('o.status = ?'); args.push(status); }
    if (q) {
      const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
      where.push("(o.order_no LIKE ? ESCAPE '\\' OR o.receiver LIKE ? ESCAPE '\\' OR o.phone LIKE ? ESCAPE '\\' OR u.username LIKE ? ESCAPE '\\')");
      args.push(like, like, like, like);
    }
    const total = db.prepare(`SELECT COUNT(*) AS n FROM orders o JOIN users u ON u.id = o.user_id WHERE ${where.join(' AND ')}`).get(...args).n;
    const qs = new URLSearchParams(Object.entries({ status, q }).filter(([, v]) => v));
    const pager = paginate({ total, page: req.query.page, perPage: 20, baseUrl: `/admin/orders?${qs}` });
    const orders = db.prepare(`SELECT o.*, u.username FROM orders o JOIN users u ON u.id = o.user_id
      WHERE ${where.join(' AND ')} ORDER BY o.created_at DESC, o.id DESC LIMIT ? OFFSET ?`).all(...args, 20, pager.offset);
    const counts = Object.fromEntries(db.prepare('SELECT status, COUNT(*) AS n FROM orders GROUP BY status').all().map((x) => [x.status, x.n]));
    res.render('admin/orders.njk', {
      title: '订单管理', adminNav: 'orders', orders, pager, status, q, counts,
      statusLabels: shop.STATUS_LABELS, paymentLabels: shop.PAYMENT_LABELS,
    });
  });

  r.get('/orders/:orderNo', (req, res) => {
    const order = shop.getOrder(ctx, req.params.orderNo);
    if (!order) throw httpError(404, '订单不存在');
    res.render('admin/orders-detail.njk', {
      title: `订单 ${order.order_no}`, adminNav: 'orders', order,
      product: order.product_id ? shop.getProduct(ctx, order.product_id) : null,
      statusLabels: shop.STATUS_LABELS, paymentLabels: shop.PAYMENT_LABELS,
      flow: shop.orderFlow(order.status), actions: shop.allowedActions(order.status),
    });
  });

  r.post('/orders/:orderNo/status', (req, res) => {
    const order = shop.getOrder(ctx, req.params.orderNo);
    if (!order) throw httpError(404, '订单不存在');
    const url = `/admin/orders/${order.order_no}`;
    try {
      shop.adminUpdateOrder(ctx, order, String(req.body.action || ''), { trackingNo: req.body.tracking_no });
      back(res, url, '订单状态已更新，已通知买家');
    } catch (e) {
      if (!(e instanceof shop.ValidationError)) throw e;
      back(res, url, e.message, true);
    }
  });

  return r;
}
