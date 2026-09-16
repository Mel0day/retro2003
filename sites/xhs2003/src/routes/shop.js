import express from 'express';
import * as shop from '../services/shop.js';
import { requireLogin } from '../services/auth.js';
import { paginate } from '../lib/pager.js';
import { httpError, intParam } from '../lib/http.js';
import { RANK_BG } from '../services/portal.js';

const PER_PAGE = 12;
const SORTS = {
  default: 'sort, id',
  sales: 'sales DESC, id DESC',
  new: 'created_at DESC, id DESC',
  price_asc: 'price_cents ASC, id',
  price_desc: 'price_cents DESC, id',
};

export default function shopRoutes(ctx) {
  const r = express.Router();
  const { db, limiter } = ctx;

  const hotProducts = (limit = 8) => db.prepare(`SELECT id, name, sales, price_cents FROM products WHERE status = 'on'
    ORDER BY sales DESC, id LIMIT ?`).all(limit).map((p, i) => ({ ...p, rank: i + 1, bg: RANK_BG[Math.min(i, 2)], title: p.name, url: `/shop/${p.id}` }));

  r.get('/shop', (req, res) => {
    const categories = shop.listCategories(ctx);
    const category = categories.find((c) => c.name === req.query.category)?.name || '';
    const sort = Object.hasOwn(SORTS, req.query.sort) ? req.query.sort : 'default';
    const where = ["status = 'on'"];
    const args = [];
    if (category) { where.push('category = ?'); args.push(category); }
    const total = db.prepare(`SELECT COUNT(*) AS n FROM products WHERE ${where.join(' AND ')}`).get(...args).n;
    const qs = new URLSearchParams();
    if (category) qs.set('category', category);
    if (sort !== 'default') qs.set('sort', sort);
    const pager = paginate({ total, page: req.query.page, perPage: PER_PAGE, baseUrl: `/shop?${qs}` });
    const products = db.prepare(`SELECT * FROM products WHERE ${where.join(' AND ')} ORDER BY ${SORTS[sort]} LIMIT ? OFFSET ?`)
      .all(...args, PER_PAGE, pager.offset);
    const sortBase = category ? `category=${encodeURIComponent(category)}&` : '';
    res.render('shop/list.njk', {
      title: category || '购物', nav: 'shop',
      crumbs: category ? [['购物', '/shop'], [category]] : [['购物']],
      categories, category, sort, sortBase, products, pager,
      allCount: categories.reduce((s, c) => s + c.count, 0),
      hot: hotProducts(8),
    });
  });

  r.get('/shop/:id', (req, res) => {
    const product = shop.getProduct(ctx, intParam(req.params.id));
    if (!product || (product.status !== 'on' && req.user?.role !== 'admin')) throw httpError(404, '商品不存在或已下架');
    const related = db.prepare(`SELECT * FROM products WHERE status = 'on' AND category = ? AND id <> ? ORDER BY sales DESC LIMIT 4`)
      .all(product.category, product.id);
    res.render('shop/detail.njk', {
      title: product.name, nav: 'shop',
      crumbs: [['购物', '/shop'], ...(product.category ? [[product.category, `/shop?category=${encodeURIComponent(product.category)}`]] : []), [product.name]],
      product, related, hot: hotProducts(8), payments: shop.PAYMENT_LABELS,
      form: { qty: 1, payment: 'cod', receiver: '', phone: '', address: '', remark: '' },
    });
  });

  r.post('/shop/:id/order', requireLogin, (req, res) => {
    const product = shop.getProduct(ctx, intParam(req.params.id));
    if (!product || product.status !== 'on') throw httpError(404, '商品不存在或已下架');
    if (!limiter.check(`order:${req.user.id}`, 10, 3600_000)) {
      return res.message({ title: '下单失败', text: '下单太频繁了，请稍后再试', ok: false, status: 429 });
    }
    try {
      const order = shop.placeOrder(ctx, { productId: product.id, user: req.user, input: req.body });
      res.render('shop/order-done.njk', {
        title: '下单成功', nav: 'shop', crumbs: [['购物', '/shop'], ['下单成功']],
        order, paymentLabel: shop.PAYMENT_LABELS[order.payment], tip: shop.paymentTip(order.payment, res.locals.site),
      });
    } catch (e) {
      if (!(e instanceof shop.ValidationError)) throw e;
      res.status(400).render('shop/detail.njk', {
        title: product.name, nav: 'shop',
        crumbs: [['购物', '/shop'], ...(product.category ? [[product.category, `/shop?category=${encodeURIComponent(product.category)}`]] : []), [product.name]],
        product, related: [], hot: hotProducts(8), payments: shop.PAYMENT_LABELS,
        form: { ...req.body }, error: e.message,
      });
    }
  });

  // ---------- 我的订单 ----------
  r.get('/my/orders', requireLogin, (req, res) => {
    const status = Object.hasOwn(shop.STATUS_LABELS, req.query.status) ? req.query.status : '';
    const args = [req.user.id];
    let where = 'o.user_id = ?';
    if (status) { where += ' AND o.status = ?'; args.push(status); }
    const total = db.prepare(`SELECT COUNT(*) AS n FROM orders o WHERE ${where}`).get(...args).n;
    const pager = paginate({ total, page: req.query.page, perPage: 20, baseUrl: `/my/orders${status ? `?status=${status}` : ''}` });
    const orders = db.prepare(`SELECT o.*, p.image FROM orders o LEFT JOIN products p ON p.id = o.product_id
      WHERE ${where} ORDER BY o.created_at DESC, o.id DESC LIMIT ? OFFSET ?`).all(...args, 20, pager.offset);
    res.render('shop/my-orders.njk', {
      title: '我的订单', panelNav: 'orders', crumbs: [['控制面板', '/my'], ['我的订单']],
      orders, pager, status, statusLabels: shop.STATUS_LABELS, paymentLabels: shop.PAYMENT_LABELS,
    });
  });

  const loadMyOrder = (req) => {
    const order = shop.getOrder(ctx, req.params.orderNo);
    if (!order) throw httpError(404, '订单不存在');
    if (order.user_id !== req.user.id) throw httpError(403, '这不是您的订单');
    return order;
  };

  r.get('/my/orders/:orderNo', requireLogin, (req, res) => {
    const order = loadMyOrder(req);
    const product = order.product_id ? shop.getProduct(ctx, order.product_id) : null;
    res.render('shop/order-detail.njk', {
      title: `订单 ${order.order_no}`, panelNav: 'orders', crumbs: [['控制面板', '/my'], ['我的订单', '/my/orders'], [order.order_no]],
      order, product, statusLabels: shop.STATUS_LABELS, flow: shop.orderFlow(order.status),
      paymentLabel: shop.PAYMENT_LABELS[order.payment], tip: shop.paymentTip(order.payment, res.locals.site),
    });
  });

  r.post('/my/orders/:orderNo/cancel', requireLogin, (req, res) => {
    const order = loadMyOrder(req);
    try {
      shop.cancelByUser(ctx, order);
      res.message({ title: '订单已取消', text: `订单 ${order.order_no} 已取消。`, redirect: `/my/orders/${order.order_no}` });
    } catch (e) {
      if (!(e instanceof shop.ValidationError)) throw e;
      res.message({ title: '取消失败', text: e.message, ok: false, status: 400 });
    }
  });

  return r;
}
