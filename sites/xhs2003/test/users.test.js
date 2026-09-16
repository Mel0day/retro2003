import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startApp, CAPTCHA, PNG_1PX } from './helpers.js';

let t;
before(async () => { t = await startApp(); });
after(async () => { await t.stop(); });

const loginAs = async (name, pw = 'pass123456') => { const c = t.client(); await c.login(name, pw); return c; };

test('个人主页：资料、四个选项卡、404、封禁提示', async () => {
  const id = t.createUser('主页君', 'pass123456', { location: '上海 徐汇' });
  t.ctx.db.prepare("UPDATE users SET signature = '在路上' WHERE id = ?").run(id);
  const g = t.client();
  const home = await g.get(`/u/${id}`);
  assert.equal(home.status, 200);
  assert.match(home.text, /主页君/);
  assert.match(home.text, /上海 徐汇/);
  assert.match(home.text, /在路上/);
  for (const tab of ['posts', 'albums', 'friends']) assert.equal((await g.get(`/u/${id}?tab=${tab}`)).status, 200);
  assert.equal((await g.get('/u/999999')).status, 404);
  t.ctx.db.prepare('UPDATE users SET banned = 1 WHERE id = ?').run(id);
  assert.match((await g.get(`/u/${id}`)).text, /该会员已被封禁/);
});

test('控制面板各页需要登录，登录后都能打开', async () => {
  const guest = t.client();
  const r = await guest.get('/my');
  assert.equal(r.status, 302);
  assert.match(r.location, /^\/login\?next=/);
  t.createUser('面板君');
  const c = await loginAs('面板君');
  for (const p of ['/my', '/my/profile', '/my/avatar', '/my/password', '/my/notes', '/my/favorites', '/my/posts', '/my/friends', '/my/points']) {
    const res = await c.get(p);
    assert.equal(res.status, 200, p);
    assert.match(res.text, /控制面板/, p);
  }
  // 每日登录奖励会写入积分记录
  assert.match((await c.get('/my/points')).text, /每日首次登录/);
});

test('修改资料：签名长度、提示问题需要当前密码', async () => {
  t.createUser('资料君');
  const c = await loginAs('资料君');
  const ok = await c.post('/my/profile', { location: '杭州 西湖', gender: 'female', signature: '生活需要仪式感', question: '' });
  assert.match(ok.text, /保存成功/);
  const row = t.ctx.db.prepare("SELECT * FROM users WHERE username = '资料君'").get();
  assert.equal(row.location, '杭州 西湖');
  assert.equal(row.gender, 'female');
  assert.equal(row.signature, '生活需要仪式感');

  const tooLong = await c.post('/my/profile', { location: '', gender: '', signature: '长'.repeat(101), question: '' });
  assert.equal(tooLong.status, 400);

  const noPw = await c.post('/my/profile', { location: '', gender: '', signature: '', question: '我的小学？', answer: '实验小学' });
  assert.equal(noPw.status, 400);
  assert.match(noPw.text, /当前密码/);

  const withPw = await c.post('/my/profile', { location: '', gender: '', signature: '', question: '我的小学？', answer: '实验小学', current_password: 'pass123456' });
  assert.match(withPw.text, /保存成功/);
  const f = await t.client().post('/forgot', { username: '资料君', step: '2', answer: '实验小学', password: 'brandnew1', password2: 'brandnew1', captcha: CAPTCHA });
  assert.match(f.text, /密码已重置/, '新的提示问题可以用来找回密码');
});

test('头像：上传图片、拒绝非图片、选纯色、颜色白名单', async () => {
  t.createUser('头像君');
  const c = await loginAs('头像君');
  const up = await c.upload('/my/avatar', {}, { avatar: { buffer: PNG_1PX } });
  assert.equal(up.status, 200, up.text.slice(0, 200));
  let row = t.ctx.db.prepare("SELECT avatar_path FROM users WHERE username = '头像君'").get();
  assert.ok(row.avatar_path);
  assert.ok(fs.existsSync(path.join(t.ctx.config.uploadDir, row.avatar_path)));
  assert.match((await c.get('/my/avatar')).text, new RegExp(`/uploads/${row.avatar_path}`));

  const bad = await c.upload('/my/avatar', {}, { avatar: { buffer: Buffer.from('not an image at all') } });
  assert.equal(bad.status, 400);

  const oldFile = path.join(t.ctx.config.uploadDir, row.avatar_path);
  const color = await c.post('/my/avatar/color', { color: '#c00' });
  assert.match(color.text, /纯色头像/);
  row = t.ctx.db.prepare("SELECT avatar_path, avatar_color FROM users WHERE username = '头像君'").get();
  assert.equal(row.avatar_path, '');
  assert.equal(row.avatar_color, '#c00');
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(!fs.existsSync(oldFile), '换成纯色后删除旧头像文件');

  const evil = await c.post('/my/avatar/color', { color: 'red;background:url(x)' });
  assert.equal(evil.status, 400);
});

