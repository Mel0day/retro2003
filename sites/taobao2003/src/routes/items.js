import { Router } from 'express';
import { intParam, httpError } from '../lib/http.js';
import { line } from '../lib/text.js';
import { requireLogin } from '../services/auth.js';
import { getItem, buyProblem } from '../services/items.js';

export default function itemRoutes(ctx) {
  const { db, limiter } = ctx;
  const r = Router();

  r.get('/item/:id', (req, res) => {
    const item = getItem(db, intParam(req.params.id));
    const mine = item && req.user && req.user.id === item.seller_id;
    if (!item || item.status === 'deleted') throw httpError(404, '该宝贝不存在或已被卖家删除。');
    // 下架、仓库中、被屏蔽的宝贝：卖家本人和淘宝小二还能看，其他人只看到提示
    if ((item.status !== 'onsale' || item.blocked || item.seller_banned) && !mine && !res.locals.isAdmin) {
      return res.message({ title: '宝贝已下架', text: `「${item.title}」已经下架了，去看看其他宝贝吧。`, ok: false, status: 404 });
    }
    if (!mine) db.prepare('UPDATE items SET views = views + 1 WHERE id = ?').run(item.id);
    const ratings = db.prepare(`SELECT r.*, u.username AS from_name FROM ratings r JOIN users u ON u.id = r.from_id
      WHERE r.role = 'seller' AND r.to_id = ? AND (r.item_id = ? OR r.order_id IN (SELECT order_id FROM order_items WHERE item_id = ?))
      ORDER BY r.created_at DESC, r.id DESC LIMIT 11`).all(item.seller_id, item.id, item.id);
    const moreRatings = ratings.length > 10;
    if (moreRatings) ratings.pop();
    const questions = db.prepare(`SELECT q.*, u.username AS asker_name FROM questions q JOIN users u ON u.id = q.asker_id
      WHERE q.item_id = ? AND q.hidden = 0 ORDER BY q.id DESC LIMIT 20`).all(item.id);
    const faved = req.user ? !!db.prepare('SELECT 1 FROM favorites WHERE user_id = ? AND item_id = ?').get(req.user.id, item.id) : false;
    const favCount = db.prepare('SELECT COUNT(*) AS n FROM favorites WHERE item_id = ?').get(item.id).n;
    const seller = db.prepare('SELECT id, username, city, shop_intro, created_at FROM users WHERE id = ?').get(item.seller_id);
    const onsale = db.prepare("SELECT COUNT(*) AS n FROM items WHERE seller_id = ? AND status = 'onsale' AND blocked = 0").get(item.seller_id).n;
    res.render('item.njk', {
      title: item.title,
      crumbs: [{ text: item.cat, url: `/?cat=${encodeURIComponent(item.cat)}` }, { text: item.title }],
      nav: item.cat, item, seller, onsale, ratings, moreRatings, questions, faved, favCount, mine,
      problem: buyProblem(item, req.user),
      added: intParam(req.query.added, 0),
      notice: req.query.asked === '1' ? '留言已发布，卖家回复后会显示在这里。' : req.query.faved === '1' ? '已收藏，可以在「我的淘宝 → 收藏夹」里找到。' : '',
    });
  });

  // 宝贝留言：登录会员公开提问，卖家在「我的淘宝」里回复
  r.post('/item/:id/question', requireLogin, (req, res) => {
    const item = getItem(db, intParam(req.params.id));
    if (!item || item.status === 'deleted') throw httpError(404, '该宝贝不存在。');
    if (item.seller_id === req.user.id) return res.message({ title: '不能留言', text: '这是您自己发布的宝贝，请在「我的淘宝 → 宝贝留言」里回复买家。', ok: false, status: 400 });
    const text = line(req.body.text, 200);
    if ([...text].length < 2) return res.message({ title: '留言失败', text: '留言内容至少 2 个字。', ok: false, status: 400 });
    if (!limiter.check(`question:${req.user.id}`, 20, 3600_000)) return res.message({ title: '请稍候', text: '留言太频繁了，1 小时后再试。', ok: false, status: 429 });
    db.prepare('INSERT INTO questions (item_id, asker_id, seller_id, text) VALUES (?, ?, ?, ?)').run(item.id, req.user.id, item.seller_id, text);
    res.redirect(`/item/${item.id}?asked=1#questions`);
  });

  r.post('/item/:id/favorite', requireLogin, (req, res) => {
    const item = getItem(db, intParam(req.params.id));
    if (!item || item.status === 'deleted') throw httpError(404, '该宝贝不存在。');
    if (req.body.remove === '1') {
      db.prepare('DELETE FROM favorites WHERE user_id = ? AND item_id = ?').run(req.user.id, item.id);
      return res.redirect(req.body.back === 'favorites' ? '/my/favorites' : `/item/${item.id}`);
    }
    const n = db.prepare('SELECT COUNT(*) AS n FROM favorites WHERE user_id = ?').get(req.user.id).n;
    if (n >= 200) return res.message({ title: '收藏夹满了', text: '收藏夹最多保存 200 件宝贝，请先删除一些。', ok: false, status: 400 });
    db.prepare('INSERT OR IGNORE INTO favorites (user_id, item_id) VALUES (?, ?)').run(req.user.id, item.id);
    res.redirect(`/item/${item.id}?faved=1`);
  });

  return r;
}
