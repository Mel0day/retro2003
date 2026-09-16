import express from 'express';
import * as portal from '../services/portal.js';
import { renderCaptchaSvg } from '../lib/captcha.js';
import { render as ubbRender } from '../lib/ubb.js';
import { memoryUpload, saveImage } from '../lib/uploads.js';
import { requireLogin } from '../services/auth.js';
import { isMobileUA } from '../lib/http.js';
import { levelInfo } from '../lib/levels.js';
import { thousands } from '../lib/format.js';

const CAPTCHA_SCOPES = new Set(['login', 'register', 'comment', 'forgot', 'report', 'wap']);

export default function homeRoutes(ctx) {
  const r = express.Router();
  const { db } = ctx;

  r.get('/', (req, res) => {
    if (isMobileUA(req.headers['user-agent']) && req.cookies.pc !== '1') return res.redirect('/wap');

    let member = null;
    if (req.user) {
      member = {
        ...levelInfo(req.user),
        favorites: db.prepare('SELECT COUNT(*) AS n FROM favorites WHERE user_id = ?').get(req.user.id).n,
      };
    }
    res.render('home.njk', {
      nav: 'home',
      member,
      channels: portal.channels(ctx),
      links: portal.links(ctx),
      featured: portal.featuredNotes(ctx, 6),
      latest: portal.latestNotes(ctx, { limit: 12 }),
      goods: portal.featuredProducts(ctx, 5),
      threads: portal.hotThreads(ctx, 5),
      tags: portal.hotTags(ctx, 12),
      ranking: portal.rankNotes(ctx, { limit: 10 }),
      counter: portal.counterDigits(ctx),
      online: thousands(ctx.online.count()),
    });
  });

  r.get('/captcha.svg', (req, res) => {
    const scope = CAPTCHA_SCOPES.has(req.query.scope) ? req.query.scope : 'login';
    const code = ctx.captcha.issue(req.vid, scope);
    res.set('Cache-Control', 'no-store');
    res.type('image/svg+xml').send(renderCaptchaSvg(code));
  });

  r.post('/api/ubb/preview', (req, res) => {
    const content = String(req.body.content || '').slice(0, 50000);
    const mode = ['note', 'post', 'comment'].includes(req.body.mode) ? req.body.mode : 'note';
    res.json({ ok: true, html: ubbRender(content, mode) });
  });

  r.post('/api/upload', requireLogin, memoryUpload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ ok: false, error: '没有收到图片' });
    if (!ctx.limiter.check(`upload:${req.user.id}`, 60, 3600_000)) {
      return res.status(429).json({ ok: false, error: '上传太频繁了，休息一下吧' });
    }
    const purpose = ['note', 'post', 'product', 'ad'].includes(req.query.purpose) ? req.query.purpose : 'note';
    const saved = saveImage(ctx, { buffer: req.file.buffer, userId: req.user.id, purpose });
    res.json({ ok: true, url: saved.url, size: saved.size });
  });

  return r;
}
