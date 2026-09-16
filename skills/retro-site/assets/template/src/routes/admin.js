// 站长后台：统计、会员、内容、留言、站点设置
import { Router } from 'express';
import { intParam, httpError } from '../lib/http.js';
import { line, multiline, likeEscape } from '../lib/text.js';
import { now } from '../lib/format.js';
import { paginate } from '../lib/pager.js';
import { requireAdmin, destroyUserSessions } from '../services/auth.js';
import { SETTING_FIELDS } from '../lib/settings.js';

export default function adminRoutes(ctx) {
  const { db, settings } = ctx;
  const r = Router();
  r.use(requireAdmin);
  const pageNo = (req) => (typeof req.query.page === 'string' ? req.query.page : 1);

  r.get('/', (req, res) => {
    const one = (sql, ...p) => db.prepare(sql).get(...p).n;
    const t = now();
    res.render('admin/index.njk', {
      title: '后台首页',
      stat: {
        users: one('SELECT COUNT(*) AS n FROM users'),
        newUsers: one('SELECT COUNT(*) AS n FROM users WHERE created_at > ?', t - 86400),
        entries: one("SELECT COUNT(*) AS n FROM entries WHERE status = 'public'"),
        todayEntries: one('SELECT COUNT(*) AS n FROM entries WHERE created_at > ?', t - 86400),
        comments: one('SELECT COUNT(*) AS n FROM comments WHERE hidden = 0'),
        visitors: res.locals.visitorsShown,
      },
      recent: db.prepare(`SELECT e.*, u.username AS author_name FROM entries e JOIN users u ON u.id = e.author_id ORDER BY e.id DESC LIMIT 10`).all(),
    });
  });

  r.get('/users', (req, res) => {
    const q = line(req.query.q, 40);
    const where = q ? "WHERE username LIKE ? ESCAPE '\\'" : '';
    const params = q ? [`%${likeEscape(q)}%`] : [];
    const total = db.prepare(`SELECT COUNT(*) AS n FROM users ${where}`).get(...params).n;
    const pager = paginate({ total, page: pageNo(req), perPage: 30, baseUrl: `/admin/users${q ? `?q=${encodeURIComponent(q)}` : ''}` });
    const users = db.prepare(`SELECT * FROM users ${where} ORDER BY id DESC LIMIT 30 OFFSET ?`).all(...params, pager.offset);
    res.render('admin/users.njk', { title: '会员管理', users, q, pager, total });
  });

  r.post('/users/:id/ban', (req, res) => {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(intParam(req.params.id));
    if (!u) throw httpError(404, '会员不存在。');
    if (u.role === 'admin') return res.message({ title: '不能操作', text: '不能封禁站长账号。', ok: false, status: 400 });
    const ban = req.body.ban === '1';
    db.prepare('UPDATE users SET banned = ?, ban_reason = ? WHERE id = ?').run(ban ? 1 : 0, ban ? line(req.body.reason, 60) : '', u.id);
    if (ban) destroyUserSessions(ctx, u.id);
    res.redirect('/admin/users');
  });

  r.get('/entries', (req, res) => {
    const q = line(req.query.q, 40);
    const where = q ? "WHERE e.title LIKE ? ESCAPE '\\'" : '';
    const params = q ? [`%${likeEscape(q)}%`] : [];
    const total = db.prepare(`SELECT COUNT(*) AS n FROM entries e ${where}`).get(...params).n;
    const pager = paginate({ total, page: pageNo(req), perPage: 30, baseUrl: `/admin/entries${q ? `?q=${encodeURIComponent(q)}` : ''}` });
    const entries = db.prepare(`SELECT e.*, u.username AS author_name FROM entries e JOIN users u ON u.id = e.author_id ${where} ORDER BY e.id DESC LIMIT 30 OFFSET ?`).all(...params, pager.offset);
    const comments = db.prepare(`SELECT c.*, u.username, e.title FROM comments c JOIN users u ON u.id = c.user_id JOIN entries e ON e.id = c.entry_id ORDER BY c.id DESC LIMIT 30`).all();
    res.render('admin/entries.njk', { title: '内容管理', entries, comments, q, pager, total });
  });

  r.post('/entries/:id/hide', (req, res) => {
    const hide = req.body.hide === '1';
    db.prepare('UPDATE entries SET status = ?, updated_at = ? WHERE id = ?').run(hide ? 'hidden' : 'public', now(), intParam(req.params.id));
    res.redirect('/admin/entries');
  });

  r.post('/comments/:id/hide', (req, res) => {
    db.prepare('UPDATE comments SET hidden = ? WHERE id = ?').run(req.body.hide === '1' ? 1 : 0, intParam(req.params.id));
    res.redirect('/admin/entries');
  });

  r.get('/settings', (req, res) => res.render('admin/settings.njk', { title: '站点设置', fields: SETTING_FIELDS, s: settings.all(), saved: req.query.saved === '1' }));

  r.post('/settings', (req, res) => {
    const values = {};
    for (const f of SETTING_FIELDS) {
      const v = req.body[f.key];
      if (f.type === 'bool') values[f.key] = v === '1' ? '1' : '0';
      else if (f.type === 'number') values[f.key] = /^\d{1,9}$/.test(String(v ?? '').trim()) ? String(v).trim() : '0';
      else if (f.type === 'textarea') values[f.key] = multiline(v, f.max);
      else values[f.key] = line(v, f.max);
    }
    settings.setMany(values);
    res.redirect('/admin/settings?saved=1');
  });

  return r;
}
