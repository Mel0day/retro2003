import express from 'express';
import nunjucks from 'nunjucks';
import path from 'node:path';
import fs from 'node:fs';
import { openDb } from './db/index.js';
import { createSettings } from './lib/settings.js';
import { createCaptchaStore } from './lib/captcha.js';
import { createRateLimiter } from './lib/ratelimit.js';
import * as fmt from './lib/format.js';
import { render as ubb, escapeHtml } from './lib/ubb.js';
import { levelInfo } from './lib/levels.js';
import { cookies, securityHeaders, visitor, csrf, createOnlineTracker } from './middleware/basics.js';
import { loadUser, isMod, isAdmin } from './services/auth.js';
import { ensureAdmin } from './services/bootstrap.js';
import { createChatHub } from './services/chat.js';
import { UploadError } from './lib/uploads.js';
import { pickAd, marquee } from './services/portal.js';

import homeRoutes from './routes/home.js';
import authRoutes from './routes/auth.js';
import noteRoutes from './routes/notes.js';
import userRoutes from './routes/users.js';
import messageRoutes from './routes/messages.js';
import shopRoutes from './routes/shop.js';
import forumRoutes from './routes/forum.js';
import albumRoutes from './routes/album.js';
import rankRoutes from './routes/rank.js';
import chatRoutes from './routes/chat.js';
import searchRoutes from './routes/search.js';
import pageRoutes from './routes/pages.js';
import adminRoutes from './routes/admin.js';
import wapRoutes from './routes/wap.js';

