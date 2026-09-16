import express from 'express';
import * as forum from '../services/forum.js';
import { requireLogin, isMod } from '../services/auth.js';
import { paginate } from '../lib/pager.js';
import { levelInfo } from '../lib/levels.js';
import { httpError, intParam } from '../lib/http.js';
import { now, TZ } from '../lib/format.js';

const THREADS_PER_PAGE = 25;
const POSTS_PER_PAGE = 15;
const hmsFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

// 站点时区今天 0 点的 Unix 秒
function todayStart() {
  const t = now();
  const p = Object.fromEntries(hmsFmt.formatToParts(new Date(t * 1000)).map((x) => [x.type, x.value]));
  return t - ((Number(p.hour) % 24) * 3600 + Number(p.minute) * 60 + Number(p.second));
}

export default function forumRoutes(ctx) {
  const r = express.Router();
  const { db, limiter } = ctx;

  const loadBoard = (id) => {
    const board = forum.getBoard(ctx, intParam(id));
    if (!board) throw httpError(404, '版块不存在');
    return board;
  };

  const loadThread = (req) => {
    const thread = forum.getThread(ctx, intParam(req.params.id));
    if (!thread || (thread.status !== 'published' && !isMod(req.user))) throw httpError(404, '主题不存在或已被删除');
    return thread;
  };

  const loadPost = (req) => {
    const post = forum.getPost(ctx, intParam(req.params.id));
    if (!post) throw httpError(404, '帖子不存在');
    const thread = forum.getThread(ctx, post.thread_id);
    if (!thread || ((thread.status !== 'published' || post.status !== 'published') && !isMod(req.user))) throw httpError(404, '帖子不存在或已被删除');
    return { post, thread };
  };

  const boardsForSelect = () => forum.listBoardsGrouped(ctx);
  const threadUrl = (id, floor) => (floor ? `/forum/thread/${id}?floor=${floor}#floor-${floor}` : `/forum/thread/${id}`);

  // ---------- 论坛首页 ----------
  r.get('/forum', (req, res) => {
    const stats = {
      today: db.prepare("SELECT COUNT(*) AS n FROM forum_posts WHERE created_at >= ? AND status = 'published'").get(todayStart()).n,
      threads: db.prepare("SELECT COUNT(*) AS n FROM forum_threads WHERE status = 'published'").get().n,
      posts: db.prepare("SELECT COUNT(*) AS n FROM forum_posts p JOIN forum_threads t ON t.id = p.thread_id WHERE p.status = 'published' AND t.status = 'published'").get().n,
      members: db.prepare('SELECT COUNT(*) AS n FROM users').get().n,
      newest: db.prepare('SELECT id, username FROM users ORDER BY id DESC LIMIT 1').get(),
    };
    const hot = db.prepare(`SELECT t.id, t.title, t.reply_count, t.is_poll FROM forum_threads t WHERE t.status = 'published'
      ORDER BY t.reply_count DESC, t.last_post_at DESC LIMIT 10`).all();
    const latest = db.prepare(`SELECT t.id, t.title, t.last_post_at, t.is_poll, u.username AS last_username
      FROM forum_threads t LEFT JOIN users u ON u.id = t.last_post_user_id WHERE t.status = 'published'
      ORDER BY t.last_post_at DESC LIMIT 10`).all();
    res.render('forum/index.njk', {
      title: '论坛', nav: 'forum', crumbs: [['论坛']],
      categories: forum.listBoardsGrouped(ctx), stats, hot, latest, todayStart: todayStart(),
    });
  });

  // ---------- 版块主题列表 ----------
  r.get('/forum/board/:id', (req, res) => {
    const board = loadBoard(req.params.id);
    const filter = req.query.filter === 'digest' ? 'digest' : '';
    const where = "t.board_id = ? AND t.status = 'published'" + (filter ? ' AND t.digest = 1' : '');
    const total = db.prepare(`SELECT COUNT(*) AS n FROM forum_threads t WHERE ${where}`).get(board.id).n;
    const pager = paginate({ total, page: req.query.page, perPage: THREADS_PER_PAGE, baseUrl: `/forum/board/${board.id}${filter ? '?filter=digest' : ''}` });
    const threads = db.prepare(`
      SELECT t.*, u.username, lu.username AS last_username
      FROM forum_threads t JOIN users u ON u.id = t.user_id LEFT JOIN users lu ON lu.id = t.last_post_user_id
      WHERE ${where} ORDER BY t.sticky DESC, t.last_post_at DESC, t.id DESC LIMIT ? OFFSET ?`).all(board.id, THREADS_PER_PAGE, pager.offset);
    const hotCutoff = now() - 86400;
    threads.forEach((t) => { t.hot = t.reply_count >= 20; t.isNew = t.created_at >= hotCutoff; });
    const category = db.prepare('SELECT * FROM forum_categories WHERE id = ?').get(board.category_id);
    res.render('forum/board.njk', {
      title: board.name, nav: 'forum', crumbs: [['论坛', '/forum'], [board.name]],
      board, category, threads, pager, filter,
    });
  });

  // ---------- 发新帖 ----------
  const newThreadPage = (res, board, data = {}) => res.render('forum/new.njk', {
    title: `发表新主题 - ${board.name}`, nav: 'forum', crumbs: [['论坛', '/forum'], [board.name, `/forum/board/${board.id}`], ['发表新主题']],
    board, form: {}, ...data,
  });

  r.get('/forum/board/:id/new', requireLogin, (req, res) => {
    const board = loadBoard(req.params.id);
    newThreadPage(res, board, { form: { poll: req.query.poll === '1' ? '1' : '' } });
  });

  r.post('/forum/board/:id/new', requireLogin, (req, res) => {
    const board = loadBoard(req.params.id);
    const form = { title: req.body.title, content: req.body.content, poll: req.body.poll === '1' ? '1' : '', poll_options: req.body.poll_options || '' };
    const fail = (error, status = 400) => newThreadPage(res.status(status), board, { form, error });
    if (!limiter.check(`thread:${req.user.id}`, 10, 3600_000)) return fail('发帖太频繁了，休息一会儿再来吧', 429);
    const pollOptions = form.poll ? String(form.poll_options).split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : [];
    if (form.poll && pollOptions.length < 2) return fail('投票选项需要 2 到 10 个，每行一个');
    try {
      const tid = forum.createThread(ctx, { boardId: board.id, user: req.user, title: form.title, content: form.content, pollOptions });
      res.message({ title: '发帖成功', text: '主题发表成功，积分 +5！', redirect: threadUrl(tid) });
    } catch (e) {
      if (!(e instanceof forum.ValidationError)) throw e;
      fail(e.message);
    }
  });

  // ---------- 主题详情 ----------
  r.get('/forum/thread/:id', (req, res) => {
    const thread = loadThread(req);
    const mod = isMod(req.user);
    if (thread.status === 'published' && ctx.countHit) ctx.countHit('forum_threads', thread.id, req.vid) && (thread.hits += 1);

    const statusWhere = mod ? '' : " AND p.status = 'published'";
    const total = db.prepare(`SELECT COUNT(*) AS n FROM forum_posts p WHERE p.thread_id = ?${statusWhere}`).get(thread.id).n;
    let page = req.query.page;
    const floor = intParam(req.query.floor);
    if (floor) {
      const pos = db.prepare(`SELECT COUNT(*) AS n FROM forum_posts p WHERE p.thread_id = ? AND p.floor <= ?${statusWhere}`).get(thread.id, floor).n;
      page = Math.max(1, Math.ceil(pos / POSTS_PER_PAGE));
    }
    const pager = paginate({ total, page, perPage: POSTS_PER_PAGE, baseUrl: `/forum/thread/${thread.id}` });
    const posts = db.prepare(`
      SELECT p.*, u.username, u.avatar_color, u.avatar_path, u.points, u.title AS user_title, u.signature,
             u.post_count, u.created_at AS user_created_at, u.role AS user_role
      FROM forum_posts p JOIN users u ON u.id = p.user_id
      WHERE p.thread_id = ?${statusWhere} ORDER BY p.floor LIMIT ? OFFSET ?`).all(thread.id, POSTS_PER_PAGE, pager.offset);
    posts.forEach((p) => {
      p.level = levelInfo({ points: p.points, title: p.user_title });
      p.canEdit = !!req.user && (req.user.id === p.user_id || mod);
    });

    const board = forum.getBoard(ctx, thread.board_id);
    const poll = thread.is_poll ? forum.pollOf(ctx, thread.id, req.user?.id) : null;
    const prev = db.prepare("SELECT id, title FROM forum_threads WHERE board_id = ? AND status = 'published' AND last_post_at > ? ORDER BY last_post_at ASC LIMIT 1").get(thread.board_id, thread.last_post_at);
    const next = db.prepare("SELECT id, title FROM forum_threads WHERE board_id = ? AND status = 'published' AND last_post_at < ? ORDER BY last_post_at DESC LIMIT 1").get(thread.board_id, thread.last_post_at);

    res.render('forum/thread.njk', {
      title: thread.title, nav: 'forum',
      crumbs: [['论坛', '/forum'], [board.name, `/forum/board/${board.id}`], [thread.title]],
      thread, board, posts, pager, poll, prev, next, mod,
      canReply: !!req.user && thread.status === 'published' && (!thread.locked || mod),
      boards: mod ? boardsForSelect() : [],
    });
  });

  // ---------- 回复 / 投票 ----------
  r.post('/forum/thread/:id/reply', requireLogin, (req, res) => {
    const thread = loadThread(req);
    if (!limiter.check(`reply:${req.user.id}`, 30, 5 * 60_000)) {
      return res.message({ title: '回复失败', text: '回复太频繁了，请稍后再试', ok: false, status: 429 });
    }
    try {
      const { floor } = forum.createReply(ctx, { thread, user: req.user, content: req.body.content });
      res.redirect(303, threadUrl(thread.id, floor));
    } catch (e) {
      if (!(e instanceof forum.ValidationError)) throw e;
      res.message({ title: '回复失败', text: e.message, ok: false, status: 400 });
    }
  });

  r.post('/forum/thread/:id/vote', requireLogin, (req, res) => {
    const thread = loadThread(req);
    try {
      forum.vote(ctx, { thread, user: req.user, optionId: req.body.option_id });
      res.redirect(303, `/forum/thread/${thread.id}#poll`);
    } catch (e) {
      if (!(e instanceof forum.ValidationError)) throw e;
      res.message({ title: '投票失败', text: e.message, ok: false, status: 400 });
    }
  });

  // ---------- 版主操作 ----------
  r.post('/forum/thread/:id/mod', requireLogin, (req, res) => {
    if (!isMod(req.user)) throw httpError(403, '只有版主和站长才能管理主题');
    const thread = forum.getThread(ctx, intParam(req.params.id));
    if (!thread) throw httpError(404, '主题不存在');
    const op = String(req.body.op || '');
    const flags = {
      sticky: ['sticky', 1, '置顶成功'], unsticky: ['sticky', 0, '已取消置顶'],
      digest: ['digest', 1, '已加为精华'], undigest: ['digest', 0, '已取消精华'],
      lock: ['locked', 1, '主题已锁定'], unlock: ['locked', 0, '主题已解锁'],
    };
    try {
      if (flags[op]) {
        const [flag, value, text] = flags[op];
        forum.setThreadFlag(ctx, thread, flag, value);
        return res.message({ title: '操作成功', text, redirect: threadUrl(thread.id) });
      }
      if (op === 'hide') {
        forum.setThreadStatus(ctx, thread, 'hidden');
        return res.message({ title: '操作成功', text: '主题已隐藏', redirect: `/forum/board/${thread.board_id}` });
      }
      if (op === 'unhide') {
        forum.setThreadStatus(ctx, thread, 'published');
        return res.message({ title: '操作成功', text: '主题已恢复显示', redirect: threadUrl(thread.id) });
      }
      if (op === 'move') {
        forum.moveThread(ctx, thread, intParam(req.body.board_id));
        return res.message({ title: '操作成功', text: '主题已移动', redirect: threadUrl(thread.id) });
      }
    } catch (e) {
      if (!(e instanceof forum.ValidationError)) throw e;
      return res.message({ title: '操作失败', text: e.message, ok: false, status: 400 });
    }
    throw httpError(400, '未知操作');
  });

  r.post('/forum/post/:id/hide', requireLogin, (req, res) => {
    if (!isMod(req.user)) throw httpError(403, '只有版主和站长才能隐藏帖子');
    const post = forum.getPost(ctx, intParam(req.params.id));
    if (!post) throw httpError(404, '帖子不存在');
    const thread = forum.getThread(ctx, post.thread_id);
    forum.setPostStatus(ctx, post, 'hidden');
    if (post.floor === 1) return res.message({ title: '操作成功', text: '1 楼被隐藏，整个主题已隐藏', redirect: `/forum/board/${thread.board_id}` });
    res.message({ title: '操作成功', text: `${post.floor} 楼已隐藏`, redirect: threadUrl(thread.id, post.floor) });
  });

  r.post('/forum/post/:id/restore', requireLogin, (req, res) => {
    if (!isMod(req.user)) throw httpError(403, '只有版主和站长才能恢复帖子');
    const post = forum.getPost(ctx, intParam(req.params.id));
    if (!post) throw httpError(404, '帖子不存在');
    forum.setPostStatus(ctx, post, 'published');
    res.message({ title: '操作成功', text: `${post.floor} 楼已恢复显示`, redirect: threadUrl(post.thread_id, post.floor) });
  });

  // ---------- 编辑帖子 ----------
  const editPage = (res, post, thread, data = {}) => res.render('forum/edit.njk', {
    title: '编辑帖子', nav: 'forum',
    crumbs: [['论坛', '/forum'], [thread.board_name, `/forum/board/${thread.board_id}`], [thread.title, threadUrl(thread.id)], ['编辑']],
    post, thread, form: { title: thread.title, content: post.content }, ...data,
  });

  r.get('/forum/post/:id/edit', requireLogin, (req, res) => {
    const { post, thread } = loadPost(req);
    if (post.user_id !== req.user.id && !isMod(req.user)) throw httpError(403, '只能编辑自己的帖子');
    editPage(res, post, thread);
  });

  r.post('/forum/post/:id/edit', requireLogin, (req, res) => {
    const { post, thread } = loadPost(req);
    if (post.user_id !== req.user.id && !isMod(req.user)) throw httpError(403, '只能编辑自己的帖子');
    if (thread.locked && !isMod(req.user)) throw httpError(403, '主题已锁定，不能编辑');
    try {
      forum.editPost(ctx, { post, thread, editor: req.user, content: req.body.content, title: post.floor === 1 ? req.body.title : undefined });
      res.message({ title: '保存成功', text: '帖子已更新', redirect: threadUrl(thread.id, post.floor) });
    } catch (e) {
      if (!(e instanceof forum.ValidationError)) throw e;
      editPage(res.status(400), post, thread, { form: { title: req.body.title, content: req.body.content }, error: e.message });
    }
  });

  return r;
}
