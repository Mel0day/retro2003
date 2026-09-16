import { Router } from 'express';
import { paginate } from '../lib/pager.js';
import { line } from '../lib/text.js';
import { intIn, httpError } from '../lib/http.js';
import { CATS, BANDS, SORTS, SORT_LABELS, listItems, catCounts } from '../services/items.js';
import { PAGES } from '../services/pages.js';

const PER_PAGE = 10;

// 列表页链接：省略默认值，保持地址干净
function listUrl(params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === '' || v == null || v === 'all' || v === 0 || v === 'default' || v === 1 && k === 'page') continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return `/${s ? `?${s}` : ''}`;
}

export default function homeRoutes(ctx) {
  const { db, settings } = ctx;
  const r = Router();

  r.get('/', (req, res) => {
    const cat = CATS.includes(req.query.cat) ? req.query.cat : 'all';
    const band = intIn(req.query.band, 0, BANDS.length - 1) ?? 0;
    const sort = typeof req.query.sort === 'string' && SORTS[req.query.sort] ? req.query.sort : 'default';
    const q = line(req.query.q, 40);
    const current = { cat, band, sort, q };
    const { total } = listItems(db, { ...current, limit: 0, offset: 0 });
    const pager = paginate({ total, page: typeof req.query.page === 'string' ? req.query.page : 1, perPage: PER_PAGE, baseUrl: listUrl(current) });
    const { rows } = listItems(db, { ...current, limit: PER_PAGE, offset: pager.offset });
    const counts = catCounts(db);
    const cats = [
      { key: 'all', label: '全部宝贝', n: res.locals.onsaleCount },
      ...counts.map((c) => ({ key: c.cat, label: c.cat, n: c.n })),
    ].map((c) => ({ ...c, active: c.key === cat, url: listUrl({ cat: c.key, band, q }) }));
    const bands = BANDS.map((b) => ({ ...b, active: b.id === band, url: listUrl({ ...current, band: b.id }) }));
    const sorts = SORT_LABELS.map(([key, label]) => ({ key, label, active: key === sort, url: listUrl({ ...current, sort: key }) }));
    const adUrl = settings.get('ad_url');
    res.render('list.njk', {
      title: q ? `搜索 ${q}` : (cat === 'all' ? '' : cat),
      crumbs: [{ text: cat === 'all' ? '全部宝贝' : cat }],
      nav: cat === 'all' ? 'home' : cat,
      cat, band, sort, q, total, pager, cats, bands, sorts, results: rows,
      adText: settings.get('ad_text'), adUrl: /^(\/(?!\/)|https?:\/\/)/.test(adUrl) ? adUrl : '',
    });
  });

  r.get('/page/:slug', (req, res) => {
    const pg = PAGES[req.params.slug];
    if (!pg || !Object.hasOwn(PAGES, req.params.slug)) throw httpError(404, '页面不存在。');
    res.render('pages/page.njk', { title: pg.title, crumbs: [{ text: pg.title }], pg, slug: req.params.slug });
  });

  return r;
}
