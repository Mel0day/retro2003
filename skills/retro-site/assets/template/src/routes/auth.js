import { Router } from 'express';
import { verifyPassword } from '../lib/password.js';
import { safeNext } from '../lib/http.js';
import { line, normalizeUsername, USERNAME_RE, isReservedName } from '../lib/text.js';
import { createSession, destroySession, createUser } from '../services/auth.js';

export default function authRoutes(ctx) {
  const { db, limiter, settings } = ctx;
  const r = Router();
  const pw = (v) => (typeof v === 'string' ? v : '');
  const loginPage = (res, data = {}, status = 200) => res.status(status).render('login.njk', { title: '会员登录', crumbs: [{ text: '会员登录' }], next: '', err: '', username: '', ...data });
  const registerPage = (res, data = {}, status = 200) => res.status(status).render('register.njk', { title: '免费注册', crumbs: [{ text: '免费注册' }], next: '', err: [], form: {}, ...data });

  r.get('/login', (req, res) => {
    const next = safeNext(req.query.next, '');
    if (req.user) return res.redirect(next || '/my');
    loginPage(res, { next });
  });

  r.post('/login', (req, res) => {
    const next = safeNext(req.body.next, '');
    const username = normalizeUsername(req.body.username).slice(0, 32);
    const password = pw(req.body.password);
    if (!limiter.check(`login:${req.ip}`, 20, 600_000)) return loginPage(res, { next, username, err: '登录尝试太频繁，请 10 分钟后再试。' }, 429);
    if (!username || !password) return loginPage(res, { next, username, err: '请输入用户名和密码' });
    const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!u || !verifyPassword(password, u.password_hash)) return loginPage(res, { next, username, err: '用户名或密码错误。还没有账号？请先免费注册' });
    if (u.banned) return loginPage(res, { next, username, err: `该账号已被封禁${u.ban_reason ? `（${u.ban_reason}）` : ''}。` }, 403);
    createSession(ctx, req, res, u.id, req.body.remember === '1');
    res.redirect(next || '/');
  });

  r.get('/register', (req, res) => {
    if (req.user) return res.redirect('/my');
    registerPage(res, { next: safeNext(req.query.next, '') });
  });

  r.post('/register', (req, res) => {
    const next = safeNext(req.body.next, '');
    const form = { username: normalizeUsername(req.body.username).slice(0, 32), city: line(req.body.city, 20) };
    const password = pw(req.body.password);
    const errors = [];
    if (!settings.bool('register_open')) errors.push('本站暂停注册');
    if (req.body.website) errors.push('注册失败'); // 蜜罐字段
    if (!USERNAME_RE.test(form.username)) errors.push('用户名为 2-16 位中文、字母、数字或下划线');
    else if (isReservedName(form.username)) errors.push('用户名包含保留字');
    else if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(form.username)) errors.push('该用户名已被注册（不区分大小写）');
    if (password.length < 6 || password.length > 64) errors.push('密码长度为 6-64 位');
    else if (password !== pw(req.body.password2)) errors.push('两次输入的密码不一致');
    if (req.body.agree !== '1') errors.push('请阅读并同意本站规则');
    if (errors.length) return registerPage(res, { next, form, err: errors });
    if (!limiter.check(`register:${req.ip}`, 5, 3600_000)) return registerPage(res, { next, form, err: ['同一网络 1 小时内最多注册 5 个账号'] }, 429);
    const id = createUser(ctx, { username: form.username, password, city: form.city });
    createSession(ctx, req, res, id, false);
    res.locals.user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    res.message({ title: '注册成功', text: `欢迎您，${form.username}！`, redirect: next || '/my' });
  });

  r.post('/logout', (req, res) => { destroySession(ctx, req, res); res.redirect('/'); });

  return r;
}
