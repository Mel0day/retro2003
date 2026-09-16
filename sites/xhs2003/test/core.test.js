import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, CAPTCHA, ADMIN, PNG_1PX } from './helpers.js';
import { render, analyze, renderPages } from '../src/lib/ubb.js';

let t;
before(async () => { t = await startApp(); });
after(async () => { await t.stop(); });

test('UBB：转义 HTML、过滤危险链接和图片地址', () => {
  const html = render('<script>alert(1)</script>[url=javascript:alert(1)]x[/url][img]javascript:1[/img][color=red" onx="1]y[/color]');
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('href="javascript'));
  assert.ok(!html.includes('src="javascript'));
  assert.ok(!/onx="/.test(html));
  assert.match(render('[b]粗[/b]'), /<b>粗<\/b>/);
  assert.match(render('[table][tr][td]a[td]b[/tr][/table]'), /<td>a<\/td><td>b<\/td>/);
  assert.deepEqual(analyze('[img]/uploads/a.jpg[/img]文字').images, ['/uploads/a.jpg']);
  assert.equal(renderPages('第一段\n\n第二段\n\n第三段', 3).length, 3);
  assert.ok(!render('[img]/uploads/a.jpg[/img]', 'comment').includes('<img'), '留言里不允许插图');
});

test('首页、健康检查、验证码、404 均正常', async () => {
  const c = t.client();
  assert.equal((await c.get('/')).status, 200);
  assert.equal((await c.get('/healthz')).json.ok, true);
  const cap = await c.get('/captcha.svg?scope=login');
  assert.equal(cap.status, 200);
  assert.match(cap.headers.get('content-type'), /svg/);
  assert.equal((await c.get('/no-such-page')).status, 404);
});