export function createApp(config) {
  const db = openDb(config.dbFile);
  const settings = createSettings(db);
  const ctx = {
    config, db, settings,
    captcha: createCaptchaStore({ testCode: config.captchaTestCode }),
    limiter: createRateLimiter({ disabled: config.disableRateLimit }),
    online: createOnlineTracker(),
  };
  ctx.chat = createChatHub(ctx);
  ensureAdmin(ctx);

  const app = express();
  app.set('trust proxy', config.trustProxy === 'true' ? true : config.trustProxy);
  app.disable('x-powered-by');

  const env = nunjucks.configure(path.join(config.root, 'views'), {
    autoescape: true,
    express: app,
    noCache: !config.isProd,
    throwOnUndefined: false,
  });
  app.set('view engine', 'njk');
  env.addFilter('dt', fmt.dateTime);
  env.addFilter('date', fmt.dateOnly);
  env.addFilter('md', fmt.monthDay);
  env.addFilter('ago', fmt.ago);
  env.addFilter('clock', fmt.timeOnly);
  env.addFilter('yuan', fmt.yuan);
  env.addFilter('size', fmt.fileSize);
  env.addFilter('thousands', fmt.thousands);
  env.addFilter('cut', fmt.truncate);
  env.addFilter('ubb', (s, mode) => new nunjucks.runtime.SafeString(ubb(s, mode)));
  env.addFilter('level', (u) => levelInfo(u));
  // 写进 style 属性的颜色只允许 #RGB / #RRGGBB
  env.addFilter('cssColor', (c, fallback = '#999999') => (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(String(c || '')) ? c : fallback));
  env.addFilter('initial', (s) => [...String(s || '?')][0].toUpperCase());
  env.addFilter('highlight', (s, q) => {
    const text = escapeHtml(s);
    const kw = String(q || '').trim();
    if (!kw) return new nunjucks.runtime.SafeString(text);
    const e = escapeHtml(kw).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new nunjucks.runtime.SafeString(text.replace(new RegExp(e, 'gi'), (m) => `<b class="hl">${m}</b>`));
  });
  env.addFilter('qs', (obj) => new URLSearchParams(Object.entries(obj).filter(([, v]) => v !== '' && v != null)).toString());
  env.addGlobal('assetVersion', Date.now().toString(36));
  env.addGlobal('headerAd', () => pickAd(ctx, 'header'));
  env.addGlobal('sidebarAd', () => pickAd(ctx, 'sidebar'));
  env.addGlobal('marquee', () => marquee(ctx));

  app.use(securityHeaders());
  app.get('/healthz', (req, res) => {
    db.prepare('SELECT 1').get();
    res.json({ ok: true });
  });
  app.use('/static', express.static(path.join(config.root, 'public'), { maxAge: config.isProd ? '7d' : 0 }));
  app.use('/uploads', express.static(config.uploadDir, { maxAge: '30d', fallthrough: false }));
  app.get('/favicon.ico', (req, res) => res.sendFile(path.join(config.root, 'public/img/favicon.ico')));
  app.get('/robots.txt', (req, res) => res.type('text/plain').send('User-agent: *\nDisallow: /admin\nDisallow: /my\nDisallow: /pm\n'));

  app.use(cookies());
  app.use(visitor(ctx));
  app.use(express.urlencoded({ extended: false, limit: '2mb' }));
  app.use(express.json({ limit: '2mb' }));
  app.use(csrf(ctx));
  app.use(loadUser(ctx));
  if (config.logRequests) {
    app.use((req, res, next) => {
      const t = Date.now();
      res.on('finish', () => console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - t}ms`));
      next();
    });
  }

  app.use((req, res, next) => {
    // 任意页面带 ?pc=1 都记住「电脑版」偏好，手机访问首页不再跳 WAP
    if (req.query.pc === '1' && req.cookies.pc !== '1') {
      res.setCookie('pc', '1', { maxAge: 30 * 86400 });
      req.cookies.pc = '1';
    }
    const s = settings.all();
    res.locals.site = s;
    res.locals.user = req.user;
    res.locals.isMod = isMod(req.user);
    res.locals.isAdmin = isAdmin(req.user);
    res.locals.path = req.path;
    res.locals.url = req.originalUrl;
    res.locals.today = fmt.chineseToday();
    res.locals.unread = req.user
      ? db.prepare('SELECT COUNT(*) AS n FROM messages WHERE to_id = ? AND read_at IS NULL AND receiver_deleted = 0').get(req.user.id).n
      : 0;
    // 2003 年式提示页：「操作成功！3 秒后自动跳转」
    res.message = ({ title = '提示信息', text, back = true, redirect = null, status = 200, ok = true, wap = false }) => {
      res.status(status).render(wap ? 'wap/message.njk' : 'message.njk', { title, text, back, redirect, ok });
    };
    next();
  });

  app.use(homeRoutes(ctx));
  app.use(authRoutes(ctx));
  app.use(noteRoutes(ctx));
  app.use(userRoutes(ctx));
  app.use(messageRoutes(ctx));
  app.use(shopRoutes(ctx));
  app.use(forumRoutes(ctx));
  app.use(albumRoutes(ctx));
  app.use(rankRoutes(ctx));
  app.use(chatRoutes(ctx));
  app.use(searchRoutes(ctx));
  app.use(pageRoutes(ctx));
  app.use('/admin', adminRoutes(ctx));
  app.use('/wap', wapRoutes(ctx));

  app.use((req, res) => {
    res.status(404);
    if (req.path.startsWith('/api/')) return res.json({ ok: false, error: '接口不存在' });
    res.render(req.path.startsWith('/wap') ? 'wap/message.njk' : 'message.njk', {
      title: '404 页面不存在', text: '您要访问的页面不存在或已被删除。', back: true, ok: false,
    });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    let status = err.status || err.statusCode || 500;
    let text = err.expose !== false && status < 500 ? err.message : '服务器开小差了，请稍后再试。';
    if (err instanceof UploadError) { status = 400; text = err.message; }
    if (err.code === 'LIMIT_FILE_SIZE') { status = 400; text = '上传的文件太大了'; }
    if (err.type === 'entity.too.large') { status = 413; text = '提交的内容太长了'; }
    if (status >= 500) console.error(err);
    if (res.headersSent) return;
    res.status(status);
    if (req.path.startsWith('/api/') || req.get('x-requested-with') === 'fetch') {
      return res.json({ ok: false, error: text });
    }
    try {
      res.locals.site ??= settings.all();
      res.render(req.path.startsWith('/wap') ? 'wap/message.njk' : 'message.njk', { title: '出错了', text, back: true, ok: false });
    } catch {
      res.type('text/plain').send(text);
    }
  });

  const close = () => {
    ctx.chat.close();
    db.close();
  };
  return { app, ctx, db, close };
}

export function ensureDirs(config) {
  fs.mkdirSync(config.uploadDir, { recursive: true });
}
