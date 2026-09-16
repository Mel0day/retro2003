// 宝贝：分类、列表查询、发布与编辑的校验
import { line, multiline, searchNorm, searchTerms, likeEscape } from '../lib/text.js';
import { parseYuan, intIn } from '../lib/http.js';
import { now } from '../lib/format.js';
import { isUploadUrl } from '../lib/uploads.js';

export const CATS = ['数码', '服饰', '图书', '家居'];
export const BANDS = [
  { id: 0, label: '全部价格', sql: '' },
  { id: 1, label: '50 元以下', sql: 'i.price_cents < 5000' },
  { id: 2, label: '50-200 元', sql: 'i.price_cents >= 5000 AND i.price_cents < 20000' },
  { id: 3, label: '200 元以上', sql: 'i.price_cents >= 20000' },
];
export const SORTS = {
  default: 'i.listed_at DESC, i.id DESC',
  asc: 'i.price_cents ASC, i.id ASC',
  desc: 'i.price_cents DESC, i.id ASC',
  sold: 'i.sold DESC, i.id ASC',
};
export const SORT_LABELS = [['default', '默认'], ['asc', '价格↑'], ['desc', '价格↓'], ['sold', '销量']];
export const MAX_IMAGES = 3;
export const NEW_DAYS = 7;

// 买家能看到并购买的宝贝
export const VISIBLE = "i.status = 'onsale' AND i.blocked = 0 AND u.banned = 0";

export function parseImages(json) {
  try {
    const arr = JSON.parse(json || '[]');
    return Array.isArray(arr) ? arr.filter(isUploadUrl).slice(0, MAX_IMAGES) : [];
  } catch { return []; }
}

export function decorate(item) {
  if (!item) return item;
  const images = parseImages(item.images);
  return { ...item, imageList: images, cover: images[0] || '', isNew: item.listed_at > now() - NEW_DAYS * 86400 };
}

export function buildSearchText({ title, descr, tag, sellerName }) {
  return searchNorm([title, descr, tag, sellerName].join(' '));
}

export function getItem(db, id) {
  return decorate(db.prepare(`SELECT i.*, u.username AS seller_name, u.banned AS seller_banned, u.city AS seller_city, u.created_at AS seller_since
    FROM items i JOIN users u ON u.id = i.seller_id WHERE i.id = ?`).get(id));
}

// 买家视角能否购买：返回错误文案，能买返回空串
export function buyProblem(item, user) {
  if (!item || item.status === 'deleted') return '该宝贝不存在或已被删除。';
  if (item.blocked) return '该宝贝已被淘宝网下架。';
  if (item.seller_banned) return '该卖家的账号已被冻结，暂时不能购买。';
  if (item.status !== 'onsale') return '该宝贝已下架。';
  if (item.stock < 1) return '该宝贝已经卖完了。';
  if (user && user.id === item.seller_id) return '不能购买自己发布的宝贝。';
  return '';
}

export function listItems(db, { cat = 'all', band = 0, sort = 'default', q = '', sellerId = null, limit, offset }) {
  const where = [VISIBLE];
  const params = [];
  if (cat !== 'all') { where.push('i.cat = ?'); params.push(cat); }
  if (BANDS[band]?.sql) where.push(BANDS[band].sql);
  if (sellerId) { where.push('i.seller_id = ?'); params.push(sellerId); }
  for (const t of searchTerms(q)) { where.push("i.search_text LIKE ? ESCAPE '\\'"); params.push(`%${likeEscape(t)}%`); }
  const whereSql = where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) AS n FROM items i JOIN users u ON u.id = i.seller_id WHERE ${whereSql}`).get(...params).n;
  const rows = db.prepare(`SELECT i.*, u.username AS seller_name FROM items i JOIN users u ON u.id = i.seller_id
    WHERE ${whereSql} ORDER BY ${SORTS[sort] || SORTS.default} LIMIT ? OFFSET ?`).all(...params, limit, offset);
  return { total, rows: rows.map(decorate) };
}

export function catCounts(db) {
  const rows = db.prepare(`SELECT i.cat, COUNT(*) AS n FROM items i JOIN users u ON u.id = i.seller_id WHERE ${VISIBLE} GROUP BY i.cat`).all();
  const map = Object.fromEntries(rows.map((r) => [r.cat, r.n]));
  return CATS.map((c) => ({ cat: c, n: map[c] || 0 }));
}

export function onsaleCount(db) {
  return db.prepare(`SELECT COUNT(*) AS n FROM items i JOIN users u ON u.id = i.seller_id WHERE ${VISIBLE}`).get().n;
}

// 发布 / 编辑表单校验。返回 { data, errors }
export function readItemForm(body) {
  const data = {
    cat: line(body.cat, 10),
    title: line(body.title, 60),
    descr: line(body.descr, 60),
    tag: line(body.tag, 10),
    price: line(body.price, 12),
    orig: line(body.orig, 12),
    stock: line(body.stock, 6),
    city: line(body.city, 20),
    detail: multiline(body.detail, 5000),
    status: body.status === 'warehouse' ? 'warehouse' : 'onsale',
  };
  const errors = [];
  if (!CATS.includes(data.cat)) errors.push('请选择宝贝分类');
  if ([...data.title].length < 4) errors.push('宝贝标题至少 4 个字');
  const price = parseYuan(data.price);
  if (price === null || price <= 0) errors.push('一口价请填写 0.01 到 1000000 之间的金额，最多两位小数');
  let orig = 0;
  if (data.orig) {
    orig = parseYuan(data.orig);
    if (orig === null) errors.push('原价格式不正确');
    else if (price !== null && orig > 0 && orig <= price) errors.push('原价要高于一口价，没有原价请留空');
  }
  const stock = intIn(data.stock, 0, 9999);
  if (stock === null) errors.push('库存请填写 0 到 9999 的整数');
  if (!data.city) errors.push('请填写所在地');
  return { data: { ...data, price_cents: price, orig_cents: orig || 0, stockNum: stock }, errors };
}
