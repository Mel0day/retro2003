import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, ADMIN } from './helpers.js';

let t;
let boardId;
before(async () => {
  t = await startApp();
  boardId = t.ctx.db.prepare("SELECT id FROM forum_boards WHERE name = '灌水乐园'").get().id;
  t.createUser('楼主甲', 'pass123456');
  t.createUser('回帖乙', 'pass123456');
  t.createUser('版主丙', 'pass123456', { role: 'moderator' });
});
after(async () => { await t.stop(); });

const board = () => t.ctx.db.prepare('SELECT * FROM forum_boards WHERE id = ?').get(boardId);
const thread = (id) => t.ctx.db.prepare('SELECT * FROM forum_threads WHERE id = ?').get(id);

test('论坛首页、版块页、游客不能发帖', async () => {
  const guest = t.client();
  const idx = await guest.get('/forum');
  assert.equal(idx.status, 200);
  assert.match(idx.text, /灌水乐园/);
  assert.match(idx.text, /站务公告/);
  assert.equal((await guest.get(`/forum/board/${boardId}`)).status, 200);
  assert.equal((await guest.get('/forum/board/99999')).status, 404);
  const r = await guest.get(`/forum/board/${boardId}/new`);
  assert.equal(r.status, 302);
  assert.match(r.location, /^\/login/);
});

test('发帖、回帖楼层、点击去重、编辑权限', async () => {
  const a = t.client();
  await a.login('楼主甲', 'pass123456');
  const bad = await a.post(`/forum/board/${boardId}/new`, { title: '', content: '内容' });
  assert.equal(bad.status, 400);

  const created = await a.post(`/forum/board/${boardId}/new`, { title: '大家周末都干嘛', content: '我先说，我在家睡觉 :-P' });
  assert.match(created.text, /发帖成功/);
  const th = t.ctx.db.prepare("SELECT * FROM forum_threads WHERE title = '大家周末都干嘛'").get();
  assert.ok(th);
  assert.equal(board().thread_count, 1);
  assert.equal(board().post_count, 1);

  const b = t.client();
  await b.login('回帖乙', 'pass123456');
  const r1 = await b.post(`/forum/thread/${th.id}/reply`, { content: '我去爬山' });
  assert.equal(r1.status, 303);
  assert.equal(r1.location, `/forum/thread/${th.id}?floor=2#floor-2`);
  const r2 = await a.post(`/forum/thread/${th.id}/reply`, { content: '[quote=回帖乙]我去爬山[/quote]好厉害' });
  assert.match(r2.location, /floor=3/);
  assert.equal(thread(th.id).reply_count, 2);
  assert.equal(board().post_count, 3);
  assert.equal(t.ctx.db.prepare("SELECT post_count FROM users WHERE username = '楼主甲'").get().post_count, 2);
  const notice = t.ctx.db.prepare("SELECT COUNT(*) AS n FROM messages m JOIN users u ON u.id = m.to_id WHERE u.username = '楼主甲' AND m.title LIKE '%回复了你的主题%'").get().n;
  assert.equal(notice, 1, '他人回帖给楼主发通知，自己回帖不发');

  const empty = await b.post(`/forum/thread/${th.id}/reply`, { content: ' ' });
  assert.equal(empty.status, 400);

  const guest = t.client();
  const page = await guest.get(`/forum/thread/${th.id}`);
  assert.equal(page.status, 200);
  assert.match(page.text, /楼主/);
  assert.match(page.text, /好厉害/);
  assert.match(page.text, /<blockquote class="ubb-quote">/);
  await guest.get(`/forum/thread/${th.id}`);
  assert.equal(thread(th.id).hits, 1, '同一访客只计一次点击');

  // ?floor 定位到对应分页
  for (let i = 0; i < 20; i++) await b.post(`/forum/thread/${th.id}/reply`, { content: `第 ${i + 4} 楼的回复` });
  const p2 = await guest.get(`/forum/thread/${th.id}?floor=20`);
  assert.match(p2.text, /id="floor-20"/);
  assert.ok(!p2.text.includes('id="floor-2"'), '第 20 楼在第 2 页');

  // 编辑：他人不行，作者可以改标题
  const post1 = t.ctx.db.prepare('SELECT id FROM forum_posts WHERE thread_id = ? AND floor = 1').get(th.id);
  assert.equal((await b.get(`/forum/post/${post1.id}/edit`)).status, 403);
  const ed = await a.post(`/forum/post/${post1.id}/edit`, { title: '大家周末都干嘛（已更新）', content: '改过的内容' });
  assert.match(ed.text, /保存成功/);
  assert.equal(thread(th.id).title, '大家周末都干嘛（已更新）');
});

