import express from 'express';
import { paginate } from '../../lib/pager.js';
import { safeNext, intParam } from '../../lib/http.js';
import { now } from '../../lib/format.js';
import { getNote, setNoteStatus, deleteNote, approveComment, removeComment } from '../../services/notes.js';
import { sendSystemMessage } from '../../services/points.js';

const PER_PAGE = 20;

function redirectWith(res, url, text, isError = false) {
  const sep = url.includes('?') ? '&' : '?';
  res.redirect(303, `${url}${sep}${isError ? 'err' : 'msg'}=${encodeURIComponent(text)}`);
}

// 回跳地址去掉旧的提示参数，避免叠加
function cleanBack(back, fallback) {
  const url = safeNext(back, fallback);
  if (!url.startsWith('/admin')) return fallback;
  const [p, q = ''] = url.split('?');
  const sp = new URLSearchParams(q);
  sp.delete('msg'); sp.delete('err');
  const s = sp.toString();
  return s ? `${p}?${s}` : p;
}

const toIds = (v) => [].concat(v || []).map((x) => intParam(x)).filter(Boolean);

export const REPORT_TYPE_LABEL = { note: '笔记', comment: '留言', thread: '主题', post: '帖子', photo: '照片', user: '会员' };

export default function adminContent(ctx) {
  const r = express.Router();
  const { db } = ctx;

  // ---------------- 笔记管理 ----------------
  r.get('/notes', (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 50);
    const channel = intParam(req.query.channel);
    const status = ['published', 'hidden'].includes(req.query.status) ? req.query.status : '';
    const featured = ['1', '0'].includes(req.query.featured) ? req.query.featured : '';
    const where = ['1 = 1'];
    const args = [];
    if (q) { where.push("n.title LIKE ? ESCAPE '\\'"); args.push(`%${q.replace(/[\\%_]/g, '\\$&')}%`); }
    if (channel) { where.push('n.channel_id = ?'); args.push(channel); }
    if (status) { where.push('n.status = ?'); args.push(status); }
    if (featured) { where.push('n.featured = ?'); args.push(Number(featured)); }
    const total = db.prepare(`SELECT COUNT(*) AS n FROM notes n WHERE ${where.join(' AND ')}`).get(...args).n;
    const params = new URLSearchParams(Object.entries({ q, channel: channel || '', status, featured }).filter(([, v]) => v !== ''));
    const pager = paginate({ total, page: req.query.page, perPage: PER_PAGE, baseUrl: `/admin/notes?${params}` });
    const list = db.prepare(`
      SELECT n.id, n.title, n.status, n.featured, n.hits, n.comment_count, n.likes, n.has_image, n.created_at,
             u.id AS user_id, u.username, c.name AS channel_name
      FROM notes n JOIN users u ON u.id = n.user_id JOIN channels c ON c.id = n.channel_id
      WHERE ${where.join(' AND ')} ORDER BY n.id DESC LIMIT ? OFFSET ?`).all(...args, PER_PAGE, pager.offset);
    res.render('admin/notes.njk', {
      title: '笔记管理', adminNav: 'notes', list, pager, filters: { q, channel, status, featured },
      channels: db.prepare('SELECT id, name FROM channels ORDER BY sort, id').all(),
    });
  });

  function applyNoteAction(note, action, operator) {
    switch (action) {
      case 'feature': db.prepare('UPDATE notes SET featured = 1 WHERE id = ?').run(note.id); return true;
      case 'unfeature': db.prepare('UPDATE notes SET featured = 0 WHERE id = ?').run(note.id); return true;
      case 'hide':
        if (note.status !== 'hidden') setNoteStatus(ctx, note, 'hidden');
        return true;
      case 'restore':
        if (note.status !== 'published') setNoteStatus(ctx, note, 'published');
        return true;
      case 'delete':
        deleteNote(ctx, note);
        if (operator.id !== note.user_id) {
          sendSystemMessage(ctx, note.user_id, '你的笔记被管理员删除', `你的笔记《${note.title}》因违反社区规定已被删除。如有疑问请联系站长。`);
        }
        return true;
      default: return false;
    }
  }

  const NOTE_ACTION_TEXT = { feature: '已设为推荐', unfeature: '已取消推荐', hide: '已隐藏', restore: '已恢复显示', delete: '已删除' };

  r.post('/notes/batch', (req, res) => {
    const back = cleanBack(req.body.back, '/admin/notes');
    const ids = toIds(req.body.ids);
    const action = String(req.body.action || '');
    if (!ids.length) return redirectWith(res, back, '请先勾选要操作的笔记', true);
    if (!NOTE_ACTION_TEXT[action]) return redirectWith(res, back, '请选择批量操作', true);
    let n = 0;
    db.transaction(() => {
      for (const id of ids) {
        const note = getNote(ctx, id);
        if (note && applyNoteAction(note, action, req.user)) n++;
      }
    })();
    redirectWith(res, back, `${n} 篇笔记${NOTE_ACTION_TEXT[action]}`);
  });

  r.post('/notes/:id/:action', (req, res, next) => {
    if (!NOTE_ACTION_TEXT[req.params.action]) return next();
    const back = cleanBack(req.body.back, '/admin/notes');
    const note = getNote(ctx, req.params.id);
    if (!note) return redirectWith(res, back, '笔记不存在', true);
    applyNoteAction(note, req.params.action, req.user);
    redirectWith(res, back, `《${note.title}》${NOTE_ACTION_TEXT[req.params.action]}`);
  });

  // ---------------- 留言审核 ----------------
  r.get('/comments', (req, res) => {
    const status = ['pending', 'approved', 'deleted'].includes(req.query.status) ? req.query.status : 'pending';
    const q = String(req.query.q || '').trim().slice(0, 50);
    const where = ['c.status = ?'];
    const args = [status];
    if (q) { where.push("c.content LIKE ? ESCAPE '\\'"); args.push(`%${q.replace(/[\\%_]/g, '\\$&')}%`); }
    const total = db.prepare(`SELECT COUNT(*) AS n FROM comments c WHERE ${where.join(' AND ')}`).get(...args).n;
    const params = new URLSearchParams(Object.entries({ status, q }).filter(([, v]) => v));
    const pager = paginate({ total, page: req.query.page, perPage: PER_PAGE, baseUrl: `/admin/comments?${params}` });
    const list = db.prepare(`
      SELECT c.*, u.username, n.title AS note_title, n.id AS note_id
      FROM comments c LEFT JOIN users u ON u.id = c.user_id JOIN notes n ON n.id = c.note_id
      WHERE ${where.join(' AND ')} ORDER BY c.id DESC LIMIT ? OFFSET ?`).all(...args, PER_PAGE, pager.offset);
    const counts = Object.fromEntries(db.prepare('SELECT status, COUNT(*) AS n FROM comments GROUP BY status').all().map((x) => [x.status, x.n]));
    res.render('admin/comments.njk', { title: '留言审核', adminNav: 'comments', list, pager, status, q, counts });
  });

  r.post('/comments/batch', (req, res) => {
    const back = cleanBack(req.body.back, '/admin/comments');
    const ids = toIds(req.body.ids);
    const action = String(req.body.action || '');
    if (!ids.length) return redirectWith(res, back, '请先勾选要操作的留言', true);
    if (!['approve', 'delete'].includes(action)) return redirectWith(res, back, '请选择批量操作', true);
    let n = 0;
    db.transaction(() => {
      for (const id of ids) if (action === 'approve' ? approveComment(ctx, id) : removeComment(ctx, id)) n++;
    })();
    redirectWith(res, back, `${n} 条留言${action === 'approve' ? '已通过审核' : '已删除'}`);
  });

  r.post('/comments/:id/:action', (req, res, next) => {
    if (!['approve', 'delete'].includes(req.params.action)) return next();
    const back = cleanBack(req.body.back, '/admin/comments');
    const id = intParam(req.params.id);
    const ok = req.params.action === 'approve' ? approveComment(ctx, id) : removeComment(ctx, id);
    if (!ok) return redirectWith(res, back, '留言不存在或状态未变化', true);
    redirectWith(res, back, req.params.action === 'approve' ? '留言已通过审核' : '留言已删除');
  });

  // ---------------- 举报处理 ----------------
  function describeTarget(rep) {
    const id = rep.target_id;
    switch (rep.target_type) {
      case 'note': {
        const n = db.prepare('SELECT id, title, status FROM notes WHERE id = ?').get(id);
        return n ? { url: `/notes/${n.id}`, label: n.title, gone: false, note: n.status !== 'published' ? '已隐藏' : '' } : { gone: true };
      }
      case 'comment': {
        const c = db.prepare('SELECT id, note_id, floor, content, status FROM comments WHERE id = ?').get(id);
        return c ? { url: `/notes/${c.note_id}#floor-${c.floor}`, label: c.content.slice(0, 40), gone: c.status === 'deleted', note: c.status === 'deleted' ? '已删除' : '' } : { gone: true };
      }
      case 'thread': {
        const t = db.prepare('SELECT id, title, status FROM forum_threads WHERE id = ?').get(id);
        return t ? { url: `/forum/thread/${t.id}`, label: t.title, gone: false, note: t.status !== 'published' ? '已隐藏' : '' } : { gone: true };
      }
      case 'post': {
        const p = db.prepare('SELECT id, thread_id, floor, content, status FROM forum_posts WHERE id = ?').get(id);
        return p ? { url: `/forum/thread/${p.thread_id}#floor-${p.floor}`, label: p.content.slice(0, 40), gone: false, note: p.status !== 'published' ? '已隐藏' : '' } : { gone: true };
      }
      case 'photo': {
        const p = db.prepare('SELECT id, caption FROM photos WHERE id = ?').get(id);
        return p ? { url: `/album/photo/${p.id}`, label: p.caption || `照片 #${p.id}`, gone: false } : { gone: true };
      }
      case 'user': {
        const u = db.prepare('SELECT id, username, banned FROM users WHERE id = ?').get(id);
        return u ? { url: `/u/${u.id}`, label: u.username, gone: false, note: u.banned ? '已封禁' : '', adminUrl: `/admin/users/${u.id}` } : { gone: true };
      }
      default: return { gone: true };
    }
  }

  r.get('/reports', (req, res) => {
    const status = ['open', 'resolved', 'dismissed'].includes(req.query.status) ? req.query.status : 'open';
    const total = db.prepare('SELECT COUNT(*) AS n FROM reports WHERE status = ?').get(status).n;
    const pager = paginate({ total, page: req.query.page, perPage: PER_PAGE, baseUrl: `/admin/reports?status=${status}` });
    const list = db.prepare(`
      SELECT r.*, u.username AS reporter, h.username AS handler
      FROM reports r LEFT JOIN users u ON u.id = r.reporter_id LEFT JOIN users h ON h.id = r.handled_by
      WHERE r.status = ? ORDER BY r.id DESC LIMIT ? OFFSET ?`).all(status, PER_PAGE, pager.offset);
    list.forEach((rep) => { rep.typeLabel = REPORT_TYPE_LABEL[rep.target_type] || rep.target_type; rep.target = describeTarget(rep); });
    const counts = Object.fromEntries(db.prepare('SELECT status, COUNT(*) AS n FROM reports GROUP BY status').all().map((x) => [x.status, x.n]));
    res.render('admin/reports.njk', { title: '举报处理', adminNav: 'reports', list, pager, status, counts });
  });

  const markReport = (id, status, userId) =>
    db.prepare("UPDATE reports SET status = ?, handled_by = ?, handled_at = ? WHERE id = ?").run(status, userId, now(), id);

  r.post('/reports/:id/:action', (req, res, next) => {
    if (!['resolve', 'dismiss', 'remove'].includes(req.params.action)) return next();
    const back = cleanBack(req.body.back, '/admin/reports');
    const rep = db.prepare('SELECT * FROM reports WHERE id = ?').get(intParam(req.params.id));
    if (!rep) return redirectWith(res, back, '举报记录不存在', true);
    const action = req.params.action;
    if (action === 'dismiss') {
      markReport(rep.id, 'dismissed', req.user.id);
      return redirectWith(res, back, '已驳回该举报');
    }
    if (action === 'remove') {
      if (rep.target_type === 'note') {
        const note = getNote(ctx, rep.target_id);
        if (note && note.status === 'published') {
          setNoteStatus(ctx, note, 'hidden');
          sendSystemMessage(ctx, note.user_id, '你的笔记因被举报已隐藏', `你的笔记《${note.title}》经管理员核实违反社区规定，已被隐藏。如有疑问请联系站长。`);
        }
      } else if (rep.target_type === 'comment') {
        removeComment(ctx, rep.target_id);
      } else {
        return redirectWith(res, back, '该类型的内容请到前台页面处理', true);
      }
      // 同一对象的其他待处理举报一并关闭
      db.prepare("UPDATE reports SET status = 'resolved', handled_by = ?, handled_at = ? WHERE target_type = ? AND target_id = ? AND status = 'open'")
        .run(req.user.id, now(), rep.target_type, rep.target_id);
      markReport(rep.id, 'resolved', req.user.id);
      return redirectWith(res, back, '内容已删除，举报已处理');
    }
    markReport(rep.id, 'resolved', req.user.id);
    redirectWith(res, back, '举报已标记为已处理');
  });

  return r;
}