test('修改密码：校验旧密码，其他会话失效、当前会话保留', async () => {
  t.createUser('改密君', 'oldpass123');
  const a = await loginAs('改密君', 'oldpass123');
  const b = await loginAs('改密君', 'oldpass123');

  const wrong = await a.post('/my/password', { old_password: 'nope', password: 'newpass123', password2: 'newpass123' });
  assert.match(wrong.text, /当前密码不正确/);
  const mismatch = await a.post('/my/password', { old_password: 'oldpass123', password: 'newpass123', password2: 'other' });
  assert.match(mismatch.text, /不一致/);

  const ok = await a.post('/my/password', { old_password: 'oldpass123', password: 'newpass123', password2: 'newpass123' });
  assert.match(ok.text, /密码已修改/);
  assert.equal((await a.get('/my')).status, 200, '当前会话保留');
  assert.equal((await b.get('/my')).status, 302, '其他会话被注销');

  const oldLogin = await t.client().post('/login', { username: '改密君', password: 'oldpass123', captcha: CAPTCHA });
  assert.match(oldLogin.text, /用户名或密码错误/);
  await loginAs('改密君', 'newpass123');
});

test('好友：加好友、通知、互为好友、删除、不能加自己', async () => {
  const aId = t.createUser('好友甲');
  const bId = t.createUser('好友乙');
  const a = await loginAs('好友甲');
  const b = await loginAs('好友乙');

  assert.equal((await t.client().api(`/api/friends/${bId}`)).status, 401);
  assert.equal((await a.api(`/api/friends/${aId}`)).json.ok, false);
  assert.equal((await a.api('/api/friends/999999')).status, 404);

  const add = await a.api(`/api/friends/${bId}`);
  assert.equal(add.json.ok, true);
  assert.equal(add.json.friend, true);
  assert.equal(add.json.label, '[已是好友]');
  const note = t.ctx.db.prepare('SELECT * FROM messages WHERE to_id = ? AND from_id IS NULL ORDER BY id DESC').get(bId);
  assert.match(note.title, /好友甲 加你为好友/);

  // 乙在「加了我」里看到甲，回加后互为好友
  assert.match((await b.get('/my/friends')).text, /好友甲/);
  await b.api(`/api/friends/${aId}`);
  assert.match((await a.get('/my/friends')).text, /互为好友/);
  assert.match((await t.client().get(`/u/${aId}?tab=friends`)).text, /好友乙/);

  const remove = await a.api(`/api/friends/${bId}`);
  assert.equal(remove.json.friend, false);
  assert.equal(remove.json.label, '[加好友]');

  await a.api(`/api/friends/${bId}`);
  const del = await a.post(`/my/friends/${bId}/delete`);
  assert.equal(del.status, 303);
  assert.equal(t.ctx.db.prepare('SELECT COUNT(*) AS n FROM friends WHERE user_id = ? AND friend_id = ?').get(aId, bId).n, 0);
});

