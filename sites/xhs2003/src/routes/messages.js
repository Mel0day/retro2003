import express from 'express';
import { requireLogin } from '../services/auth.js';
import { sendMessage } from '../services/points.js';
import { paginate } from '../lib/pager.js';
import { httpError, intParam, safeNext } from '../lib/http.js';
import { now } from '../lib/format.js';

const PER_PAGE = 20;

export default function messagesRoutes(ctx) {
  const r = express.Router();
  const { db, limiter } = ctx;

  const crumbs = (label) => [['控制面板', '/my'], ['短消息', '/pm'], [label]];

  const listBox = (box) => (req, res) => {
    const inbox = box === 'inbox';
    const where = inbox ? 'm.to_id = ? AND m.receiver_deleted = 0' : 'm.from_id = ? AND m.sender_deleted = 0';
    const total = db.prepare(`SELECT COUNT(*) AS n FROM messages m WHERE ${where}`).get(req.user.id).n;
    const pager = paginate({ total, page: req.query.page, perPage: PER_PAGE, baseUrl: inbox ? '/pm' : '/pm/outbox' });
    const list = db.prepare(`
      SELECT m.id, m.title, m.read_at, m.created_at, m.from_id, m.to_id,
             fu.username AS from_name, tu.username AS to_name
      FROM messages m LEFT JOIN users fu ON fu.id = m.from_id LEFT JOIN users tu ON tu.id = m.to_id
      WHERE ${where} ORDER BY m.created_at DESC, m.id DESC LIMIT ? OFFSET ?`).all(req.user.id, PER_PAGE, pager.offset);
    res.render('pm/list.njk', {
      title: inbox ? '收件箱' : '发件箱', crumbs: crumbs(inbox ? '收件箱' : '发件箱'), panelNav: 'pm',
      box, list, pager,
      inboxUnread: db.prepare('SELECT COUNT(*) AS n FROM messages WHERE to_id = ? AND read_at IS NULL AND receiver_deleted = 0').get(req.user.id).n,
    });
  };

  r.get('/pm', requireLogin, listBox('inbox'));
  r.get('/pm/outbox', requireLogin, listBox('outbox'));

  const composePage = (req, res, form, error, status = 200) => {
    res.status(status).render('pm/new.njk', {
      title: '写短消息', crumbs: crumbs('写短消息'), panelNav: 'pm', form, error,
      friends: db.prepare('SELECT u.username FROM friends f JOIN users u ON u.id = f.friend_id WHERE f.user_id = ? ORDER BY u.username').all(req.user.id),
    });
  };

  r.get('/pm/new', requireLogin, (req, res) => {
    const form = { to: String(req.query.to || '').slice(0, 16), title: String(req.query.title || '').slice(0, 60), body: '', back: '' };
    const replyId = intParam(req.query.reply);
    if (replyId) {
      const m = db.prepare(`SELECT m.*, u.username AS from_name FROM messages m LEFT JOIN users u ON u.id = m.from_id WHERE m.id = ?`).get(replyId);
      if (m && m.to_id === req.user.id && !m.receiver_deleted && m.from_id) {
        form.to = m.from_name;
        form.title = m.title.startsWith('Re: ') ? m.title : `Re: ${m.title}`.slice(0, 60);
        const quoted = m.body.replace(/\[quote[^\]]*\][\s\S]*?\[\/quote\]/gi, '').trim().slice(0, 300);
        form.body = `[quote=${m.from_name}]${quoted}[/quote]\n`;
      }
    }
    composePage(req, res, form);
  });

  r.post('/pm/send', requireLogin, (req, res) => {
    const form = {
      to: String(req.body.to || '').trim(),
      title: String(req.body.title || '').trim(),
      body: String(req.body.body || '').replace(/\r\n?/g, '\n').trim(),
      back: safeNext(req.body.back, ''),
    };
    const fail = (error, status = 400) => composePage(req, res, form, error, status);
    if (!form.to) return fail('请填写收件人用户名');
    const target = db.prepare('SELECT id, username, banned FROM users WHERE username = ?').get(form.to);
    if (!target) return fail(`用户「${form.to}」不存在，请检查用户名`);
    if (target.id === req.user.id) return fail('不能给自己发短消息哦');
    if (!form.title) form.title = '（无标题）';
    if ([...form.title].length > 60) return fail('标题不能超过 60 个字');
    if (!form.body) return fail('短消息内容不能为空');
    if (form.body.length > 5000) return fail('短消息内容不能超过 5000 字');
    if (!limiter.check(`pm:${req.user.id}`, 20, 3600_000)) return fail('发送太频繁了，每小时最多发送 20 条短消息', 429);
    sendMessage(ctx, req.user.id, target.id, form.title, form.body);
    res.message({ title: '发送成功', text: `短消息已发送给 ${target.username}。`, redirect: form.back || '/pm/outbox' });
  });

  r.post('/pm/delete', requireLogin, (req, res) => {
    const raw = req.body.ids;
    const ids = (Array.isArray(raw) ? raw : raw ? [raw] : []).map((x) => intParam(x)).filter(Boolean).slice(0, 200);
    const outbox = req.body.box === 'outbox';
    if (ids.length) {
      const stmt = outbox
        ? db.prepare('UPDATE messages SET sender_deleted = 1 WHERE id = ? AND from_id = ?')
        : db.prepare('UPDATE messages SET receiver_deleted = 1 WHERE id = ? AND to_id = ?');
      db.transaction(() => { for (const id of ids) stmt.run(id, req.user.id); })();
      purge();
    }
    res.redirect(303, outbox ? '/pm/outbox' : '/pm');
  });

  // 收发双方都删除后物理删除
  const purge = () => db.prepare('DELETE FROM messages WHERE receiver_deleted = 1 AND (sender_deleted = 1 OR from_id IS NULL)').run();

  const loadVisible = (req) => {
    const m = db.prepare(`SELECT m.*, fu.username AS from_name, tu.username AS to_name
      FROM messages m LEFT JOIN users fu ON fu.id = m.from_id LEFT JOIN users tu ON tu.id = m.to_id WHERE m.id = ?`).get(intParam(req.params.id));
    if (!m) throw httpError(404, '短消息不存在或已被删除');
    const isReceiver = m.to_id === req.user.id && !m.receiver_deleted;
    const isSender = m.from_id === req.user.id && !m.sender_deleted;
    if (!isReceiver && !isSender) throw httpError(404, '短消息不存在或已被删除');
    return { m, isReceiver, isSender };
  };

  r.get('/pm/:id', requireLogin, (req, res) => {
    const { m, isReceiver } = loadVisible(req);
    if (isReceiver && !m.read_at) {
      db.prepare('UPDATE messages SET read_at = ? WHERE id = ?').run(now(), m.id);
      m.read_at = now();
      res.locals.unread = Math.max(0, (res.locals.unread || 0) - 1);
    }
    res.render('pm/view.njk', {
      title: m.title, crumbs: crumbs('查看短消息'), panelNav: 'pm', m, isReceiver,
    });
  });

  r.post('/pm/:id/delete', requireLogin, (req, res) => {
    const { m, isReceiver } = loadVisible(req);
    if (isReceiver) db.prepare('UPDATE messages SET receiver_deleted = 1 WHERE id = ?').run(m.id);
    else db.prepare('UPDATE messages SET sender_deleted = 1 WHERE id = ?').run(m.id);
    purge();
    res.redirect(303, isReceiver ? '/pm' : '/pm/outbox');
  });

  return r;
}
