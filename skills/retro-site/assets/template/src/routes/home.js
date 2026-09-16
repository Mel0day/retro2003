import { Router } from 'express';
import { paginate } from '../lib/pager.js';
import { line } from '../lib/text.js';
import { CHANNELS, PER_PAGE, listEntries, channelCounts } from '../services/entries.js';

export default function homeRoutes(ctx) {
  const { db } = ctx;
  const r = Router();

  r.get('/', (req, res) => {
    const channel = CHANNELS.includes(req.query.channel) ? req.query.channel : '';
    const q = line(req.query.q, 40);
    const { total } = listEntries(db, { channel, q, limit: 0, offset: 0 });
    const qs = new URLSearchParams(Object.entries({ channel, q }).filter(([, v]) => v));
    const pager = paginate({ total, page: typeof req.query.page === 'string' ? req.query.page : 1, perPage: PER_PAGE, baseUrl: `/${qs.toString() ? `?${qs}` : ''}` });
    const { rows } = listEntries(db, { channel, q, limit: PER_PAGE, offset: pager.offset });
    const hot = db.prepare("SELECT id, title, views FROM entries WHERE status = 'public' ORDER BY views DESC, id DESC LIMIT 8").all();
    res.render('home.njk', {
      title: q ? `搜索 ${q}` : (channel || ''),
      crumbs: [{ text: channel || '全部内容' }],
      nav: channel || 'home',
      channel, q, total, pager, entries: rows, hot,
      channels: channelCounts(db),
    });
  });

  r.get('/page/:slug', (req, res) => {
    const PAGES = {
      about: { title: '关于本站', paras: ['这里写站点简介。', '本站是 2003 年风格的复刻演示站点。'] },
      contact: { title: '联系我们', paras: ['站长信箱见页脚。'] },
      help: { title: '帮助中心', paras: ['怎么发布内容？ 注册登录后点顶部的「我要发布」。', '忘记密码怎么办？ 请发邮件给站长。'] },
    };
    const pg = PAGES[req.params.slug];
    if (!pg) return res.message({ title: '404 页面不存在', text: '您要访问的页面不存在。', ok: false, status: 404 });
    res.render('pages/page.njk', { title: pg.title, crumbs: [{ text: pg.title }], pg });
  });

  return r;
}