test('短消息：发送、未读、已读、回复预填、越权、双方软删除、批量删除', async () => {
  const aId = t.createUser('信件甲');
  const bId = t.createUser('信件乙');
  t.createUser('信件丙');
  const a = await loginAs('信件甲');
  const b = await loginAs('信件乙');
  const c = await loginAs('信件丙');

  assert.match((await a.post('/pm/send', { to: '信件甲', title: 'x', body: 'y' })).text, /不能给自己/);
  assert.match((await a.post('/pm/send', { to: '不存在的人', title: 'x', body: 'y' })).text, /不存在/);
  assert.match((await a.post('/pm/send', { to: '信件乙', title: 'x', body: '' })).text, /不能为空/);

  const sent = await a.post('/pm/send', { to: '信件乙', title: '周末去西塘吗', body: '[b]一起去[/b]吧 <script>x</script>', back: '/u/1' });
  assert.match(sent.text, /发送成功/);
  assert.match(sent.text, /url=\/u\/1|\/u\/1/);
  const msg = t.ctx.db.prepare('SELECT * FROM messages WHERE from_id = ? AND to_id = ?').get(aId, bId);
  assert.ok(msg);

  const inbox = await b.get('/pm');
  assert.match(inbox.text, /未读/);
  assert.match(inbox.text, /周末去西塘吗/);
  assert.match((await b.get('/my')).text, /1 条未读短消息/);

  const outbox = await a.get('/pm/outbox');
  assert.match(outbox.text, /周末去西塘吗/);

  const view = await b.get(`/pm/${msg.id}`);
  assert.equal(view.status, 200);
  assert.match(view.text, /<b>一起去<\/b>/);
  assert.ok(!view.text.includes('<script>x</script>'));
  assert.ok(t.ctx.db.prepare('SELECT read_at FROM messages WHERE id = ?').get(msg.id).read_at);
  assert.match((await a.get(`/pm/${msg.id}`)).text, /对方已于/);

  assert.equal((await c.get(`/pm/${msg.id}`)).status, 404, '第三人不能看');
  assert.equal((await c.post(`/pm/${msg.id}/delete`)).status, 404, '第三人不能删');

  const reply = await b.get(`/pm/new?reply=${msg.id}`);
  assert.match(reply.text, /Re: 周末去西塘吗/);
  assert.match(reply.text, /\[quote=信件甲\]/);
  assert.ok(!(await c.get(`/pm/new?reply=${msg.id}`)).text.includes('Re: 周末去西塘吗'), '不能借回复偷看别人的信');

  await b.post(`/pm/${msg.id}/delete`);
  assert.equal((await b.get(`/pm/${msg.id}`)).status, 404);
  assert.equal((await a.get(`/pm/${msg.id}`)).status, 200, '收件人删除不影响发件人');
  await a.post(`/pm/${msg.id}/delete`);
  assert.equal(t.ctx.db.prepare('SELECT COUNT(*) AS n FROM messages WHERE id = ?').get(msg.id).n, 0, '双方都删后物理删除');

  await a.post('/pm/send', { to: '信件乙', title: '第一封', body: '1' });
  await a.post('/pm/send', { to: '信件乙', title: '第二封', body: '2' });
  const ids = t.ctx.db.prepare('SELECT id FROM messages WHERE from_id = ? AND to_id = ?').all(aId, bId).map((r) => r.id);
  assert.equal(ids.length, 2);
  const bulk = await b.post('/pm/delete', { box: 'inbox', ids });
  assert.equal(bulk.status, 303);
  assert.equal(t.ctx.db.prepare('SELECT COUNT(*) AS n FROM messages WHERE to_id = ? AND receiver_deleted = 0').get(bId).n, 0);
  // 丙用批量删除接口删不掉别人的信
  await a.post('/pm/send', { to: '信件乙', title: '第三封', body: '3' });
  const third = t.ctx.db.prepare("SELECT id FROM messages WHERE title = '第三封'").get().id;
  await c.post('/pm/delete', { box: 'inbox', ids: [third] });
  assert.equal(t.ctx.db.prepare('SELECT receiver_deleted FROM messages WHERE id = ?').get(third).receiver_deleted, 0);
});

test('我的收藏：取消收藏；我的笔记、我的帖子显示内容', async () => {
  const uid = t.createUser('收藏君');
  const c = await loginAs('收藏君');
  const channelId = t.ctx.db.prepare('SELECT id FROM channels LIMIT 1').get().id;
  await c.post('/notes', { title: '一篇测试笔记', channel_id: channelId, tags: '', content: '这是一篇用于测试收藏的笔记正文。' });
  const note = t.ctx.db.prepare("SELECT id FROM notes WHERE title = '一篇测试笔记'").get();
  await c.api(`/api/notes/${note.id}/favorite`);
  assert.match((await c.get('/my/favorites')).text, /一篇测试笔记/);
  assert.match((await c.get('/my/notes')).text, /一篇测试笔记/);
  const del = await c.post(`/my/favorites/${note.id}/delete`);
  assert.equal(del.status, 303);
  assert.equal(t.ctx.db.prepare('SELECT COUNT(*) AS n FROM favorites WHERE user_id = ?').get(uid).n, 0);
  // 重复取消不会反向加回收藏
  await c.post(`/my/favorites/${note.id}/delete`);
  assert.equal(t.ctx.db.prepare('SELECT COUNT(*) AS n FROM favorites WHERE user_id = ?').get(uid).n, 0);
  assert.equal(t.ctx.db.prepare('SELECT favorites FROM notes WHERE id = ?').get(note.id).favorites, 0);

  const board = t.ctx.db.prepare('SELECT id FROM forum_boards LIMIT 1').get().id;
  const { createThread } = await import('../src/services/forum.js');
  createThread(t.ctx, { boardId: board, user: t.ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(uid), title: '我的第一个主题', content: '大家好' });
  assert.match((await c.get('/my/posts')).text, /我的第一个主题/);
  assert.match((await c.get(`/u/${uid}?tab=posts`)).text, /我的第一个主题/);
});
