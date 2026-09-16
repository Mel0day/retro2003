import express from 'express';
import { requireRole } from '../../services/auth.js';
import { SETTING_FIELDS } from '../../lib/settings.js';
import { memoryUpload, saveImage, UploadError } from '../../lib/uploads.js';
import { intParam } from '../../lib/http.js';
import { safeUrl } from '../../lib/ubb.js';
import { now } from '../../lib/format.js';

function redirectWith(res, url, text, isError = false) {
  const sep = url.includes('?') ? '&' : '?';
  res.redirect(303, `${url}${sep}${isError ? 'err' : 'msg'}=${encodeURIComponent(text)}`);
}

class FormError extends Error {}

const str = (v, max) => String(v ?? '').trim().slice(0, max);
const sortOf = (v) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.max(-9999, Math.min(9999, n)) : 0;
};

// 链接：http(s):// 或站内 / 开头（不能是 //）
export function validLink(v, { allowEmpty = true } = {}) {
  const s = String(v || '').trim();
  if (!s) return allowEmpty ? '' : null;
  if (s.length > 500 || /[\s"'<>\\]/.test(s)) return null;
  if (/^https?:\/\/[^/\s]+/i.test(s)) return s;
  if (s.startsWith('/') && !s.startsWith('//')) return s;
  return null;
}

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const SLUG_RE = /^[a-z0-9-]{2,30}$/;

export default function adminSite(ctx) {
  const r = express.Router();
  const { db, settings } = ctx;
  r.use(['/channels', '/announcements', '/ads', '/links', '/pages', '/settings'], requireRole('admin'));

  // ---------------- 频道管理 ----------------
  r.get('/channels', (req, res) => {
    const list = db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM notes WHERE channel_id = c.id) AS total_notes FROM channels c ORDER BY sort, id`).all();
    res.render('admin/channels.njk', { title: '频道管理', adminNav: 'channels', list });
  });

  function channelInput(body, id = 0) {
    const slug = str(body.slug, 30).toLowerCase();
    const name = str(body.name, 20);
    if (!SLUG_RE.test(slug)) throw new FormError('频道标识只能是 2-30 位小写字母、数字或短横线');
    if (!name) throw new FormError('请填写频道名称');
    if (db.prepare('SELECT 1 FROM channels WHERE slug = ? AND id <> ?').get(slug, id)) throw new FormError(`频道标识「${slug}」已被使用`);
    return { slug, name, description: str(body.description, 100), sort: sortOf(body.sort) };
  }

  r.post('/channels', (req, res) => {
    try {
      const c = channelInput(req.body);
      db.prepare('INSERT INTO channels (slug, name, description, sort) VALUES (?, ?, ?, ?)').run(c.slug, c.name, c.description, c.sort);
      redirectWith(res, '/admin/channels', `频道「${c.name}」已添加`);
    } catch (e) {
      if (!(e instanceof FormError)) throw e;
      redirectWith(res, '/admin/channels', e.message, true);
    }
  });

  r.post('/channels/:id', (req, res) => {
    const id = intParam(req.params.id);
    if (!db.prepare('SELECT 1 FROM channels WHERE id = ?').get(id)) return redirectWith(res, '/admin/channels', '频道不存在', true);
    try {
      const c = channelInput(req.body, id);
      db.prepare('UPDATE channels SET slug = ?, name = ?, description = ?, sort = ? WHERE id = ?').run(c.slug, c.name, c.description, c.sort, id);
      redirectWith(res, '/admin/channels', `频道「${c.name}」已保存`);
    } catch (e) {
      if (!(e instanceof FormError)) throw e;
      redirectWith(res, '/admin/channels', e.message, true);
    }
  });

  r.post('/channels/:id/delete', (req, res) => {
    const ch = db.prepare('SELECT * FROM channels WHERE id = ?').get(intParam(req.params.id));
    if (!ch) return redirectWith(res, '/admin/channels', '频道不存在', true);
    const n = db.prepare('SELECT COUNT(*) AS n FROM notes WHERE channel_id = ?').get(ch.id).n;
    if (n) return redirectWith(res, '/admin/channels', `频道「${ch.name}」下还有 ${n} 篇笔记（含隐藏），请先移走或删除`, true);
    db.prepare('DELETE FROM channels WHERE id = ?').run(ch.id);
    redirectWith(res, '/admin/channels', `频道「${ch.name}」已删除`);
  });

  // ---------------- 公告跑马灯 ----------------
  r.get('/announcements', (req, res) => {
    const list = db.prepare('SELECT * FROM announcements ORDER BY sort, id').all();
    res.render('admin/announcements.njk', { title: '公告跑马灯', adminNav: 'announcements', list, marqueeOn: settings.bool('show_marquee') });
  });

  r.post('/announcements', (req, res) => {
    const content = str(req.body.content, 200);
    if (!content) return redirectWith(res, '/admin/announcements', '公告内容不能为空', true);
    db.prepare('INSERT INTO announcements (content, active, sort) VALUES (?, ?, ?)').run(content, req.body.active === '1' ? 1 : 0, sortOf(req.body.sort));
    redirectWith(res, '/admin/announcements', '公告已添加');
  });

  r.post('/announcements/:id', (req, res) => {
    const id = intParam(req.params.id);
    const content = str(req.body.content, 200);
    if (!content) return redirectWith(res, '/admin/announcements', '公告内容不能为空', true);
    const info = db.prepare('UPDATE announcements SET content = ?, active = ?, sort = ? WHERE id = ?').run(content, req.body.active === '1' ? 1 : 0, sortOf(req.body.sort), id);
    if (!info.changes) return redirectWith(res, '/admin/announcements', '公告不存在', true);
    redirectWith(res, '/admin/announcements', '公告已保存');
  });

  r.post('/announcements/:id/delete', (req, res) => {
    db.prepare('DELETE FROM announcements WHERE id = ?').run(intParam(req.params.id));
    redirectWith(res, '/admin/announcements', '公告已删除');
  });

  // ---------------- 广告管理 ----------------
  r.get('/ads', (req, res) => {
    const list = db.prepare("SELECT * FROM ads ORDER BY slot = 'sidebar', sort, id").all();
    res.render('admin/ads.njk', { title: '广告管理', adminNav: 'ads', list });
  });

  const adForm = (res, data) => res.render('admin/ad_form.njk', { title: data.ad?.id ? '编辑广告' : '添加广告', adminNav: 'ads', ...data });

  r.get('/ads/new', (req, res) => adForm(res, { ad: { slot: req.query.slot === 'sidebar' ? 'sidebar' : 'header', style: 'rainbow', bg: '#003366', active: 1, sort: 0 } }));

  r.get('/ads/:id/edit', (req, res) => {
    const ad = db.prepare('SELECT * FROM ads WHERE id = ?').get(intParam(req.params.id));
    if (!ad) return redirectWith(res, '/admin/ads', '广告不存在', true);
    adForm(res, { ad });
  });

  function adInput(req) {
    const b = req.body;
    const ad = {
      slot: b.slot === 'sidebar' ? 'sidebar' : 'header',
      style: ['rainbow', 'solid', 'image'].includes(b.style) ? b.style : 'solid',
      title: str(b.title, 40),
      subtitle: str(b.subtitle, 60),
      cta: str(b.cta, 12),
      link: validLink(b.link),
      bg: str(b.bg, 7) || '#003366',
      image: str(b.image, 500),
      active: b.active === '1' ? 1 : 0,
      sort: sortOf(b.sort),
    };
    if (!ad.title) throw new FormError('请填写广告标题（图片广告用作 alt 文字）');
    if (ad.link === null) throw new FormError('链接地址只能以 http://、https:// 或站内 / 开头');
    if (!HEX_RE.test(ad.bg)) throw new FormError('背景色需为 #RGB 或 #RRGGBB 格式');
    if (req.file) {
      ad.image = saveImage(ctx, { buffer: req.file.buffer, userId: req.user.id, purpose: 'ad' }).url;
    } else if (ad.image && !safeUrl(ad.image, { image: true })) {
      throw new FormError('图片地址只能是 /uploads/ 下的文件或 http(s) 地址');
    }
    if (ad.style === 'image' && !ad.image) throw new FormError('图片广告请上传图片或填写图片地址');
    return ad;
  }

  function saveAd(req, res, id) {
    let ad;
    try {
      ad = adInput(req);
    } catch (e) {
      if (!(e instanceof FormError) && !(e instanceof UploadError)) throw e;
      return adForm(res.status(400), { ad: { ...req.body, id }, error: e.message });
    }
    if (id) {
      db.prepare(`UPDATE ads SET slot = @slot, style = @style, title = @title, subtitle = @subtitle, cta = @cta, link = @link,
        bg = @bg, image = @image, active = @active, sort = @sort WHERE id = @id`).run({ ...ad, id });
    } else {
      db.prepare(`INSERT INTO ads (slot, style, title, subtitle, cta, link, bg, image, active, sort)
        VALUES (@slot, @style, @title, @subtitle, @cta, @link, @bg, @image, @active, @sort)`).run(ad);
    }
    redirectWith(res, '/admin/ads', `广告「${ad.title}」已保存`);
  }

  r.post('/ads', memoryUpload.single('image_file'), (req, res) => saveAd(req, res, 0));

  r.post('/ads/:id', memoryUpload.single('image_file'), (req, res) => {
    const id = intParam(req.params.id);
    if (!db.prepare('SELECT 1 FROM ads WHERE id = ?').get(id)) return redirectWith(res, '/admin/ads', '广告不存在', true);
    saveAd(req, res, id);
  });

  r.post('/ads/:id/toggle', (req, res) => {
    db.prepare('UPDATE ads SET active = 1 - active WHERE id = ?').run(intParam(req.params.id));
    redirectWith(res, '/admin/ads', '广告状态已切换');
  });

  r.post('/ads/:id/delete', (req, res) => {
    db.prepare('DELETE FROM ads WHERE id = ?').run(intParam(req.params.id));
    redirectWith(res, '/admin/ads', '广告已删除');
  });

  // ---------------- 友情链接 ----------------
  r.get('/links', (req, res) => {
    res.render('admin/links.njk', { title: '友情链接', adminNav: 'links', list: db.prepare('SELECT * FROM links ORDER BY sort, id').all() });
  });

  function linkInput(body) {
    const name = str(body.name, 20);
    const url = validLink(body.url, { allowEmpty: false });
    if (!name) throw new FormError('请填写网站名称');
    if (!url) throw new FormError('网址只能以 http://、https:// 或站内 / 开头');
    return { name, url, sort: sortOf(body.sort) };
  }

  r.post('/links', (req, res) => {
    try {
      const l = linkInput(req.body);
      db.prepare('INSERT INTO links (name, url, sort) VALUES (?, ?, ?)').run(l.name, l.url, l.sort);
      redirectWith(res, '/admin/links', `友情链接「${l.name}」已添加`);
    } catch (e) {
      if (!(e instanceof FormError)) throw e;
      redirectWith(res, '/admin/links', e.message, true);
    }
  });

  r.post('/links/:id', (req, res) => {
    try {
      const l = linkInput(req.body);
      const info = db.prepare('UPDATE links SET name = ?, url = ?, sort = ? WHERE id = ?').run(l.name, l.url, l.sort, intParam(req.params.id));
      if (!info.changes) return redirectWith(res, '/admin/links', '链接不存在', true);
      redirectWith(res, '/admin/links', `友情链接「${l.name}」已保存`);
    } catch (e) {
      if (!(e instanceof FormError)) throw e;
      redirectWith(res, '/admin/links', e.message, true);
    }
  });

  r.post('/links/:id/delete', (req, res) => {
    db.prepare('DELETE FROM links WHERE id = ?').run(intParam(req.params.id));
    redirectWith(res, '/admin/links', '友情链接已删除');
  });

  // ---------------- 单页管理 ----------------
  r.get('/pages', (req, res) => {
    res.render('admin/pages.njk', { title: '单页管理', adminNav: 'pages', list: db.prepare('SELECT slug, title, sort, updated_at, length(content) AS len FROM pages ORDER BY sort, slug').all() });
  });

  const pageForm = (res, data) => res.render('admin/page_form.njk', { title: data.isNew ? '新增单页' : '编辑单页', adminNav: 'pages', ...data });

  r.get('/pages/new', (req, res) => pageForm(res, { isNew: true, page: { slug: '', title: '', content: '', sort: 0 } }));

  r.get('/pages/:slug/edit', (req, res) => {
    const page = db.prepare('SELECT * FROM pages WHERE slug = ?').get(req.params.slug);
    if (!page) return redirectWith(res, '/admin/pages', '单页不存在', true);
    pageForm(res, { page });
  });

  function pageInput(body) {
    const title = str(body.title, 40);
    const content = String(body.content || '').replace(/\r\n?/g, '\n').slice(0, 50000);
    if (!title) throw new FormError('请填写页面标题');
    return { title, content, sort: sortOf(body.sort) };
  }

  r.post('/pages', (req, res) => {
    const slug = str(req.body.slug, 30).toLowerCase();
    try {
      if (!SLUG_RE.test(slug)) throw new FormError('页面标识只能是 2-30 位小写字母、数字或短横线');
      if (db.prepare('SELECT 1 FROM pages WHERE slug = ?').get(slug)) throw new FormError(`页面标识「${slug}」已存在`);
      const p = pageInput(req.body);
      db.prepare('INSERT INTO pages (slug, title, content, sort, updated_at) VALUES (?, ?, ?, ?, ?)').run(slug, p.title, p.content, p.sort, now());
      redirectWith(res, '/admin/pages', `单页「${p.title}」已创建，访问地址 /page/${slug}`);
    } catch (e) {
      if (!(e instanceof FormError)) throw e;
      pageForm(res.status(400), { isNew: true, page: { ...req.body, slug }, error: e.message });
    }
  });

  r.post('/pages/:slug', (req, res) => {
    const page = db.prepare('SELECT * FROM pages WHERE slug = ?').get(req.params.slug);
    if (!page) return redirectWith(res, '/admin/pages', '单页不存在', true);
    try {
      const p = pageInput(req.body);
      db.prepare('UPDATE pages SET title = ?, content = ?, sort = ?, updated_at = ? WHERE slug = ?').run(p.title, p.content, p.sort, now(), page.slug);
      redirectWith(res, '/admin/pages', `单页「${p.title}」已保存`);
    } catch (e) {
      if (!(e instanceof FormError)) throw e;
      pageForm(res.status(400), { page: { ...page, ...req.body, slug: page.slug }, error: e.message });
    }
  });

  r.post('/pages/:slug/delete', (req, res) => {
    const info = db.prepare('DELETE FROM pages WHERE slug = ?').run(req.params.slug);
    if (!info.changes) return redirectWith(res, '/admin/pages', '单页不存在', true);
    redirectWith(res, '/admin/pages', `单页 ${req.params.slug} 已删除`);
  });

  // ---------------- 站点设置 ----------------
  r.get('/settings', (req, res) => {
    res.render('admin/settings.njk', { title: '站点设置', adminNav: 'settings', fields: SETTING_FIELDS, values: settings.all() });
  });

  r.post('/settings', (req, res) => {
    const updates = {};
    for (const f of SETTING_FIELDS) {
      const raw = req.body[f.key];
      if (f.type === 'bool') {
        updates[f.key] = raw === '1' ? '1' : '0';
      } else if (f.type === 'number') {
        const s = String(raw ?? '').trim();
        if (!/^\d{1,12}$/.test(s)) return redirectWith(res, '/admin/settings', `「${f.label}」需要填写非负整数`, true);
        updates[f.key] = String(parseInt(s, 10));
      } else {
        const max = f.type === 'textarea' ? 2000 : 200;
        updates[f.key] = String(raw ?? '').replace(/\r\n?/g, '\n').trim().slice(0, max);
      }
    }
    if (!updates.site_name) return redirectWith(res, '/admin/settings', '站点名称不能为空', true);
    if (updates.upload_max_kb !== undefined && Number(updates.upload_max_kb) < 10) return redirectWith(res, '/admin/settings', '单张图片上限至少 10KB', true);
    if (updates.webmaster_email && !/^[^\s@<>"']+@[^\s@<>"']+$/.test(updates.webmaster_email)) return redirectWith(res, '/admin/settings', '站长信箱格式不正确', true);
    settings.setMany(updates);
    redirectWith(res, '/admin/settings', '站点设置已保存');
  });

  return r;
}
