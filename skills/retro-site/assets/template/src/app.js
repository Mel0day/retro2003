import express from 'express';
import nunjucks from 'nunjucks';
import path from 'node:path';
import { openDb } from './db/index.js';
import { createSettings } from './lib/settings.js';
import { createRateLimiter } from './lib/ratelimit.js';
import * as fmt from './lib/format.js';
import { nl2br, highlight } from './lib/text.js';
import { cookies, securityHeaders, visitor, csrf } from './middleware/basics.js';
import { multipartParser, UploadError } from './lib/uploads.js';
import { loadUser, ensureAdmin, isAdmin } from './services/auth.js';
import { wantsJson } from './lib/http.js';
import { CHANNELS } from './services/entries.js';

import homeRoutes from './routes/home.js';
import authRoutes from './routes/auth.js';
import entryRoutes from './routes/entries.js';
import myRoutes from './routes/my.js';
import adminRoutes from './routes/admin.js';

export function createApp(config) {
  const db = openDb(config.dbFile);
  const settings = createSettings(db);
  const ctx = { config, db, settings, limiter: createRateLimiter({ disabled: config.disableRateLimit }) };
  ensureAdmin(ctx);

  const app = express();
  app.set('trust proxy', config.trustProxy === 'true' ? true : config.trustProxy);
  app.disable('x-powered-by');

  const env = nunjucks.configure(path.join(config.root, 'views'), {
    autoescape: true, express: app, noCache: !config.isProd, throwOnUndefined: false,
  });
  app.set('view engine', 'njk');
  env.addFilter('dt', fmt.dateTime);
  env.addFilter('date', fmt.dateOnly);
  env.addFilter('md', fmt.monthDay);
  env.addFilter('ago', fmt.ago);
  env.addFilter('yuan', fmt.yuan);
  env.addFilter('thousands', fmt.thousands);
  env.addFilter('cut', fmt.truncate);
  env.addFilter('nl2br', (s) => new nunjucks.runtime.SafeString(nl2br(s)));
  env.addFilter('highlight', (s, q) => new nunjucks.runtime.SafeString(highlight(s, q)));
  env.addGlobal('assetVersion', Date.now().toString(36));
  env.addGlobal('CHANNELS', CHANNELS);

  app.use(securityHeaders());
  app.get('/healthz', (req, res) => { db.prepare('SELECT 1').get(); res.json({ ok: true }); });
  app.use('/static', express.static(path.join(config.root, 'public'), { maxAge: config.isProd ? '7d' : 0 }));
  app.use('/uploads/seed', express.static(path.join(config.root, 'seed/images'), { maxAge: '30d', fallthrough: false, index: false }));
  app.use('/uploads', express.static(config.uploadDir, { maxAge: '30d', fallthrough: false, index: false, dotfiles: 'deny' }));
  app.get('/favicon.ico', (req, res) => res.sendFile(path.join(config.root, 'public/img/favicon.ico')));
  app.get('/robots.txt', (req, res) => res.type('text/plain').send('User-agent: *\nDisallow: /admin\nDisallow: /my\n'));

  app.use(cookies());
  app.use(visitor(ctx));
  app.use(express.urlencoded({ extended: false, limit: '200kb', parameterLimit: 200 }));
  app.use(express.json({ limit: '200kb' }));
  app.use(multipartParser());
  app.use(loadUser(ctx));
  if (config.logRequests) {
    app.use((req, res, next) => {
      const t = Date.now();
      res.on('finish', () => console.log(`${req.method} ${req.originalUrl.slice(0, 200)} ${res.statusCode} ${Date.now() - t}ms`));
      next();
    });
  }

  // 页面公共数据：放在 CSRF 校验之前，出错页（403/413）也有完整的页头
  app.use((req, res, next) => {
    const s = settings.all();
    res.locals.site = s;
    res.locals.user = req.user;
    res.locals.isAdmin = isAdmin(req.user);
    res.locals.path = req.path;
    res.locals.here = req.method === 'GET' ? req.originalUrl.slice(0, 300) : '/';
    res.locals.today = fmt.chineseToday();
    res.locals.entryCount = db.prepare("SELECT COUNT(*) AS n FROM entries WHERE status = 'public'").get().n;
    res.locals.memberCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
    res.locals.visitorsShown = String((parseInt(s.counter_base, 10) || 0) + (parseInt(s.visitor_count, 10) || 0)).padStart(7, '0');
    // 2003 年式提示页：「操作成功！3 秒后自动跳转」
    res.message = ({ title = '提示信息', text, back = true, redirect = null, status = 200, ok = true }) => {
      res.status(status).render('message.njk', { title, text, back, redirect, ok, backUrl: sameOriginReferer(req) });
    };
    next();
  });
  app.use(csrf(ctx));

  app.use(homeRoutes(ctx));
  app.use(authRoutes(ctx));
  app.use(entryRoutes(ctx));
  app.use(myRoutes(ctx));
  app.use('/admin', adminRoutes(ctx));

  app.use((req, res) => {
    if (wantsJson(req)) return res.status(404).json({ ok: false, error: '接口不存在' });
    res.message({ title: '404 页面不存在', text: '您要访问的页面不存在或已被删除。', ok: false, status: 404 });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    let status = err.status || err.statusCode || 500;
    let text = status < 500 ? err.message : '服务器开小差了，请稍后再试。';
    if (err instanceof UploadError) { status = err.status; text = err.message; }
    if (err.type === 'entity.too.large') { status = 413; text = '提交的内容太长了'; }
    if (err.type === 'entity.parse.failed' || err.type === 'parameters.too.many') { status = 400; text = '提交的数据格式不正确'; }
    if (status >= 500) console.error(err);
    if (res.headersSent) return;
    if (wantsJson(req)) return res.status(status).json({ ok: false, error: text });
    try {
      if (!res.message) {
        res.locals.site ??= settings.all();
        return res.status(status).render('message.njk', { title: '出错了', text, back: true, ok: false });
      }
      res.message({ title: status === 404 ? '404 页面不存在' : '出错了', text, ok: false, status });
    } catch (e) {
      console.error(e);
      res.status(status).type('text/plain').send(text);
    }
  });

  return { app, ctx, db, close: () => db.close() };
}

function sameOriginReferer(req) {
  try {
    const u = new URL(req.get('referer') || '');
    if (u.host === req.get('host')) return u.pathname + u.search;
  } catch { /* 无来源页 */ }
  return '';
}
