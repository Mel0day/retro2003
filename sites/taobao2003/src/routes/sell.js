// 我是卖家：我要卖（发布宝贝）、编辑、上下架、删除、已卖出的宝贝、宝贝留言
import { Router } from 'express';
import { intParam, httpError } from '../lib/http.js';
import { line } from '../lib/text.js';
import { now } from '../lib/format.js';
import { paginate } from '../lib/pager.js';
import { saveImage, removeImage, isUploadUrl } from '../lib/uploads.js';
import { requireLogin } from '../services/auth.js';
import { CATS, MAX_IMAGES, readItemForm, buildSearchText, decorate, parseImages } from '../services/items.js';
import { STATUS, LOGISTICS } from '../services/orders.js';

export default function sellRoutes(ctx) {
  const { db, limiter, config } = ctx;
  const r = Router();

  const formPage = (req, res, { item = null, form, errors = [], status = 200 }) => res.status(status).render('my/sell.njk', {
    title: item ? '编辑宝贝' : '我要卖', crumbs: [{ text: '我的淘宝', url: '/my' }, { text: item ? '编辑宝贝' : '我要卖' }],
    side: item ? 'items' : 'sell', item, form, errors, CATS, MAX_IMAGES,
  });

  const ownItem = (req) => {
    const it = db.prepare("SELECT * FROM items WHERE id = ? AND seller_id = ? AND status <> 'deleted'").get(intParam(req.params.id), req.user.id);
    if (!it) throw httpError(404, '宝贝不存在。');
    return decorate(it);
  };

  // 保存上传的新图片，和保留的旧图片合并，最多 3 张
  function collectImages(req, keep = []) {
    const kept = [].concat(req.body.keep_image || []).filter((u) => typeof u === 'string' && keep.includes(u));
    const files = (req.files || []).filter((f) => f.fieldname === 'images');
    if (kept.length + files.length > MAX_IMAGES) throw httpError(400, `每件宝贝最多 ${MAX_IMAGES} 张图片`);
    const saved = files.map((f) => saveImage(config, f));
    return { images: [...kept, ...saved], saved, dropped: keep.filter((u) => !kept.includes(u)) };
  }

  // 被订单快照引用的图片不删
  const dropUnused = (urls) => {
    for (const u of urls) if (!db.prepare('SELECT 1 FROM order_items WHERE image = ? LIMIT 1').get(u)) removeImage(config, u);
  };

  r.get('/sell', requireLogin, (req, res) => {
    const me = db.prepare('SELECT city FROM users WHERE id = ?').get(req.user.id);
    formPage(req, res, { form: { cat: CATS.includes(req.query.cat) ? req.query.cat : '', stock: '1', city: me.city, status: 'onsale' } });
  });

  r.post('/sell', requireLogin, (req, res) => {
    const { data, errors } = readItemForm(req.body);
    if (errors.length) return formPage(req, res, { form: data, errors });
    if (!limiter.check(`sell:${req.user.id}`, 30, 86400_000)) return formPage(req, res, { form: data, errors: ['每天最多发布 30 件宝贝'], status: 429 });
    const count = db.prepare("SELECT COUNT(*) AS n FROM items WHERE seller_id = ? AND status <> 'deleted'").get(req.user.id).n;
    if (count >= 200) return formPage(req, res, { form: data, errors: ['每个会员最多同时拥有 200 件宝贝，请先删除一些'] });
    let images;
    try { ({ images } = collectImages(req)); } catch (e) {
      if (e.status < 500) return formPage(req, res, { form: data, errors: [e.message] });
      throw e;
    }
    const t = now();
    const id = db.prepare(`INSERT INTO items (seller_id, cat, title, descr, tag, price_cents, orig_cents, stock, city, detail, images, status, search_text, listed_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      req.user.id, data.cat, data.title, data.descr, data.tag, data.price_cents, data.orig_cents, data.stockNum, data.city, data.detail,
      JSON.stringify(images), data.status, buildSearchText({ ...data, sellerName: req.user.username }), t, t, t,
    ).lastInsertRowid;
    db.prepare("UPDATE users SET city = ? WHERE id = ? AND city = ''").run(data.city, req.user.id);
    res.message({
      title: '发布成功',
      text: data.status === 'onsale' ? `「${data.title}」已经上架，买家现在就能搜到了。` : `「${data.title}」已放入仓库，需要时再上架。`,
      redirect: `/item/${id}`,
    });
  });

  r.get('/my/items/:id/edit', requireLogin, (req, res) => {
    const item = ownItem(req);
    formPage(req, res, { item, form: { ...item, price: (item.price_cents / 100).toFixed(2), orig: item.orig_cents ? (item.orig_cents / 100).toFixed(2) : '', stock: String(item.stock) } });
  });

  r.post('/my/items/:id/edit', requireLogin, (req, res) => {
    const item = ownItem(req);
    const { data, errors } = readItemForm(req.body);
    if (errors.length) return formPage(req, res, { item, form: data, errors });
    let result;
    try { result = collectImages(req, item.imageList); } catch (e) {
      if (e.status < 500) return formPage(req, res, { item, form: data, errors: [e.message] });
      throw e;
    }
    const t = now();
    db.prepare(`UPDATE items SET cat = ?, title = ?, descr = ?, tag = ?, price_cents = ?, orig_cents = ?, stock = ?, city = ?, detail = ?, images = ?, status = ?, search_text = ?, updated_at = ?,
      listed_at = CASE WHEN status <> 'onsale' AND ? = 'onsale' THEN ? ELSE listed_at END WHERE id = ? AND seller_id = ?`).run(
      data.cat, data.title, data.descr, data.tag, data.price_cents, data.orig_cents, data.stockNum, data.city, data.detail,
      JSON.stringify(result.images), data.status, buildSearchText({ ...data, sellerName: req.user.username }), t, data.status, t, item.id, req.user.id,
    );
    dropUnused(result.dropped);
    res.message({ title: '保存成功', text: `「${data.title}」已更新。`, redirect: `/item/${item.id}` });
  });

  // 上架 / 下架 / 删除
  r.post('/my/items/:id/:action', requireLogin, (req, res) => {
    const action = req.params.action;
    if (!['onsale', 'warehouse', 'delete'].includes(action)) throw httpError(404, '页面不存在。');
    const item = ownItem(req);
    const back = req.body.back === 'warehouse' ? '/my/items?tab=warehouse' : '/my/items';
    if (action === 'onsale') {
      if (item.blocked) return res.message({ title: '不能上架', text: `该宝贝已被淘宝小二下架：${item.block_reason || '违反发布规则'}。请修改后联系客服。`, ok: false, status: 400 });
      if (item.stock < 1) return res.message({ title: '不能上架', text: '库存为 0，请先编辑宝贝补充库存。', ok: false, status: 400 });
      db.prepare("UPDATE items SET status = 'onsale', listed_at = ?, updated_at = ? WHERE id = ?").run(now(), now(), item.id);
    } else if (action === 'warehouse') {
      db.prepare("UPDATE items SET status = 'warehouse', updated_at = ? WHERE id = ?").run(now(), item.id);
    } else {
      const open = db.prepare("SELECT COUNT(*) AS n FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.item_id = ? AND o.status IN ('paid', 'shipped')").get(item.id).n;
      if (open) return res.message({ title: '不能删除', text: `这件宝贝还有 ${open} 笔交易没有完成，完成后再删除。可以先下架。`, ok: false, status: 400 });
      db.transaction(() => {
        db.prepare("UPDATE items SET status = 'deleted', updated_at = ? WHERE id = ?").run(now(), item.id);
        db.prepare('DELETE FROM carts WHERE item_id = ?').run(item.id);
      })();
      dropUnused(item.imageList.filter(isUploadUrl));
    }
    res.redirect(back);
  });

  // 出售中 / 仓库中的宝贝
  r.get('/my/items', requireLogin, (req, res) => {
    const tab = req.query.tab === 'warehouse' ? 'warehouse' : 'onsale';
    const where = tab === 'onsale' ? "status = 'onsale' AND blocked = 0" : "(status = 'warehouse' OR (status = 'onsale' AND blocked = 1))";
    const items = db.prepare(`SELECT * FROM items WHERE seller_id = ? AND ${where} ORDER BY updated_at DESC, id DESC`).all(req.user.id).map(decorate);
    const counts = db.prepare("SELECT SUM(status = 'onsale' AND blocked = 0) AS onsale, SUM(status = 'warehouse' OR (status = 'onsale' AND blocked = 1)) AS warehouse FROM items WHERE seller_id = ?").get(req.user.id);
    res.render('my/items.njk', { title: tab === 'onsale' ? '出售中的宝贝' : '仓库中的宝贝', crumbs: [{ text: '我的淘宝', url: '/my' }, { text: tab === 'onsale' ? '出售中的宝贝' : '仓库中的宝贝' }], side: tab === 'onsale' ? 'items' : 'warehouse', tab, items, counts });
  });

  // 已卖出的宝贝
  r.get('/my/sold', requireLogin, (req, res) => {
    const status = STATUS[req.query.status] ? req.query.status : '';
    const where = status ? 'AND o.status = ?' : '';
    const params = status ? [req.user.id, status] : [req.user.id];
    const total = db.prepare(`SELECT COUNT(*) AS n FROM orders o WHERE o.seller_id = ? ${where}`).get(...params).n;
    const pager = paginate({ total, page: typeof req.query.page === 'string' ? req.query.page : 1, perPage: 15, baseUrl: `/my/sold${status ? `?status=${status}` : ''}` });
    const orders = db.prepare(`SELECT o.*, b.username AS buyer_name,
        (SELECT 1 FROM ratings WHERE order_id = o.id AND role = 'buyer') AS rated
      FROM orders o JOIN users b ON b.id = o.buyer_id WHERE o.seller_id = ? ${where} ORDER BY o.created_at DESC, o.id DESC LIMIT ? OFFSET ?`)
      .all(...params, 15, pager.offset).map((o) => ({ ...o, items: db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(o.id) }));
    const counts = Object.fromEntries(db.prepare('SELECT status, COUNT(*) AS n FROM orders WHERE seller_id = ? GROUP BY status').all(req.user.id).map((x) => [x.status, x.n]));
    res.render('my/sold.njk', { title: '已卖出的宝贝', crumbs: [{ text: '我的淘宝', url: '/my' }, { text: '已卖出的宝贝' }], side: 'sold', orders, status, counts, pager, LOGISTICS });
  });

  // 宝贝留言：买家的提问，卖家回复
  r.get('/my/questions', requireLogin, (req, res) => {
    const questions = db.prepare(`SELECT q.*, u.username AS asker_name, i.title AS item_title FROM questions q
      JOIN users u ON u.id = q.asker_id JOIN items i ON i.id = q.item_id
      WHERE q.seller_id = ? AND q.hidden = 0 ORDER BY (q.reply = '') DESC, q.id DESC LIMIT 100`).all(req.user.id);
    const asked = db.prepare(`SELECT q.*, s.username AS seller_name, i.title AS item_title FROM questions q
      JOIN users s ON s.id = q.seller_id JOIN items i ON i.id = q.item_id
      WHERE q.asker_id = ? ORDER BY q.id DESC LIMIT 50`).all(req.user.id);
    res.render('my/questions.njk', { title: '宝贝留言', crumbs: [{ text: '我的淘宝', url: '/my' }, { text: '宝贝留言' }], side: 'questions', questions, asked });
  });

  r.post('/my/questions/:id/reply', requireLogin, (req, res) => {
    const q = db.prepare('SELECT * FROM questions WHERE id = ? AND seller_id = ?').get(intParam(req.params.id), req.user.id);
    if (!q) throw httpError(404, '留言不存在。');
    const text = line(req.body.reply, 200);
    if ([...text].length < 2) return res.message({ title: '回复失败', text: '回复内容至少 2 个字。', ok: false, status: 400 });
    db.prepare('UPDATE questions SET reply = ?, replied_at = ? WHERE id = ?').run(text, now(), q.id);
    res.redirect('/my/questions');
  });

  return r;
}
