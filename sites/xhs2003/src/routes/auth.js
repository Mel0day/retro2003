import express from 'express';
import { hashPassword, verifyPassword, normalizeAnswer } from '../lib/password.js';
import { createSession, destroySession, destroyUserSessions } from '../services/auth.js';
import { createUser } from '../services/bootstrap.js';
import { safeNext, USERNAME_RE, RESERVED_NAMES } from '../lib/http.js';

export default function authRoutes(ctx) {
  const r = express.Router();
  const { db, settings, captcha, limiter } = ctx;

  const loginPage = (res, data = {}, status = 200) =>
    res.status(status).render('user/login.njk', { title: '会员登录', crumbs: [['会员登录']], ...data });

  r.get('/login', (req, res) => {
    if (req.user) return res.redirect(safeNext(req.query.next, '/my'));
    loginPage(res, { next: safeNext(req.query.next, '') });
  });

  r.post('/login', (req, res) => {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    const next = safeNext(req.body.next, '/');
    const fail = (error) => loginPage(res, { error, username, next }, 400);

    if (!limiter.check(`login-ip:${req.ip}`, 20, 15 * 60_000) || !limiter.check(`login-user:${username.toLowerCase()}`, 8, 15 * 60_000)) {
      return fail('登录尝试次数过多，请 15 分钟后再试');
    }
    if (settings.bool('captcha_login') && !captcha.verify(req.vid, 'login', req.body.captcha)) {
      return fail('验证码错误，请重新输入（看不清可以点图片换一张）');
    }
    const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!u || !verifyPassword(password, u.password_hash)) return fail('用户名或密码错误');
    if (u.banned) return fail('该账号已被封禁，如有疑问请联系站长');
    createSession(ctx, req, res, u.id, req.body.remember === '1');
    limiter.reset(`login-user:${username.toLowerCase()}`);
    res.message({ title: '登录成功', text: `欢迎回来，${u.username}！`, redirect: next === '/login' ? '/' : next });
  });

  r.get('/logout', (req, res) => {
    res.render('user/logout.njk', { title: '退出登录' });
  });

  r.post('/logout', (req, res) => {
    destroySession(ctx, req, res);
    res.message({ title: '退出成功', text: '您已安全退出，欢迎下次再来！', redirect: '/' });
  });

  const regPage = (res, data = {}, status = 200) =>
    res.status(status).render('user/register.njk', { title: '注册新会员', crumbs: [['注册新会员']], form: {}, ...data });

  r.get('/register', (req, res) => {
    if (req.user) return res.redirect('/my');
    if (!settings.bool('register_open')) return res.message({ title: '暂停注册', text: '本站暂时关闭了新会员注册，请稍后再来。', ok: false });
    regPage(res);
  });

  r.post('/register', (req, res) => {
    if (!settings.bool('register_open')) return res.message({ title: '暂停注册', text: '本站暂时关闭了新会员注册。', ok: false, status: 403 });
    const form = {
      username: String(req.body.username || '').trim(),
      location: String(req.body.location || '').trim().slice(0, 30),
      question: String(req.body.question || '').trim().slice(0, 50),
      gender: ['male', 'female'].includes(req.body.gender) ? req.body.gender : '',
    };
    const fail = (error) => regPage(res, { error, form }, 400);
    const { password = '', password2 = '', answer = '' } = req.body;

    if (!limiter.check(`register:${req.ip}`, 5, 3600_000)) return fail('注册太频繁了，请一小时后再试');
    if (!captcha.verify(req.vid, 'register', req.body.captcha)) return fail('验证码错误');
    if (!USERNAME_RE.test(form.username)) return fail('用户名需为 2-16 位中文、字母、数字或下划线');
    if (RESERVED_NAMES.some((n) => n.toLowerCase() === form.username.toLowerCase())) return fail('该用户名为系统保留，请换一个');
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(form.username)) return fail('该用户名已被注册，请换一个');
    if (password.length < 6 || password.length > 32) return fail('密码长度需为 6-32 位');
    if (password !== password2) return fail('两次输入的密码不一致');
    if (!form.question || normalizeAnswer(answer).length < 1) return fail('请设置密码提示问题和答案，忘记密码时要用');
    if (req.body.agree !== '1') return fail('请阅读并同意《会员服务条款》');

    const id = createUser(ctx, {
      username: form.username, password, location: form.location, question: form.question,
      answerHash: hashPassword(normalizeAnswer(answer)),
    });
    if (form.gender) db.prepare('UPDATE users SET gender = ? WHERE id = ?').run(form.gender, id);
    createSession(ctx, req, res, id, false);
    res.message({ title: '注册成功', text: `恭喜你成为${settings.get('site_name')}第 ${id} 位会员！快去发表第一篇笔记吧。`, redirect: '/my' });
  });

  // 忘记密码：凭密码提示问题重置
  r.get('/forgot', (req, res) => {
    res.render('user/forgot.njk', { title: '找回密码', crumbs: [['找回密码']], step: 1 });
  });

  r.post('/forgot', (req, res) => {
    const username = String(req.body.username || '').trim();
    const u = db.prepare('SELECT id, username, question, answer_hash FROM users WHERE username = ?').get(username);
    const render = (data, status = 200) => res.status(status).render('user/forgot.njk', { title: '找回密码', crumbs: [['找回密码']], ...data });

    if (!req.body.answer && req.body.step !== '2') {
      if (!u || !u.question) return render({ step: 1, username, error: '用户不存在，或该账号没有设置密码提示问题，请联系站长' }, 400);
      return render({ step: 2, username: u.username, question: u.question });
    }
    if (!u) return render({ step: 1, error: '用户不存在' }, 400);
    const again = (error) => render({ step: 2, username: u.username, question: u.question, error }, 400);
    if (!limiter.check(`forgot:${req.ip}`, 10, 3600_000) || !limiter.check(`forgot-user:${u.id}`, 5, 3600_000)) {
      return again('尝试次数过多，请一小时后再试');
    }
    if (!captcha.verify(req.vid, 'forgot', req.body.captcha)) return again('验证码错误');
    if (!verifyPassword(normalizeAnswer(req.body.answer), u.answer_hash)) return again('提示问题的答案不正确');
    const pw = String(req.body.password || '');
    if (pw.length < 6 || pw.length > 32) return again('新密码长度需为 6-32 位');
    if (pw !== req.body.password2) return again('两次输入的密码不一致');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(pw), u.id);
    destroyUserSessions(ctx, u.id);
    res.message({ title: '密码已重置', text: '新密码设置成功，请用新密码登录。', redirect: '/login' });
  });

  return r;
}
