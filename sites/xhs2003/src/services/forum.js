// 论坛业务：发帖、回帖、投票、置顶加精锁帖、隐藏删除和计数维护
import { now } from '../lib/format.js';
import { awardPoints, sendSystemMessage } from './points.js';
import { ValidationError } from './notes.js';

export { ValidationError };

export function listBoardsGrouped(ctx) {
  const cats = ctx.db.prepare('SELECT * FROM forum_categories ORDER BY sort, id').all();
  const boards = ctx.db.prepare(`
    SELECT b.*, t.title AS last_title, t.id AS last_tid, u.username AS last_username, u.id AS last_uid
    FROM forum_boards b
    LEFT JOIN forum_threads t ON t.id = b.last_thread_id
    LEFT JOIN users u ON u.id = t.last_post_user_id
    ORDER BY b.sort, b.id`).all();
  return cats.map((c) => ({ ...c, boards: boards.filter((b) => b.category_id === c.id) }));
}

export const getBoard = (ctx, id) => ctx.db.prepare('SELECT * FROM forum_boards WHERE id = ?').get(Number(id));

export const getThread = (ctx, id) => ctx.db.prepare(`
  SELECT t.*, b.name AS board_name, u.username
  FROM forum_threads t JOIN forum_boards b ON b.id = t.board_id JOIN users u ON u.id = t.user_id
  WHERE t.id = ?`).get(Number(id));

export const getPost = (ctx, id) => ctx.db.prepare('SELECT * FROM forum_posts WHERE id = ?').get(Number(id));

export function recountThread(ctx, threadId) {
  const { db } = ctx;
  const last = db.prepare(`SELECT user_id, created_at FROM forum_posts WHERE thread_id = ? AND status = 'published' ORDER BY floor DESC LIMIT 1`).get(threadId);
  const n = db.prepare(`SELECT COUNT(*) AS n FROM forum_posts WHERE thread_id = ? AND status = 'published'`).get(threadId).n;
  db.prepare('UPDATE forum_threads SET reply_count = ?, last_post_at = COALESCE(?, last_post_at), last_post_user_id = COALESCE(?, last_post_user_id) WHERE id = ?')
    .run(Math.max(0, n - 1), last?.created_at ?? null, last?.user_id ?? null, threadId);
}

export function recountBoard(ctx, boardId) {
  ctx.db.prepare(`UPDATE forum_boards SET
    thread_count = (SELECT COUNT(*) FROM forum_threads WHERE board_id = @id AND status = 'published'),
    post_count = (SELECT COUNT(*) FROM forum_posts p JOIN forum_threads t ON t.id = p.thread_id
                  WHERE t.board_id = @id AND t.status = 'published' AND p.status = 'published'),
    last_thread_id = (SELECT id FROM forum_threads WHERE board_id = @id AND status = 'published' ORDER BY last_post_at DESC LIMIT 1),
    last_post_at = (SELECT MAX(last_post_at) FROM forum_threads WHERE board_id = @id AND status = 'published')
    WHERE id = @id`).run({ id: boardId });
}

export function recountUserPosts(ctx, userId) {
  ctx.db.prepare(`UPDATE users SET post_count = (SELECT COUNT(*) FROM forum_posts WHERE user_id = ? AND status = 'published') WHERE id = ?`).run(userId, userId);
}

function cleanContent(content, min = 2, max = 20000) {
  const c = String(content || '').replace(/\r\n?/g, '\n').trim();
  if ([...c].length < min) throw new ValidationError(`内容至少 ${min} 个字`);
  if (c.length > max) throw new ValidationError(`内容不能超过 ${max} 字`);
  return c;
}

function cleanTitle(title) {
  const t = String(title || '').trim();
  if ([...t].length < 2 || [...t].length > 60) throw new ValidationError('标题长度需要在 2 到 60 个字之间');
  return t;
}

