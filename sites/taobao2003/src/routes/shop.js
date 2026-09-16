// 卖家店铺：卖家资料、信用、在售宝贝、收到的评价
import { Router } from 'express';
import { intParam, httpError } from '../lib/http.js';
import { paginate } from '../lib/pager.js';
import { creditOf } from '../services/credit.js';
import { listItems } from '../services/items.js';

export default function shopRoutes(ctx) {
  const { db } = ctx;
  const r = Router();

  r.get('/shop/:id', (req, res) => {
    const seller = db.prepare('SELECT id, username, city, shop_intro, banned, created_at, last_login_at FROM users WHERE id = ?').get(intParam(req.params.id));
    if (!seller || (seller.banned && !res.locals.isAdmin)) throw httpError(404, '店铺不存在或已关闭。');
    const tab = req.query.tab === 'rates' ? 'rates' : 'items';
    const { total } = listItems(db, { sellerId: seller.id, limit: 0, offset: 0 });
    const pager = paginate({ total, page: typeof req.query.page === 'string' ? req.query.page : 1, perPage: 10, baseUrl: `/shop/${seller.id}` });
    const { rows } = tab === 'items' ? listItems(db, { sellerId: seller.id, sort: 'default', limit: 10, offset: pager.offset }) : { rows: [] };
    const ratings = tab === 'rates'
      ? db.prepare(`SELECT r.*, u.username AS from_name FROM ratings r JOIN users u ON u.id = r.from_id
          WHERE r.to_id = ? AND r.role = 'seller' ORDER BY r.created_at DESC, r.id DESC LIMIT 50`).all(seller.id)
      : [];
    const recent = db.prepare(`SELECT
        SUM(grade = 1 AND created_at > unixepoch() - 7 * 86400) AS w_good, SUM(grade = 0 AND created_at > unixepoch() - 7 * 86400) AS w_mid, SUM(grade = -1 AND created_at > unixepoch() - 7 * 86400) AS w_bad,
        SUM(grade = 1 AND created_at > unixepoch() - 30 * 86400) AS m_good, SUM(grade = 0 AND created_at > unixepoch() - 30 * 86400) AS m_mid, SUM(grade = -1 AND created_at > unixepoch() - 30 * 86400) AS m_bad,
        SUM(grade = 1) AS a_good, SUM(grade = 0) AS a_mid, SUM(grade = -1) AS a_bad
      FROM ratings WHERE to_id = ? AND role = 'seller'`).get(seller.id);
    res.render('shop.njk', {
      title: `${seller.username}的店铺`, crumbs: [{ text: '卖家店铺' }, { text: seller.username }],
      seller, tab, items: rows, total, pager, ratings, recent,
      sellerCredit: creditOf(db, seller.id, 'seller'), buyerCredit: creditOf(db, seller.id, 'buyer'),
      soldCount: db.prepare("SELECT COUNT(*) AS n FROM orders WHERE seller_id = ? AND status = 'done'").get(seller.id).n,
    });
  });

  return r;
}
