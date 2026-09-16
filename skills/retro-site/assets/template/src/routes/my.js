import { Router } from 'express';
import { intParam } from '../lib/http.js';
import { line, multiline } from '../lib/text.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { requireLogin, destroyUserSessions } from '../services/auth.js';

export default function myRoutes(ctx) {
  const { db, limiter } = ctx;
  const r = Router();
  const page = (req, res, extra = {}) => {
    const me = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    const mine = db.prepare("SELECT * FROM entries WHERE author_id = ? AND status <> 'deleted' ORDER BY id DESC LIMIT 50").all(req.user.id);
    const comments = db.prepare(`SELECT c.*, e.title FROM comments c JOIN entries e ON e.id = c.entry_id
      WHERE c.user_id = ? ORDER BY c.id DESC LIMIT 20`).all(req.user.id);
    res.render('my.njk', { title: '我的空间', crumbs: [{ text: '我的空间' }], me, mine, comments, saved: false, pwErr: '', pwOk: '', ...extra });
  };

  r.get('/my', requireLogin, (req, res) => page(req, res, { saved: req.query.saved === '1' }));

  r.post('/my/profile', requireLogin, (req, res) => {
    db.prepare('UPDATE users SET city = ?, intro = ? WHERE id = ?').run(line(req.body.city, 20), multiline(req.body.intro, 300), req.user.id);
    res.redirect('/my?saved=1');
  });

  r.post('/my/password', requireLogin, (req, res) => {
    const s = (v) => (typeof v === 'string' ? v : '');
    if (!limiter.check(`pw:${req.user.id}`, 10, 3600_000)) return page(req, res, { pwErr: '操作太频繁，请稍后再试' });
    const u = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!verifyPassword(s(req.body.old), u.password_hash)) return page(req, res, { pwErr: '原密码不正确' });
    const npw = s(req.body.password);
    if (npw.length < 6 || npw.length > 64) return page(req, res, { pwErr: '新密码长度为 6-64 位' });
    if (npw !== s(req.body.password2)) return page(req, res, { pwErr: '两次输入的新密码不一致' });
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(npw), req.user.id);
    destroyUserSessions(ctx, req.user.id, req.cookies.sid);
    page(req, res, { pwOk: '密码已修改，其它设备已下线。' });
  });

  r.get('/u/:id', (req, res) => {
    const u = db.prepare('SELECT id, username, city, intro, banned, created_at FROM users WHERE id = ?').get(intParam(req.params.id));
    if (!u || (u.banned && !res.locals.isAdmin)) return res.message({ title: '用户不存在', text: '该用户不存在或已被封禁。', ok: false, status: 404 });
    const entries = db.prepare("SELECT * FROM entries WHERE author_id = ? AND status = 'public' ORDER BY id DESC LIMIT 20").all(u.id);
    res.render('user.njk', { title: `${u.username} 的主页`, crumbs: [{ text: '会员主页' }, { text: u.username }], u, entries });
  });

  return r;
}