// pollOptions: 字符串数组，传入 2 个以上选项时创建投票帖
export function createThread(ctx, { boardId, user, title, content, pollOptions = [] }) {
  const board = getBoard(ctx, boardId);
  if (!board) throw new ValidationError('版块不存在');
  const t = cleanTitle(title);
  const c = cleanContent(content);
  const options = pollOptions.map((o) => String(o || '').trim().slice(0, 30)).filter(Boolean);
  if (options.length === 1 || options.length > 10) throw new ValidationError('投票选项需要 2 到 10 个');
  const isPoll = options.length >= 2;
  const ts = now();
  return ctx.db.transaction(() => {
    const tid = Number(ctx.db.prepare(`INSERT INTO forum_threads (board_id, user_id, title, is_poll, last_post_at, last_post_user_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(board.id, user.id, t, isPoll ? 1 : 0, ts, user.id, ts).lastInsertRowid);
    ctx.db.prepare('INSERT INTO forum_posts (thread_id, user_id, content, floor, created_at) VALUES (?, ?, ?, 1, ?)').run(tid, user.id, c, ts);
    if (isPoll) {
      const ins = ctx.db.prepare('INSERT INTO poll_options (thread_id, label, sort) VALUES (?, ?, ?)');
      options.forEach((o, i) => ins.run(tid, o, i));
    }
    recountBoard(ctx, board.id);
    recountUserPosts(ctx, user.id);
    awardPoints(ctx, user.id, 'thread');
    return tid;
  })();
}

export function createReply(ctx, { thread, user, content }) {
  if (thread.status !== 'published') throw new ValidationError('主题不存在或已被删除');
  if (thread.locked && !['admin', 'moderator'].includes(user.role)) throw new ValidationError('该主题已被锁定，不能回复');
  const c = cleanContent(content);
  const ts = now();
  return ctx.db.transaction(() => {
    const floor = (ctx.db.prepare('SELECT MAX(floor) AS f FROM forum_posts WHERE thread_id = ?').get(thread.id).f || 0) + 1;
    const id = Number(ctx.db.prepare('INSERT INTO forum_posts (thread_id, user_id, content, floor, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(thread.id, user.id, c, floor, ts).lastInsertRowid);
    recountThread(ctx, thread.id);
    recountBoard(ctx, thread.board_id);
    recountUserPosts(ctx, user.id);
    awardPoints(ctx, user.id, 'reply');
    if (thread.user_id !== user.id) {
      sendSystemMessage(ctx, thread.user_id, `${user.username} 回复了你的主题`,
        `${user.username} 回复了你的主题 [url=/forum/thread/${thread.id}?floor=${floor}#floor-${floor}]《${thread.title}》[/url]`);
    }
    return { id, floor };
  })();
}

export function editPost(ctx, { post, thread, editor, content, title }) {
  const c = cleanContent(content);
  ctx.db.transaction(() => {
    ctx.db.prepare('UPDATE forum_posts SET content = ?, edited_at = ? WHERE id = ?').run(c, now(), post.id);
    if (post.floor === 1 && title !== undefined) {
      ctx.db.prepare('UPDATE forum_threads SET title = ? WHERE id = ?').run(cleanTitle(title), thread.id);
    }
  })();
}

export function setThreadFlag(ctx, thread, flag, value) {
  if (!['sticky', 'digest', 'locked'].includes(flag)) throw new ValidationError('未知操作');
  const v = value ? 1 : 0;
  ctx.db.prepare(`UPDATE forum_threads SET ${flag} = ? WHERE id = ?`).run(v, thread.id);
  if (flag === 'digest' && v && !thread.digest) {
    awardPoints(ctx, thread.user_id, 'digest');
    sendSystemMessage(ctx, thread.user_id, '你的主题被加为精华', `恭喜！你的主题 [url=/forum/thread/${thread.id}]《${thread.title}》[/url] 被加为精华，积分 +20。`);
  }
}

export function setThreadStatus(ctx, thread, status) {
  ctx.db.transaction(() => {
    ctx.db.prepare('UPDATE forum_threads SET status = ? WHERE id = ?').run(status, thread.id);
    recountBoard(ctx, thread.board_id);
    const users = ctx.db.prepare('SELECT DISTINCT user_id FROM forum_posts WHERE thread_id = ?').all(thread.id);
    for (const u of users) recountUserPosts(ctx, u.user_id);
  })();
}

export function setPostStatus(ctx, post, status) {
  const thread = getThread(ctx, post.thread_id);
  if (post.floor === 1) return setThreadStatus(ctx, thread, status);
  ctx.db.transaction(() => {
    ctx.db.prepare('UPDATE forum_posts SET status = ? WHERE id = ?').run(status, post.id);
    recountThread(ctx, thread.id);
    recountBoard(ctx, thread.board_id);
    recountUserPosts(ctx, post.user_id);
  })();
}

export function moveThread(ctx, thread, boardId) {
  const board = getBoard(ctx, boardId);
  if (!board) throw new ValidationError('目标版块不存在');
  ctx.db.transaction(() => {
    ctx.db.prepare('UPDATE forum_threads SET board_id = ? WHERE id = ?').run(board.id, thread.id);
    recountBoard(ctx, thread.board_id);
    recountBoard(ctx, board.id);
  })();
}

export function pollOf(ctx, threadId, userId) {
  const options = ctx.db.prepare('SELECT * FROM poll_options WHERE thread_id = ? ORDER BY sort, id').all(threadId);
  const total = options.reduce((s, o) => s + o.votes, 0);
  options.forEach((o) => { o.percent = total ? Math.round((o.votes / total) * 100) : 0; });
  const voted = userId ? ctx.db.prepare('SELECT option_id FROM poll_votes WHERE thread_id = ? AND user_id = ?').get(threadId, userId) : null;
  return { options, total, votedOptionId: voted?.option_id ?? null };
}

export function vote(ctx, { thread, user, optionId }) {
  if (!thread.is_poll) throw new ValidationError('这不是投票帖');
  const opt = ctx.db.prepare('SELECT * FROM poll_options WHERE id = ? AND thread_id = ?').get(Number(optionId), thread.id);
  if (!opt) throw new ValidationError('请选择一个投票选项');
  return ctx.db.transaction(() => {
    const info = ctx.db.prepare('INSERT OR IGNORE INTO poll_votes (thread_id, user_id, option_id) VALUES (?, ?, ?)').run(thread.id, user.id, opt.id);
    if (!info.changes) throw new ValidationError('您已经投过票了');
    ctx.db.prepare('UPDATE poll_options SET votes = votes + 1 WHERE id = ?').run(opt.id);
    return true;
  })();
}
