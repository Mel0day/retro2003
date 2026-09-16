import { Router } from 'express';
import { verifyPassword } from '../lib/password.js';
import { safeNext } from '../lib/http.js';
import { line, normalizeUsername, USERNAME_RE, isReservedName } from '../lib/text.js';
import { createSession, destroySession, createUser } from '../services/auth.js';
import { mergeCart } from '../services/cart.js';

export default function authRoutes(ctx) {
  const { db, limiter, settings, config } = ctx;
  const r = Router();
  const pw = (v) => (typeof v === 'string' ? v : '');

  const loginPage = (res, data = {}, status = 200) => res.status(status).render('login.njk', {
    title: '会员登录', crumbs: [{ text: '会员登录' }], next: '', err: '', username: '', ...data,
  });
  const registerPage = (res, data = {}, status = 200) => res.status(status).render('register.njk', {
    title: '免费注册', crumbs: [{ text: '免费注册' }], next: '', err: [], form: {}, ...data,
  });

  r.get('/login', (req, res) => {
    const next = safeNext(req.query.next, '');
    if (req.user) return res.redirect(next || '/my');
    loginPage(res, { next });
  });

  r.post('/login', (req, res) => {
    const next = safeNext(req.body.next, '');
    const username = normalizeUsername(req.body.username).slice(0, 32);
    const password = pw(req.body.password);
    // 表单错误原地显示，返回 200，避免浏览器控制台报资源错误
    if (!limiter.check(`login:${req.ip}`, 20, 600_000)) return loginPage(res, { next, username, err: '登录尝试太频繁，请 10 分钟后再试。' }, 429);
    if (!username || !password) return loginPage(res, { next, username, err: '请输入会员名和密码' });
    const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!u || !verifyPassword(password, u.password_hash)) return loginPage(res, { next, username, err: '会员名或密码错误。还没有账号？请先免费注册' });
    if (u.banned) return loginPage(res, { next, username, err: `该账号已被冻结${u.ban_reason ? `（${u.ban_reason}）` : ''}，如有疑问请联系客服。` }, 403);
    createSession(ctx, req, res, u.id, req.body.remember === '1');
    mergeCart(db, req.vid, u);
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
    if (!settings.bool('register_open')) errors.push('本站暂停新会员注册');
    if (req.body.website) errors.push('注册失败'); // 蜜罐字段，正常用户看不到
    if (!USERNAME_RE.test(form.username)) errors.push('会员名为 2-16 位中文、字母、数字或下划线');
    else if (isReservedName(form.username)) errors.push('会员名不能包含「淘宝」「小二」「客服」「管理员」等保留字');
    else if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(form.username)) errors.push('该会员名已被注册，换一个吧（会员名不区分大小写）');
    if (password.length < 6 || password.length > 64) errors.push('密码长度为 6-64 位');
    else if (password !== pw(req.body.password2)) errors.push('两次输入的密码不一致');
    else if (/^(\d)\1+$/.test(password) || password === form.username) errors.push('密码太简单了，不要用重复数字或和会员名相同');
    if (req.body.agree !== '1') errors.push('请阅读并同意服务协议');
    if (errors.length) return registerPage(res, { next, form, err: errors });
    if (!limiter.check(`register:${req.ip}`, 5, 3600_000)) return registerPage(res, { next, form, err: ['同一网络 1 小时内最多注册 5 个会员，请稍后再试'] }, 429);
    let id;
    try {
      id = createUser(ctx, { username: form.username, password, city: form.city });
    } catch (e) {
      if (String(e.code).startsWith('SQLITE_CONSTRAINT')) return registerPage(res, { next, form, err: ['该会员名已被注册'] });
      throw e;
    }
    createSession(ctx, req, res, id, false);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    mergeCart(db, req.vid, user);
    res.locals.user = user;
    res.message({
      title: '注册成功',
      text: `欢迎您，${form.username}！您的支付宝账户已到账 ${config.newMemberCents / 100} 元体验金，可以开始淘宝或者发布宝贝了。`,
      redirect: next || '/my',
    });
  });

  r.post('/logout', (req, res) => {
    destroySession(ctx, req, res);
    res.redirect('/');
  });

  return r;
}