test('投票：创建、投票、防重复、游客看结果', async () => {
  const a = t.client();
  await a.login('楼主甲', 'pass123456');
  const one = await a.post(`/forum/board/${boardId}/new`, { title: '去哪玩', content: '投票吧', poll: '1', poll_options: '只有一个' });
  assert.equal(one.status, 400);
  const res = await a.post(`/forum/board/${boardId}/new`, { title: '最想去的旅行地', content: '十一去哪里？', poll: '1', poll_options: '丽江\n西藏\n\n三亚' });
  assert.match(res.text, /发帖成功/);
  const th = t.ctx.db.prepare("SELECT * FROM forum_threads WHERE title = '最想去的旅行地'").get();
  assert.equal(th.is_poll, 1);
  const opts = t.ctx.db.prepare('SELECT * FROM poll_options WHERE thread_id = ? ORDER BY sort').all(th.id);
  assert.deepEqual(opts.map((o) => o.label), ['丽江', '西藏', '三亚']);

  const b = t.client();
  await b.login('回帖乙', 'pass123456');
  const v1 = await b.post(`/forum/thread/${th.id}/vote`, { option_id: opts[1].id });
  assert.equal(v1.status, 303);
  const v2 = await b.post(`/forum/thread/${th.id}/vote`, { option_id: opts[0].id });
  assert.match(v2.text, /已经投过票/);
  assert.equal(t.ctx.db.prepare('SELECT votes FROM poll_options WHERE id = ?').get(opts[1].id).votes, 1);
  assert.equal(t.ctx.db.prepare('SELECT votes FROM poll_options WHERE id = ?').get(opts[0].id).votes, 0);

  const guestView = await t.client().get(`/forum/thread/${th.id}`);
  assert.match(guestView.text, /共有 1 人参与/);
  assert.match(guestView.text, /登录<\/a> 后才能投票/);
  assert.equal((await t.client().post(`/forum/thread/${th.id}/vote`, { option_id: opts[0].id })).status, 302);
});

test('版主：置顶加精锁帖、锁帖后普通会员不能回、移动、隐藏后计数正确', async () => {
  const a = t.client();
  await a.login('楼主甲', 'pass123456');
  await a.post(`/forum/board/${boardId}/new`, { title: '版主操作测试帖', content: '请版主操作' });
  const th = t.ctx.db.prepare("SELECT * FROM forum_threads WHERE title = '版主操作测试帖'").get();
  const b = t.client();
  await b.login('回帖乙', 'pass123456');
  await b.post(`/forum/thread/${th.id}/reply`, { content: '沙发' });
  await b.post(`/forum/thread/${th.id}/reply`, { content: '板凳' });

  // 普通会员无权操作
  assert.equal((await b.post(`/forum/thread/${th.id}/mod`, { op: 'sticky' })).status, 403);

  const m = t.client();
  await m.login('版主丙', 'pass123456');
  const pointsBefore = t.ctx.db.prepare("SELECT points FROM users WHERE username = '楼主甲'").get().points;
  for (const op of ['sticky', 'digest', 'lock']) {
    const r = await m.post(`/forum/thread/${th.id}/mod`, { op });
    assert.match(r.text, /操作成功/);
  }
  let cur = thread(th.id);
  assert.equal(cur.sticky, 1);
  assert.equal(cur.digest, 1);
  assert.equal(cur.locked, 1);
  assert.equal(t.ctx.db.prepare("SELECT points FROM users WHERE username = '楼主甲'").get().points, pointsBefore + 20, '加精奖励 20 积分');

  // 置顶帖排在版块最前面
  await a.post(`/forum/board/${boardId}/new`, { title: '比置顶帖更新的帖子', content: '新帖' });
  const list = await t.client().get(`/forum/board/${boardId}`);
  assert.ok(list.text.indexOf('版主操作测试帖') < list.text.indexOf('比置顶帖更新的帖子'));
  assert.match(list.text, /\[置顶\]/);
  assert.match(list.text, /\[精华\]/);

  const locked = await b.post(`/forum/thread/${th.id}/reply`, { content: '锁了还能回吗' });
  assert.equal(locked.status, 400);
  assert.match(locked.text, /已被锁定/);
  const modReply = await m.post(`/forum/thread/${th.id}/reply`, { content: '版主可以回复锁定帖' });
  assert.equal(modReply.status, 303);
  await m.post(`/forum/thread/${th.id}/mod`, { op: 'unlock' });
  assert.equal(thread(th.id).locked, 0);

  // 隐藏单楼
  const before = board();
  const floor2 = t.ctx.db.prepare('SELECT id FROM forum_posts WHERE thread_id = ? AND floor = 2').get(th.id);
  await m.post(`/forum/post/${floor2.id}/hide`);
  assert.equal(thread(th.id).reply_count, 2);
  assert.equal(board().post_count, before.post_count - 1);
  assert.ok(!(await t.client().get(`/forum/thread/${th.id}`)).text.includes('沙发'));
  await m.post(`/forum/post/${floor2.id}/restore`);
  assert.equal(thread(th.id).reply_count, 3);

  // 移动版块
  const target = t.ctx.db.prepare("SELECT id FROM forum_boards WHERE name = '音乐影视'").get().id;
  const threadsBefore = board().thread_count;
  await m.post(`/forum/thread/${th.id}/mod`, { op: 'move', board_id: target });
  assert.equal(thread(th.id).board_id, target);
  assert.equal(board().thread_count, threadsBefore - 1);
  assert.equal(t.ctx.db.prepare('SELECT thread_count FROM forum_boards WHERE id = ?').get(target).thread_count, 1);

  // 隐藏主题：游客 404，版主可见，计数减少
  await m.post(`/forum/thread/${th.id}/mod`, { op: 'hide' });
  assert.equal(thread(th.id).status, 'hidden');
  assert.equal(t.ctx.db.prepare('SELECT thread_count, post_count FROM forum_boards WHERE id = ?').get(target).thread_count, 0);
  assert.equal(t.ctx.db.prepare('SELECT post_count FROM forum_boards WHERE id = ?').get(target).post_count, 0);
  assert.equal((await t.client().get(`/forum/thread/${th.id}`)).status, 404);
  assert.equal((await m.get(`/forum/thread/${th.id}`)).status, 200);
});

