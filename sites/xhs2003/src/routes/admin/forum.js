import express from 'express';
import { requireRole } from '../../services/auth.js';
import { recountBoard, recountUserPosts } from '../../services/forum.js';
import { intParam, httpError } from '../../lib/http.js';

// 后台：论坛分区与版块管理（仅站长）
export default function admin_forum(ctx) {
  const r = express.Router();
  const { db } = ctx;
  const admin = requireRole('admin');
  const back = (res, msg, err = false) => res.redirect(303, `/admin/forum?${err ? 'err' : 'msg'}=${encodeURIComponent(msg)}`);

  const clean = (s, max) => String(s ?? '').trim().slice(0, max);
  const sortOf = (v) => Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : 0;

  r.get('/forum', admin, (req, res) => {
    const categories = db.prepare('SELECT * FROM forum_categories ORDER BY sort, id').all();
    const boards = db.prepare(`SELECT b.*, (SELECT COUNT(*) FROM forum_threads t WHERE t.board_id = b.id) AS all_threads
      FROM forum_boards b ORDER BY b.sort, b.id`).all();
    categories.forEach((c) => { c.boards = boards.filter((b) => b.category_id === c.id); });
    res.render('admin/forum.njk', { title: '论坛版块', adminNav: 'forum', categories });
  });

  // ---------- 分区 ----------
  r.post('/forum/category', admin, (req, res) => {
    const name = clean(req.body.name, 30);
    if (!name) return back(res, '分区名称不能为空', true);
    db.prepare('INSERT INTO forum_categories (name, sort) VALUES (?, ?)').run(name, sortOf(req.body.sort));
    back(res, `已添加分区「${name}」`);
  });

  r.post('/forum/category/:id', admin, (req, res) => {
    const cat = db.prepare('SELECT * FROM forum_categories WHERE id = ?').get(intParam(req.params.id));
    if (!cat) throw httpError(404, '分区不存在');
    const name = clean(req.body.name, 30);
    if (!name) return back(res, '分区名称不能为空', true);
    db.prepare('UPDATE forum_categories SET name = ?, sort = ? WHERE id = ?').run(name, sortOf(req.body.sort), cat.id);
    back(res, `分区「${name}」已保存`);
  });

  r.post('/forum/category/:id/delete', admin, (req, res) => {
    const cat = db.prepare('SELECT * FROM forum_categories WHERE id = ?').get(intParam(req.params.id));
    if (!cat) throw httpError(404, '分区不存在');
    const boards = db.prepare('SELECT id, name FROM forum_boards WHERE category_id = ?').all(cat.id);
    const threads = boards.length
      ? db.prepare(`SELECT COUNT(*) AS n FROM forum_threads WHERE board_id IN (${boards.map(() => '?').join(',')})`).get(...boards.map((b) => b.id)).n
      : 0;
    if (boards.length && req.body.confirm !== '1') {
      return res.render('admin/forum-confirm.njk', {
        title: '确认删除分区', adminNav: 'forum', kind: 'category', target: cat, boards, threads,
        action: `/admin/forum/category/${cat.id}/delete`,
      });
    }
    cascadeDelete(() => db.prepare('DELETE FROM forum_categories WHERE id = ?').run(cat.id), boards.map((b) => b.id));
    back(res, `已删除分区「${cat.name}」${boards.length ? `及其下 ${boards.length} 个版块、${threads} 个主题` : ''}`);
  });

  // ---------- 版块 ----------
  const boardInput = (body) => {
    const name = clean(body.name, 30);
    const categoryId = intParam(body.category_id);
    if (!name) return { error: '版块名称不能为空' };
    if (!db.prepare('SELECT 1 FROM forum_categories WHERE id = ?').get(categoryId)) return { error: '请选择所属分区' };
    return { name, categoryId, description: clean(body.description, 120), sort: sortOf(body.sort) };
  };

  r.post('/forum/board', admin, (req, res) => {
    const v = boardInput(req.body);
    if (v.error) return back(res, v.error, true);
    db.prepare('INSERT INTO forum_boards (category_id, name, description, sort) VALUES (?, ?, ?, ?)').run(v.categoryId, v.name, v.description, v.sort);
    back(res, `已添加版块「${v.name}」`);
  });

  r.get('/forum/board/:id/edit', admin, (req, res) => {
    const board = db.prepare('SELECT * FROM forum_boards WHERE id = ?').get(intParam(req.params.id));
    if (!board) throw httpError(404, '版块不存在');
    res.render('admin/forum-board.njk', {
      title: `编辑版块：${board.name}`, adminNav: 'forum', board,
      categories: db.prepare('SELECT * FROM forum_categories ORDER BY sort, id').all(),
    });
  });

  r.post('/forum/board/:id', admin, (req, res) => {
    const board = db.prepare('SELECT * FROM forum_boards WHERE id = ?').get(intParam(req.params.id));
    if (!board) throw httpError(404, '版块不存在');
    const v = boardInput(req.body);
    if (v.error) return back(res, v.error, true);
    db.prepare('UPDATE forum_boards SET category_id = ?, name = ?, description = ?, sort = ? WHERE id = ?')
      .run(v.categoryId, v.name, v.description, v.sort, board.id);
    recountBoard(ctx, board.id);
    back(res, `版块「${v.name}」已保存`);
  });

  r.post('/forum/board/:id/delete', admin, (req, res) => {
    const board = db.prepare('SELECT * FROM forum_boards WHERE id = ?').get(intParam(req.params.id));
    if (!board) throw httpError(404, '版块不存在');
    const threads = db.prepare('SELECT COUNT(*) AS n FROM forum_threads WHERE board_id = ?').get(board.id).n;
    if (threads && req.body.confirm !== '1') {
      return res.render('admin/forum-confirm.njk', {
        title: '确认删除版块', adminNav: 'forum', kind: 'board', target: board, boards: [board], threads,
        action: `/admin/forum/board/${board.id}/delete`,
      });
    }
    cascadeDelete(() => db.prepare('DELETE FROM forum_boards WHERE id = ?').run(board.id), [board.id]);
    back(res, `已删除版块「${board.name}」${threads ? `及其下 ${threads} 个主题` : ''}`);
  });

  // 级联删除后重新统计受影响会员的发帖数
  function cascadeDelete(doDelete, boardIds) {
    db.transaction(() => {
      const users = boardIds.length
        ? db.prepare(`SELECT DISTINCT p.user_id FROM forum_posts p JOIN forum_threads t ON t.id = p.thread_id
            WHERE t.board_id IN (${boardIds.map(() => '?').join(',')})`).all(...boardIds).map((u) => u.user_id)
        : [];
      doDelete();
      for (const id of users) recountUserPosts(ctx, id);
    })();
  }

  return r;
}
