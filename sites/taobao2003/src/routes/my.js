// 我的淘宝：首页、已买到的宝贝、信用评价、收藏夹、支付宝账户、收货地址、个人资料与密码
import { Router } from 'express';
import { intParam, httpError } from '../lib/http.js';
import { line, multiline, TEL_RE } from '../lib/text.js';
import { paginate } from '../lib/pager.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { requireLogin, destroyUserSessions } from '../services/auth.js';
import { creditOf } from '../services/credit.js';
import { decorate } from '../services/items.js';
import { STATUS, MAX_ADDRESSES } from '../services/orders.js';

export default function myRoutes(ctx) {
  const { db, limiter } = ctx;
  const r = Router();
  const crumbs = (text) => [{ text: '我的淘宝', url: '/my' }, { text }];

  r.get('/my', requireLogin, (req, res) => {
    const me = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    const bought = Object.fromEntries(db.prepare('SELECT status, COUNT(*) AS n FROM orders WHERE buyer_id = ? GROUP BY status').all(me.id).map((x) => [x.status, x.n]));
    const sold = Object.fromEntries(db.prepare('SELECT status, COUNT(*) AS n FROM orders WHERE seller_id = ? GROUP BY status').all(me.id).map((x) => [x.status, x.n]));
    const toRateBuyer = db.prepare("SELECT COUNT(*) AS n FROM orders o WHERE o.buyer_id = ? AND o.status = 'done' AND NOT EXISTS (SELECT 1 FROM ratings WHERE order_id = o.id AND role = 'seller')").get(me.id).n;
    const toRateSeller = db.prepare("SELECT COUNT(*) AS n FROM orders o WHERE o.seller_id = ? AND o.status = 'done' AND NOT EXISTS (SELECT 1 FROM ratings WHERE order_id = o.id AND role = 'buyer')").get(me.id).n;
    const items = db.prepare("SELECT SUM(status = 'onsale' AND blocked = 0) AS onsale, SUM(status = 'warehouse' OR blocked = 1) AS warehouse FROM items WHERE seller_id = ? AND status <> 'deleted'").get(me.id);
    const unanswered = db.prepare("SELECT COUNT(*) AS n FROM questions WHERE seller_id = ? AND reply = '' AND hidden = 0").get(me.id).n;
    const recent = db.prepare(`SELECT o.*, s.username AS seller_name FROM orders o JOIN users s ON s.id = o.seller_id WHERE o.buyer_id = ? ORDER BY o.created_at DESC LIMIT 5`).all(me.id)
      .map((o) => ({ ...o, items: db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(o.id) }));
    res.render('my/home.njk', {
      title: '我的淘宝', crumbs: [{ text: '我的淘宝' }], side: 'home', nav: 'orders',
      me, bought, sold, toRateBuyer, toRateSeller, items, unanswered, recent,
      sellerCredit: creditOf(db, me.id, 'seller'), buyerCredit: creditOf(db, me.id, 'buyer'),
    });
  });

  // 已买到的宝贝
  r.get('/my/bought', requireLogin, (req, res) => {
    const status = STATUS[req.query.status] ? req.query.status : '';
    const where = status ? 'AND o.status = ?' : '';
    const params = status ? [req.user.id, status] : [req.user.id];
    const total = db.prepare(`SELECT COUNT(*) AS n FROM orders o WHERE o.buyer_id = ? ${where}`).get(...params).n;
    const pager = paginate({ total, page: typeof req.query.page === 'string' ? req.query.page : 1, perPage: 15, baseUrl: `/my/bought${status ? `?status=${status}` : ''}` });
    const orders = db.prepare(`SELECT o.*, s.username AS seller_name,
        (SELECT 1 FROM ratings WHERE order_id = o.id AND role = 'seller') AS rated
      FROM orders o JOIN users s ON s.id = o.seller_id WHERE o.buyer_id = ? ${where} ORDER BY o.created_at DESC, o.id DESC LIMIT ? OFFSET ?`)
      .all(...params, 15, pager.offset).map((o) => ({ ...o, items: db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(o.id) }));
    const counts = Object.fromEntries(db.prepare('SELECT status, COUNT(*) AS n FROM orders WHERE buyer_id = ? GROUP BY status').all(req.user.id).map((x) => [x.status, x.n]));
    res.render('my/bought.njk', { title: '已买到的宝贝', crumbs: crumbs('已买到的宝贝'), side: 'bought', nav: 'orders', orders, status, counts, pager });
  });

  // 信用评价：我收到的（作为卖家 / 作为买家）和我给出的
  r.get('/my/rates', requireLogin, (req, res) => {
    const tab = ['seller', 'buyer', 'given'].includes(req.query.tab) ? req.query.tab : 'seller';
    const rows = tab === 'given'
      ? db.prepare('SELECT r.*, u.username AS other_name FROM ratings r JOIN users u ON u.id = r.to_id WHERE r.from_id = ? ORDER BY r.created_at DESC LIMIT 100').all(req.user.id)
      : db.prepare('SELECT r.*, u.username AS other_name FROM ratings r JOIN users u ON u.id = r.from_id WHERE r.to_id = ? AND r.role = ? ORDER BY r.created_at DESC LIMIT 100').all(req.user.id, tab);
    res.render('my/rates.njk', {
      title: '信用评价', crumbs: crumbs('信用评价'), side: 'rates', tab, rows,
      sellerCredit: creditOf(db, req.user.id, 'seller'), buyerCredit: creditOf(db, req.user.id, 'buyer'),
    });
  });

  r.get('/my/favorites', requireLogin, (req, res) => {
    const items = db.prepare(`SELECT i.*, u.username AS seller_name, u.banned AS seller_banned, f.created_at AS faved_at FROM favorites f
      JOIN items i ON i.id = f.item_id JOIN users u ON u.id = i.seller_id WHERE f.user_id = ? ORDER BY f.created_at DESC LIMIT 200`).all(req.user.id).map(decorate);
    res.render('my/favorites.njk', { title: '收藏夹', crumbs: crumbs('收藏夹'), side: 'favorites', items });
  });

  r.get('/my/alipay', requireLogin, (req, res) => {
    const me = db.prepare('SELECT balance_cents FROM users WHERE id = ?').get(req.user.id);
    const total = db.prepare('SELECT COUNT(*) AS n FROM alipay_logs WHERE user_id = ?').get(req.user.id).n;
    const pager = paginate({ total, page: typeof req.query.page === 'string' ? req.query.page : 1, perPage: 20, baseUrl: '/my/alipay' });
    const logs = db.prepare('SELECT * FROM alipay_logs WHERE user_id = ? ORDER BY id DESC LIMIT 20 OFFSET ?').all(req.user.id, pager.offset);
    const escrow = db.prepare("SELECT COALESCE(SUM(total_cents), 0) AS n FROM orders WHERE buyer_id = ? AND status IN ('paid', 'shipped')").get(req.user.id).n;
    const incoming = db.prepare("SELECT COALESCE(SUM(total_cents), 0) AS n FROM orders WHERE seller_id = ? AND status IN ('paid', 'shipped')").get(req.user.id).n;
    res.render('my/alipay.njk', { title: '支付宝账户', crumbs: crumbs('支付宝账户'), side: 'alipay', balance: me.balance_cents, logs, pager, escrow, incoming });
  });

  // ---------- 收货地址 ----------
  r.get('/my/address', requireLogin, (req, res) => {
    const addresses = db.prepare('SELECT * FROM addresses WHERE user_id = ? ORDER BY updated_at DESC, id DESC').all(req.user.id);
    res.render('my/address.njk', { title: '收货地址', crumbs: crumbs('收货地址'), side: 'address', addresses, err: '', form: {}, MAX_ADDRESSES });
  });

  r.post('/my/address', requireLogin, (req, res) => {
    const form = { receiver: line(req.body.receiver, 20), address: line(req.body.address, 120), tel: line(req.body.tel, 20) };
    const addresses = db.prepare('SELECT * FROM addresses WHERE user_id = ? ORDER BY updated_at DESC, id DESC').all(req.user.id);
    const fail = (err) => res.render('my/address.njk', { title: '收货地址', crumbs: crumbs('收货地址'), side: 'address', addresses, err, form, MAX_ADDRESSES });
    if ([...form.receiver].length < 2) return fail('请填写收货人姓名');
    if ([...form.address].length < 8) return fail('请填写详细地址（至少 8 个字）');
    if (!TEL_RE.test(form.tel)) return fail('联系电话格式不对');
    if (addresses.length >= MAX_ADDRESSES) return fail(`地址簿最多保存 ${MAX_ADDRESSES} 条`);
    if (!limiter.check(`addr:${req.user.id}`, 30, 3600_000)) return fail('操作太频繁，请稍后再试');
    db.prepare('INSERT INTO addresses (user_id, receiver, address, tel) VALUES (?, ?, ?, ?)').run(req.user.id, form.receiver, form.address, form.tel);
    res.redirect('/my/address');
  });

  r.post('/my/address/:id/delete', requireLogin, (req, res) => {
    db.prepare('DELETE FROM addresses WHERE id = ? AND user_id = ?').run(intParam(req.params.id), req.user.id);
    res.redirect('/my/address');
  });

  // ---------- 个人资料 / 密码 ----------
  const profilePage = (req, res, extra = {}) => {
    const me = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    res.render('my/profile.njk', { title: '个人资料', crumbs: crumbs('个人资料'), side: 'profile', me, saved: false, pwErr: '', pwOk: false, err: '', ...extra });
  };
  r.get('/my/profile', requireLogin, (req, res) => profilePage(req, res, { saved: req.query.saved === '1' }));

  r.post('/my/profile', requireLogin, (req, res) => {
    const city = line(req.body.city, 20);
    const intro = multiline(req.body.shop_intro, 300);
    db.prepare('UPDATE users SET city = ?, shop_intro = ? WHERE id = ?').run(city, intro, req.user.id);
    res.redirect('/my/profile?saved=1');
  });

  r.post('/my/password', requireLogin, (req, res) => {
    const s = (v) => (typeof v === 'string' ? v : '');
    const old = s(req.body.old), pw = s(req.body.password), pw2 = s(req.body.password2);
    if (!limiter.check(`pw:${req.user.id}`, 10, 3600_000)) return profilePage(req, res, { pwErr: '操作太频繁，请 1 小时后再试' });
    const u = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!verifyPassword(old, u.password_hash)) return profilePage(req, res, { pwErr: '原密码不正确' });
    if (pw.length < 6 || pw.length > 64) return profilePage(req, res, { pwErr: '新密码长度为 6-64 位' });
    if (pw !== pw2) return profilePage(req, res, { pwErr: '两次输入的新密码不一致' });
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(pw), req.user.id);
    destroyUserSessions(ctx, req.user.id, req.cookies.sid);
    profilePage(req, res, { pwOk: true });
  });

  r.get('/my/:rest', requireLogin, () => { throw httpError(404, '页面不存在。'); });

  return r;
}
