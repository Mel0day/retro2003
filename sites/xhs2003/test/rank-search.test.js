import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';
import { likeEscape } from '../src/routes/search.js';

let t;
before(async () => {
  t = await startApp();
  const { db } = t.ctx;
  const u1 = t.createUser('搜索达人', 'pass123456');
  const u2 = t.createUser('100%_会员', 'pass123456');
  const ch = db.prepare("SELECT id FROM channels WHERE slug = 'food'").get().id;
  const ins = db.prepare("INSERT INTO notes (user_id, channel_id, title, content, summary, hits, likes, flowers, comment_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
  ins.run(u1, ch, '红烧肉的做法', '五花肉切块，冰糖炒色。', '五花肉切块', 500, 30, 5, 3);
  ins.run(u2, ch, '100% 纯手工饺子', '折扣 50% 的面粉也能做', '饺子', 900, 10, 9, 1);
  ins.run(u1, ch, '普通笔记标题', '没有特殊字符的内容', '普通', 10, 1, 0, 0);
  db.prepare("INSERT INTO products (category, name, price_cents, stock, sales, description) VALUES ('食品零食', '饺子皮 500g', 800, 10, 77, '手工擀制')").run();
  const board = db.prepare('SELECT id FROM forum_boards LIMIT 1').get().id;
  const tid = db.prepare("INSERT INTO forum_threads (board_id, user_id, title, reply_count) VALUES (?, ?, '讨论一下饺子馅', 12)").run(board, u1).lastInsertRowid;
  db.prepare("INSERT INTO forum_posts (thread_id, user_id, content, floor) VALUES (?, ?, '韭菜鸡蛋馅最好吃', 1)").run(tid, u1);
  db.prepare('UPDATE users SET points = 999 WHERE id = ?').run(u1);
  db.prepare('UPDATE users SET post_count = 1 WHERE id = ?').run(u1);
  // 本周的顶和送花记录
  const nid = db.prepare("SELECT id FROM notes WHERE title = '红烧肉的做法'").get().id;
  db.prepare("INSERT INTO note_likes (note_id, voter) VALUES (?, 'v:abc'), (?, 'v:def')").run(nid, nid);
  db.prepare("INSERT INTO flowers (note_id, user_id, day) VALUES (?, ?, '2026-01-01')").run(nid, u2);
});
after(async () => { await t.stop(); });

test('LIKE 通配符转义', () => {
  assert.equal(likeEscape('100%_a\\b'), '%100\\%\\_a\\\\b%');
});

test('排行榜：三个时间范围都能打开并包含数据', async () => {
  const c = t.client();
  for (const range of ['week', 'month', 'all']) {
    const r = await c.get(`/rank?range=${range}`);
    assert.equal(r.status, 200, range);
    assert.match(r.text, /笔记点击榜/);
    assert.match(r.text, /好物销量榜/);
  }
  const week = await c.get('/rank?range=week');
  assert.match(week.text, /id="rank-likes"[\s\S]*?红烧肉的做法[\s\S]*?2 顶/);
  assert.match(week.text, /id="rank-flowers"[\s\S]*?红烧肉的做法/);
  const all = await c.get('/rank?range=all');
  assert.match(all.text, /id="rank-points"[\s\S]*?搜索达人[\s\S]*?999 分/);
  assert.match(all.text, /id="rank-threads"[\s\S]*?讨论一下饺子馅/);
  assert.match(all.text, /id="rank-goods"[\s\S]*?饺子皮 500g[\s\S]*?77 件/);
  assert.equal((await c.get('/rank?range=bogus')).status, 200);
});

test('搜索：四种类型、高亮、空关键词、无结果', async () => {
  const c = t.client();
  const empty = await c.get('/search');
  assert.equal(empty.status, 200);
  assert.match(empty.text, /请输入要搜索的关键词/);

  const note = await c.get(`/search?q=${encodeURIComponent('红烧')}&type=note`);
  assert.match(note.text, /<b class="hl">红烧<\/b>肉的做法/);
  assert.match(note.text, /找到 1 条结果/);

  const content = await c.get(`/search?q=${encodeURIComponent('冰糖')}`);
  assert.match(content.text, /红烧肉的做法/, '正文命中也能搜到');

  const user = await c.get(`/search?q=${encodeURIComponent('达人')}&type=user`);
  assert.match(user.text, /搜索<b class="hl">达人<\/b>/);

  const goods = await c.get(`/search?q=${encodeURIComponent('饺子')}&type=goods`);
  assert.match(goods.text, /饺子皮 500g|<b class="hl">饺子<\/b>皮 500g/);
  assert.match(goods.text, /¥8/);

  const thread = await c.get(`/search?q=${encodeURIComponent('韭菜')}&type=thread`);
  assert.match(thread.text, /讨论一下饺子馅/, '回帖内容命中主题');

  const none = await c.get(`/search?q=${encodeURIComponent('不存在的词')}`);
  assert.match(none.text, /没有找到/);

  const xss = await c.get(`/search?q=${encodeURIComponent('<script>')}`);
  assert.ok(!xss.text.includes('<script>alert') && !xss.text.includes('搜索：<script>'));
});

test('搜索：% 和 _ 被当作普通字符而不是通配符', async () => {
  const c = t.client();
  const pct = await c.get(`/search?q=${encodeURIComponent('%')}&type=note`);
  assert.match(pct.text, /找到 1 条结果/, '只匹配真正包含 % 的笔记');
  assert.match(pct.text, /纯手工饺子/);
  assert.ok(!pct.text.includes('普通笔记标题'));

  const us = await c.get(`/search?q=${encodeURIComponent('_')}&type=user`);
  assert.match(us.text, /找到 1 条结果/);
  assert.ok(!us.text.includes('搜索达人'));
});
