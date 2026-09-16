import express from 'express';
import crypto from 'node:crypto';
import { requireRole, destroyUserSessions } from '../../services/auth.js';
import { awardPoints, sendSystemMessage } from '../../services/points.js';
import { hashPassword } from '../../lib/password.js';
import { paginate } from '../../lib/pager.js';
import { intParam } from '../../lib/http.js';
import { levelInfo } from '../../lib/levels.js';

const PER_PAGE = 20;
const ROLE_LABEL = { user: '会员', moderator: '版主', admin: '站长' };

function redirectWith(res, url, text, isError = false) {
  const sep = url.includes('?') ? '&' : '?';
  res.redirect(303, `${url}${sep}${isError ? 'err' : 'msg'}=${encodeURIComponent(text)}`);
}

export default function adminUsers(ctx) {
  const r = express.Router();
  const { db } = ctx;
  r.use('/users', requireRole('admin'));

  const activeAdmins = () => db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND banned = 0").get().n;

  r.get('/users', (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 16);
    const role = ROLE_LABEL[req.query.role] ? req.query.role : '';
    const banned = ['0', '1'].includes(req.query.banned) ? req.query.banned : '';
    const sort = ['new', 'points', 'login', 'notes'].includes(req.query.sort) ? req.query.sort : 'new';
    const where = ['1 = 1'];
    const args = [];
    if (q) { where.push("username LIKE ? ESCAPE '\\'"); args.push(`%${q.replace(/[\\%_]/g, '\\$&')}%`); }
    if (role) { where.push('role = ?'); args.push(role); }
    if (banned) { where.push('banned = ?'); args.push(Number(banned)); }
    const order = { new: 'id DESC', points: 'points DESC, id DESC', login: 'COALESCE(last_login_at, 0) DESC, id DESC', notes: 'note_count DESC, id DESC' }[sort];
    const total = db.prepare(`SELECT COUNT(*) AS n FROM users WHERE ${where.join(' AND ')}`).get(...args).n;
    const params = new URLSearchParams(Object.entries({ q, role, banned, sort: sort === 'new' ? '' : sort }).filter(([, v]) => v));
    const pager = paginate({ total, page: req.query.page, perPage: PER_PAGE, baseUrl: `/admin/users?${params}` });
    const list = db.prepare(`SELECT id, username, role, banned, title, points, note_count, post_count, location, created_at, last_login_at
      FROM users WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...args, PER_PAGE, pager.offset);
    list.forEach((u) => { u.levelName = levelInfo(u).name; u.roleLabel = ROLE_LABEL[u.role]; });
    res.render('admin/users.njk', { title: '会员管理', adminNav: 'users', list, pager, filters: { q, role, banned, sort } });
  });

  function renderUser(req, res, user, extra = {}) {
    const notes = db.prepare('SELECT id, title, status, hits, comment_count, created_at FROM notes WHERE user_id = ? ORDER BY id DESC LIMIT 8').all(user.id);
    const comments = db.prepare(`SELECT c.id, c.content, c.status, c.floor, c.created_at, n.id AS note_id, n.title AS note_title
      FROM comments c JOIN notes n ON n.id = c.note_id WHERE c.user_id = ? ORDER BY c.id DESC LIMIT 8`).all(user.id);
    const pointsLog = db.prepare('SELECT delta, reason, created_at FROM points_log WHERE user_id = ? ORDER BY id DESC LIMIT 10').all(user.id);
    const sessions = db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND expires_at > unixepoch()').get(user.id).n;
    res.render('admin/user_edit.njk', {
      title: `会员：${user.username}`, adminNav: 'users', u: user, level: levelInfo(user), roleLabel: ROLE_LABEL,
      notes, comments, pointsLog, sessions, isSelf: user.id === req.user.id, ...extra,
    });
  }

  const loadUser = (req) => db.prepare('SELECT * FROM users WHERE id = ?').get(intParam(req.params.id));

  r.get('/users/:id', (req, res) => {
    const u = loadUser(req);
    if (!u) return redirectWith(res, '/admin/users', '会员不存在', true);
    renderUser(req, res, u);
  });

  r.post('/users/:id/profile', (req, res) => {
    const u = loadUser(req);
    if (!u) return redirectWith(res, '/admin/users', '会员不存在', true);
    const back = `/admin/users/${u.id}`;
    const role = ROLE_LABEL[req.body.role] ? req.body.role : u.role;
    if (role !== u.role) {
      if (u.id === req.user.id) return redirectWith(res, back, '不能修改自己的角色', true);
      if (u.role === 'admin' && !u.banned && activeAdmins() <= 1) return redirectWith(res, back, '这是最后一位站长，不能降级', true);
    }
    const title = String(req.body.title || '').trim().slice(0, 12);
    const signature = String(req.body.signature || '').trim().slice(0, 100);
    const location = String(req.body.location || '').trim().slice(0, 30);
    db.prepare('UPDATE users SET role = ?, title = ?, signature = ?, location = ? WHERE id = ?').run(role, title, signature, location, u.id);
    if (role !== u.role) {
      sendSystemMessage(ctx, u.id, '你的会员身份已变更', `站长已将你的身份从「${ROLE_LABEL[u.role]}」调整为「${ROLE_LABEL[role]}」。`);
    }
    redirectWith(res, back, '资料已保存');
  });

  r.post('/users/:id/points', (req, res) => {
    const u = loadUser(req);
    if (!u) return redirectWith(res, '/admin/users', '会员不存在', true);
    const back = `/admin/users/${u.id}`;
    const delta = parseInt(req.body.delta, 10);
    const reason = String(req.body.reason || '').trim().slice(0, 50);
    if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 100000) return redirectWith(res, back, '请输入非零的整数积分（±100000 以内）', true);
    if (!reason) return redirectWith(res, back, '请填写调整原因', true);
    awardPoints(ctx, u.id, 'admin_adjust', delta, `站长调整：${reason}`);
    sendSystemMessage(ctx, u.id, `你的积分被调整 ${delta > 0 ? '+' : ''}${delta}`, `站长调整了你的积分：${delta > 0 ? '+' : ''}${delta}\n原因：${reason}`);
    redirectWith(res, back, `积分已${delta > 0 ? '增加' : '扣除'} ${Math.abs(delta)}`);
  });

  r.post('/users/:id/ban', (req, res) => {
    const u = loadUser(req);
    if (!u) return redirectWith(res, '/admin/users', '会员不存在', true);
    const back = String(req.body.back || '') === 'list' ? '/admin/users' : `/admin/users/${u.id}`;
    const ban = req.body.banned === '1';
    if (ban) {
      if (u.id === req.user.id) return redirectWith(res, back, '不能封禁自己', true);
      if (u.role === 'admin' && !u.banned && activeAdmins() <= 1) return redirectWith(res, back, '不能封禁最后一位站长', true);
      db.prepare('UPDATE users SET banned = 1 WHERE id = ?').run(u.id);
      destroyUserSessions(ctx, u.id);
      return redirectWith(res, back, `已封禁 ${u.username}，其登录状态已全部失效`);
    }
    db.prepare('UPDATE users SET banned = 0 WHERE id = ?').run(u.id);
    redirectWith(res, back, `已解封 ${u.username}`);
  });

  r.post('/users/:id/password', (req, res) => {
    const u = loadUser(req);
    if (!u) return redirectWith(res, '/admin/users', '会员不存在', true);
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    let pw = '';
    for (let i = 0; i < 8; i++) pw += alphabet[crypto.randomInt(alphabet.length)];
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(pw), u.id);
    if (u.id !== req.user.id) destroyUserSessions(ctx, u.id);
    res.set('Cache-Control', 'no-store');
    renderUser(req, res, db.prepare('SELECT * FROM users WHERE id = ?').get(u.id), { newPassword: pw });
  });

  return r;
}
