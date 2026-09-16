// 淘宝小二后台：统计、会员、宝贝、交易纠纷、评价与留言屏蔽、站点设置
import { Router } from 'express';
import { intParam, httpError } from '../lib/http.js';
import { line, multiline, likeEscape } from '../lib/text.js';
import { now } from '../lib/format.js';
import { paginate } from '../lib/pager.js';
import { requireAdmin, destroyUserSessions } from '../services/auth.js';
import { SETTING_FIELDS } from '../lib/settings.js';
import { decorate } from '../services/items.js';
import { STATUS, closeOrder, orderItems } from '../services/orders.js';

export default function adminRoutes(ctx) {
  const { db, settings } = ctx;
  const r = Router();
  r.use(requireAdmin);
  const page = (req) => (typeof req.query.page === 'string' ? req.query.page : 1);
  const kw = (req) => line(req.query.q, 40);

  r.get('/', (req, res) => {
    const one = (sql, ...p) => db.prepare(sql).get(...p).n;
    const t = now();
    const stat = {
      users: one('SELECT COUNT(*) AS n FROM users'),
      newUsers: one('SELECT COUNT(*) AS n FROM users WHERE created_at > ?', t - 86400),
      sellers: one("SELECT COUNT(DISTINCT seller_id) AS n FROM items WHERE status = 'onsale'"),
      onsale: res.locals.onsaleCount,
      items: one("SELECT COUNT(*) AS n FROM items WHERE status <> 'deleted'"),
      orders: one('SELECT COUNT(*) AS n FROM orders'),
      today: one('SELECT COUNT(*) AS n FROM orders WHERE created_at > ?', t - 86400),
      gmv: one("SELECT COALESCE(SUM(total_cents), 0) AS n FROM orders WHERE status = 'done'"),
      escrow: one("SELECT COALESCE(SUM(total_cents), 0) AS n FROM orders WHERE status IN ('paid', 'shipped')"),
      waiting: one("SELECT COUNT(*) AS n FROM orders WHERE status = 'paid'"),
      shipped: one("SELECT COUNT(*) AS n FROM orders WHERE status = 'shipped'"),
      bad: one('SELECT COUNT(*) AS n FROM ratings WHERE grade = -1 AND created_at > ?', t - 30 * 86400),
    };
    const byCat = db.prepare(`SELECT oi.cat, SUM(oi.qty) AS qty, SUM(oi.qty * oi.price_cents) AS cents FROM order_items oi
      JOIN orders o ON o.id = oi.order_id WHERE o.status = 'done' GROUP BY oi.cat ORDER BY cents DESC`).all();
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const to = t - i * 86400, from = to - 86400;
      days.push({ ts: to, ...db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(total_cents), 0) AS cents FROM orders WHERE created_at > ? AND created_at <= ?').get(from, to) });
    }
    const topSellers = db.prepare(`SELECT u.id, u.username, COUNT(*) AS n, SUM(o.total_cents) AS cents FROM orders o JOIN users u ON u.id = o.seller_id
      WHERE o.status = 'done' GROUP BY u.id ORDER BY cents DESC LIMIT 8`).all();
    res.render('admin/index.njk', { title: '后台首页', stat, byCat, days, topSellers });
  });

  // ---------- 会员 ----------
  r.get('/users', (req, res) => {
    const q = kw(req);
    const where = q ? "WHERE u.username LIKE ? ESCAPE '\\'" : '';
    const params = q ? [`%${likeEscape(q)}%`] : [];
    const total = db.prepare(`SELECT COUNT(*) AS n FROM users u ${where}`).get(...params).n;
    const pager = paginate({ total, page: page(req), perPage: 30, baseUrl: `/admin/users${q ? `?q=${encodeURIComponent(q)}` : ''}` });
    const users = db.prepare(`SELECT u.*,
        (SELECT COUNT(*) FROM orders WHERE buyer_id = u.id) AS bought,
        (SELECT COUNT(*) FROM orders WHERE seller_id = u.id) AS sold,
        (SELECT COUNT(*) FROM items WHERE seller_id = u.id AND status = 'onsale') AS onsale
      FROM users u ${where} ORDER BY u.id DESC LIMIT 30 OFFSET ?`).all(...params, pager.offset);
    res.render('admin/users.njk', { title: '会员管理', users, q, pager, total });
  });

  r.post('/users/:id/ban', (req, res) => {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(intParam(req.params.id));
    if (!u) throw httpError(404, '会员不存在。');
    if (u.role === 'admin') return res.message({ title: '不能操作', text: '不能冻结淘宝小二的账号。', ok: false, status: 400 });
    const ban = req.body.ban === '1';
    db.prepare('UPDATE users SET banned = ?, ban_reason = ? WHERE id = ?').run(ban ? 1 : 0, ban ? line(req.body.reason, 60) : '', u.id);
    if (ban) destroyUserSessions(ctx, u.id);
    res.redirect(`/admin/users${req.body.q ? `?q=${encodeURIComponent(line(req.body.q, 40))}` : ''}`);
  });

  // ---------- 宝贝 ----------
  r.get('/items', (req, res) => {
    const q = kw(req);
    const filter = ['onsale', 'warehouse', 'blocked', 'deleted'].includes(req.query.filter) ? req.query.filter : '';
    const where = [];
    const params = [];
    if (q) { where.push("(i.title LIKE ? ESCAPE '\\' OR u.username LIKE ? ESCAPE '\\')"); params.push(`%${likeEscape(q)}%`, `%${likeEscape(q)}%`); }
    if (filter === 'blocked') where.push('i.blocked = 1');
    else if (filter) { where.push('i.status = ?'); params.push(filter); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = db.prepare(`SELECT COUNT(*) AS n FROM items i JOIN users u ON u.id = i.seller_id ${whereSql}`).get(...params).n;
    const pager = paginate({ total, page: page(req), perPage: 30, baseUrl: `/admin/items?${new URLSearchParams({ ...(q && { q }), ...(filter && { filter }) })}` });
    const items = db.prepare(`SELECT i.*, u.username AS seller_name FROM items i JOIN users u ON u.id = i.seller_id ${whereSql} ORDER BY i.id DESC LIMIT 30 OFFSET ?`).all(...params, pager.offset).map(decorate);
    res.render('admin/items.njk', { title: '宝贝管理', items, q, filter, pager, total, back: req.originalUrl });
  });

  r.post('/items/:id/block', (req, res) => {
    const it = db.prepare('SELECT * FROM items WHERE id = ?').get(intParam(req.params.id));
    if (!it) throw httpError(404, '宝贝不存在。');
    const block = req.body.block === '1';
    const reason = line(req.body.reason, 60);
    if (block && !reason) return res.message({ title: '请填写原因', text: '强制下架需要填写原因，卖家会在「仓库中的宝贝」里看到。', ok: false, status: 400 });
    db.prepare('UPDATE items SET blocked = ?, block_reason = ?, updated_at = ? WHERE id = ?').run(block ? 1 : 0, block ? reason : '', now(), it.id);
    const back = typeof req.body.back === 'string' && req.body.back.startsWith('/admin/items') ? req.body.back : '/admin/items';
    res.redirect(back);
  });

  // ---------- 交易 ----------
  r.get('/orders', (req, res) => {
    const q = kw(req);
    const status = STATUS[req.query.status] ? req.query.status : '';
    const where = [];
    const params = [];
    if (status) { where.push('o.status = ?'); params.push(status); }
    if (q) { where.push("(o.no = ? OR b.username LIKE ? ESCAPE '\\' OR s.username LIKE ? ESCAPE '\\')"); params.push(q, `%${likeEscape(q)}%`, `%${likeEscape(q)}%`); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const from = 'FROM orders o JOIN users b ON b.id = o.buyer_id JOIN users s ON s.id = o.seller_id';
    const total = db.prepare(`SELECT COUNT(*) AS n ${from} ${whereSql}`).get(...params).n;
    const pager = paginate({ total, page: page(req), perPage: 30, baseUrl: `/admin/orders?${new URLSearchParams({ ...(q && { q }), ...(status && { status }) })}` });
    const orders = db.prepare(`SELECT o.*, b.username AS buyer_name, s.username AS seller_name ${from} ${whereSql} ORDER BY o.created_at DESC, o.id DESC LIMIT 30 OFFSET ?`)
      .all(...params, pager.offset).map((o) => ({ ...o, items: orderItems(db, o.id) }));
    res.render('admin/orders.njk', { title: '交易管理', orders, q, status, pager, total, STATUS, back: req.originalUrl });
  });

  // 纠纷处理：关闭未完成的交易，货款退回买家
  r.post('/orders/:no/close', (req, res) => {
    const o = db.prepare('SELECT * FROM orders WHERE no = ?').get(String(req.params.no));
    if (!o) throw httpError(404, '订单不存在。');
    const reason = line(req.body.reason, 60);
    if (!reason) return res.message({ title: '请填写原因', text: '关闭交易需要填写处理原因，买卖双方都能在订单页看到。', ok: false, status: 400 });
    try {
      closeOrder(ctx, o, { by: 'admin', actorName: req.user.username, reason });
    } catch (e) {
      if (e.status === 409) return res.message({ title: '不能关闭', text: e.message, ok: false, status: 409 });
      throw e;
    }
    res.message({ title: '已关闭交易', text: `订单 ${o.no} 已关闭，￥${(o.total_cents / 100).toFixed(2)} 已退回买家。`, redirect: `/order/${o.no}` });
  });

  // ---------- 评价与留言 ----------
  r.get('/ratings', (req, res) => {
    const total = db.prepare('SELECT COUNT(*) AS n FROM ratings').get().n;
    const pager = paginate({ total, page: page(req), perPage: 40, baseUrl: '/admin/ratings' });
    const ratings = db.prepare(`SELECT r.*, f.username AS from_name, t.username AS to_name, o.no AS order_no FROM ratings r
      JOIN users f ON f.id = r.from_id JOIN users t ON t.id = r.to_id LEFT JOIN orders o ON o.id = r.order_id
      ORDER BY r.id DESC LIMIT 40 OFFSET ?`).all(pager.offset);
    const questions = db.prepare(`SELECT q.*, u.username AS asker_name, i.title AS item_title FROM questions q
      JOIN users u ON u.id = q.asker_id JOIN items i ON i.id = q.item_id ORDER BY q.id DESC LIMIT 40`).all();
    res.render('admin/ratings.njk', { title: '评价与留言', ratings, questions, pager });
  });

  r.post('/ratings/:id/hide', (req, res) => {
    db.prepare('UPDATE ratings SET hidden = ? WHERE id = ?').run(req.body.hide === '1' ? 1 : 0, intParam(req.params.id));
    res.redirect('/admin/ratings');
  });
  r.post('/questions/:id/hide', (req, res) => {
    db.prepare('UPDATE questions SET hidden = ? WHERE id = ?').run(req.body.hide === '1' ? 1 : 0, intParam(req.params.id));
    res.redirect('/admin/ratings');
  });

  // ---------- 设置 ----------
  r.get('/settings', (req, res) => {
    res.render('admin/settings.njk', { title: '站点设置', fields: SETTING_FIELDS, s: settings.all(), saved: req.query.saved === '1', err: '' });
  });

  r.post('/settings', (req, res) => {
    const values = {};
    const errors = [];
    for (const f of SETTING_FIELDS) {
      const v = req.body[f.key];
      if (f.type === 'bool') values[f.key] = v === '1' ? '1' : '0';
      else if (f.type === 'number') values[f.key] = /^\d{1,9}$/.test(String(v ?? '').trim()) ? String(v).trim() : '0';
      else if (f.type === 'textarea') values[f.key] = multiline(v, f.max);
      else if (f.type === 'url') {
        const u = line(v, f.max);
        if (u && !/^(\/(?!\/)[^\s"'<>\\]*|https?:\/\/[^\s"'<>\\]+)$/.test(u)) errors.push(`${f.label}：只能填 / 开头的站内地址或 http(s):// 开头的网址`);
        else values[f.key] = u;
      } else values[f.key] = line(v, f.max);
    }
    if (errors.length) return res.render('admin/settings.njk', { title: '站点设置', fields: SETTING_FIELDS, s: { ...settings.all(), ...values }, saved: false, err: errors.join('；') });
    settings.setMany(values);
    res.redirect('/admin/settings?saved=1');
  });

  return r;
}