test('手机访问首页自动跳转 WAP，带 pc=1 时记住电脑版', async () => {
  const c = t.client();
  const ua = { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile' };
  const r1 = await c.get('/', { headers: ua });
  assert.equal(r1.status, 302);
  assert.equal(r1.location, '/wap');
  await c.get('/?pc=1', { headers: ua });
  assert.equal((await c.get('/', { headers: ua })).status, 200);
});

test('POST 请求缺少 CSRF 令牌会被拒绝', async () => {
  const c = t.client();
  await c.init();
  const res = await c.request('POST', '/login', { body: new URLSearchParams({ username: 'a', password: 'b' }), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(res.status, 403);
});

test('注册、退出、登录、验证码错误、忘记密码', async () => {
  const c = t.client();
  await c.init();
  const bad = await c.post('/register', { username: '新会员', password: 'secret123', password2: 'secret123', question: '我的小学？', answer: '实验小学', captcha: 'XXXX', agree: '1' });
  assert.equal(bad.status, 400);
  assert.match(bad.text, /验证码错误/);

  const ok = await c.post('/register', { username: '新会员', password: 'secret123', password2: 'secret123', question: '我的小学？', answer: '实验小学', captcha: CAPTCHA, agree: '1' });
  assert.equal(ok.status, 200);
  assert.match(ok.text, /注册成功/);
  assert.ok(c.jar.has('sid'));

  const dup = await t.client().post('/register', { username: '新会员', password: 'secret123', password2: 'secret123', question: 'q', answer: 'a', captcha: CAPTCHA, agree: '1' });
  assert.match(dup.text, /已被注册/);

  await c.post('/logout');
  assert.ok(!c.jar.has('sid'));

  const wrong = await c.post('/login', { username: '新会员', password: 'nope', captcha: CAPTCHA });
  assert.match(wrong.text, /用户名或密码错误/);

  const f1 = await c.post('/forgot', { username: '新会员' });
  assert.match(f1.text, /我的小学？/);
  const f2 = await c.post('/forgot', { username: '新会员', step: '2', answer: ' 实验小学 ', password: 'newpass123', password2: 'newpass123', captcha: CAPTCHA });
  assert.match(f2.text, /密码已重置/);
  await c.login('新会员', 'newpass123');
});

test('封禁会员无法登录', async () => {
  const id = t.createUser('坏人', 'pass123456');
  t.ctx.db.prepare('UPDATE users SET banned = 1 WHERE id = ?').run(id);
  const c = t.client();
  const res = await c.post('/login', { username: '坏人', password: 'pass123456', captcha: CAPTCHA });
  assert.match(res.text, /封禁/);
});

test('笔记：发表、详情、编辑、点击去重、顶/收藏/送花、留言与审核', async () => {
  t.createUser('作者甲', 'pass123456');
  t.createUser('读者乙', 'pass123456');
  const author = t.client();
  await author.login('作者甲', 'pass123456');

  const up = await author.upload('/api/upload', {}, { file: { buffer: PNG_1PX } });
  assert.equal(up.json.ok, true, up.text);
  const channelId = t.ctx.db.prepare("SELECT id FROM channels WHERE slug = 'travel'").get().id;
  const create = await author.post('/notes', {
    title: '周末去西湖骑车', channel_id: channelId, tags: '旅行 杭州',
    content: `今天天气很好，去西湖骑车。\n\n[img=断桥]${up.json.url}[/img]`,
  });
  assert.match(create.text, /发表成功/);
  const note = t.ctx.db.prepare("SELECT * FROM notes WHERE title = '周末去西湖骑车'").get();
  assert.equal(note.has_image, 1);
  assert.equal(note.cover, up.json.url);
  assert.equal(t.ctx.db.prepare("SELECT points FROM users WHERE username = '作者甲'").get().points >= 10, true);

  const reader = t.client();
  const d1 = await reader.get(`/notes/${note.id}`);
  assert.equal(d1.status, 200);
  assert.match(d1.text, /周末去西湖骑车/);
  await reader.get(`/notes/${note.id}`);
  assert.equal(t.ctx.db.prepare('SELECT hits FROM notes WHERE id = ?').get(note.id).hits, 1, '同一访客重复刷新只算一次点击');

  const like1 = await reader.api(`/api/notes/${note.id}/like`);
  assert.equal(like1.json.count, 1);
  const like2 = await reader.api(`/api/notes/${note.id}/like`);
  assert.equal(like2.json.ok, false);

  const fav = await reader.api(`/api/notes/${note.id}/favorite`);
  assert.equal(fav.status, 401);

  // 游客留言默认进入审核
  const g = await reader.post(`/notes/${note.id}/comments`, { nickname: '路人丙', content: '写得真好！', captcha: CAPTCHA });
  assert.match(g.text, /审核/);
  const pending = t.ctx.db.prepare('SELECT * FROM comments WHERE note_id = ?').get(note.id);
  assert.equal(pending.status, 'pending');
  assert.ok(!(await reader.get(`/notes/${note.id}`)).text.includes('写得真好！'));

  const r2 = t.client();
  await r2.login('读者乙', 'pass123456');
  const m = await r2.post(`/notes/${note.id}/comments`, { content: '会员留言直接显示' });
  assert.equal(m.status, 303);
  assert.equal((await r2.api(`/api/notes/${note.id}/favorite`)).json.favorited, true);
  assert.equal((await r2.api(`/api/notes/${note.id}/flower`)).json.ok, true);
  assert.equal((await r2.api(`/api/notes/${note.id}/flower`)).json.ok, false, '一天只能送一朵');
  assert.equal((await author.api(`/api/notes/${note.id}/flower`)).json.ok, false, '不能给自己送花');
  const after1 = t.ctx.db.prepare('SELECT * FROM notes WHERE id = ?').get(note.id);
  assert.equal(after1.comment_count, 1);
  assert.equal(after1.flowers, 1);
  assert.equal(after1.favorites, 1);
  const pm = t.ctx.db.prepare("SELECT COUNT(*) AS n FROM messages WHERE to_id = ?").get(note.user_id).n;
  assert.ok(pm >= 2, '作者收到留言和送花的系统通知');

  // 站长审核游客留言
  const admin = t.client();
  await admin.login(ADMIN.username, ADMIN.password);
  assert.equal((await admin.api(`/api/comments/${pending.id}/approve`)).json.ok, true);
  assert.match((await reader.get(`/notes/${note.id}`)).text, /写得真好！/);

  // 他人不能编辑
  assert.equal((await r2.get(`/notes/${note.id}/edit`)).status, 403);
  const edit = await author.post(`/notes/${note.id}/edit`, { title: '周末去西湖骑车（更新）', channel_id: channelId, tags: '旅行', content: '更新后的正文内容，没有图片了。' });
  assert.match(edit.text, /保存成功/);
  const edited = t.ctx.db.prepare('SELECT * FROM notes WHERE id = ?').get(note.id);
  assert.equal(edited.has_image, 0);
  assert.equal(edited.edited_by, '作者甲');

  // 列表、标签、打印、举报
  assert.match((await reader.get('/notes?channel=travel')).text, /周末去西湖骑车（更新）/);
  assert.equal((await reader.get(`/tags/${encodeURIComponent('旅行')}`)).status, 200);
  assert.equal((await reader.get(`/notes/${note.id}/print`)).status, 200);
  const rep = await r2.post('/report', { type: 'note', id: note.id, category: '广告垃圾', reason: '测试' });
  assert.match(rep.text, /举报成功/);

  // 删除
  const del = await author.post(`/notes/${note.id}/delete`);
  assert.match(del.text, /删除成功/);
  assert.equal((await reader.get(`/notes/${note.id}`)).status, 404);
});

test('上传：拒绝非图片文件和超限文件', async () => {
  t.createUser('上传者', 'pass123456');
  const c = t.client();
  await c.login('上传者', 'pass123456');
  const bad = await c.upload('/api/upload', {}, { file: { buffer: Buffer.from('<?php echo 1; ?>'), name: 'x.png' } });
  assert.equal(bad.status, 400);
  t.ctx.settings.set('upload_max_kb', '0');
  const big = await c.upload('/api/upload', {}, { file: { buffer: PNG_1PX } });
  assert.equal(big.status, 400);
  t.ctx.settings.set('upload_max_kb', '2048');
  const anon = await t.client().upload('/api/upload', {}, { file: { buffer: PNG_1PX } });
  assert.equal(anon.status, 401);
});