test('后台版块管理：权限、增删改、移动、带主题删除需确认', async () => {
  const b = t.client();
  await b.login('回帖乙', 'pass123456');
  assert.equal((await b.get('/admin/forum')).status, 403);
  const m = t.client();
  await m.login('版主丙', 'pass123456');
  assert.equal((await m.get('/admin/forum')).status, 403, '版主不能管理版块');

  const admin = t.client();
  await admin.login(ADMIN.username, ADMIN.password);
  assert.equal((await admin.get('/admin/forum')).status, 200);

  const c1 = await admin.post('/admin/forum/category', { name: '测试分区', sort: 9 });
  assert.equal(c1.status, 303);
  const cat = t.ctx.db.prepare("SELECT * FROM forum_categories WHERE name = '测试分区'").get();
  assert.equal(cat.sort, 9);
  await admin.post(`/admin/forum/category/${cat.id}`, { name: '测试分区改名', sort: 1 });
  assert.equal(t.ctx.db.prepare('SELECT name FROM forum_categories WHERE id = ?').get(cat.id).name, '测试分区改名');

  await admin.post('/admin/forum/board', { category_id: cat.id, name: '新版块', description: '简介', sort: 2 });
  const nb = t.ctx.db.prepare("SELECT * FROM forum_boards WHERE name = '新版块'").get();
  assert.equal(nb.category_id, cat.id);
  assert.equal((await admin.get(`/admin/forum/board/${nb.id}/edit`)).status, 200);
  const otherCat = t.ctx.db.prepare("SELECT id FROM forum_categories WHERE name = '社区事务'").get().id;
  await admin.post(`/admin/forum/board/${nb.id}`, { category_id: otherCat, name: '新版块2', description: '改', sort: 3 });
  assert.equal(t.ctx.db.prepare('SELECT category_id FROM forum_boards WHERE id = ?').get(nb.id).category_id, otherCat);

  // 版块下有主题时先要求确认
  const a = t.client();
  await a.login('楼主甲', 'pass123456');
  await a.post(`/forum/board/${nb.id}/new`, { title: '将被删除的帖子', content: '内容内容' });
  const ask = await admin.post(`/admin/forum/board/${nb.id}/delete`);
  assert.equal(ask.status, 200);
  assert.match(ask.text, /确认删除/);
  assert.ok(t.ctx.db.prepare('SELECT 1 FROM forum_boards WHERE id = ?').get(nb.id));
  const postsBefore = t.ctx.db.prepare("SELECT post_count FROM users WHERE username = '楼主甲'").get().post_count;
  const done = await admin.post(`/admin/forum/board/${nb.id}/delete`, { confirm: '1' });
  assert.equal(done.status, 303);
  assert.ok(!t.ctx.db.prepare('SELECT 1 FROM forum_boards WHERE id = ?').get(nb.id));
  assert.ok(!t.ctx.db.prepare("SELECT 1 FROM forum_threads WHERE title = '将被删除的帖子'").get());
  assert.equal(t.ctx.db.prepare("SELECT post_count FROM users WHERE username = '楼主甲'").get().post_count, postsBefore - 1);

  // 空分区直接删除
  const del = await admin.post(`/admin/forum/category/${cat.id}/delete`);
  assert.equal(del.status, 303);
  assert.ok(!t.ctx.db.prepare('SELECT 1 FROM forum_categories WHERE id = ?').get(cat.id));
});
