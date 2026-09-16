// 骨架自带的基础测试。按你的功能继续加：每个功能点的主路径 + 关键错误路径（未登录、越权、非法输入）。
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, ADMIN, PASSWORD } from './helpers.js';

let app, author;
before(async () => {
  app = await startApp();
  author = app.createUser('作者甲');
  app.createEntry(author, { title: '第一条演示内容', body: '这是一条用于测试的内容。', channel: '分享' });
});
after(() => app.stop());

describe('基础功能', () => {
  test('首页列出内容，搜索能命中', async () => {
    const res = await app.client().get('/');
    assert.equal(res.status, 200);
    assert.match(res.text, /第一条演示内容/);
    assert.match((await app.client().get('/?q=%E6%BC%94%E7%A4%BA')).text, /第一条演示内容/);
    assert.match((await app.client().get('/?q=%E6%89%BE%E4%B8%8D%E5%88%B0%E7%9A%84%E8%AF%8D')).text, /还没有内容/);
  });

  test('详情页可访问，浏览数增加', async () => {
    const res = await app.client().get('/entry/1');
    assert.equal(res.status, 200);
    assert.ok(app.ctx.db.prepare('SELECT views FROM entries WHERE id = 1').get().views >= 1);
    assert.equal((await app.client().get('/entry/9999')).status, 404);
  });

  test('注册、发布、留言的完整链路', async () => {
    const c = app.client();
    await c.post('/register', { username: '新会员', password: 'pass1234', password2: 'pass1234', agree: '1' });
    const pub = await c.post('/publish', { channel: '闲聊', title: '我发的第一条内容', body: '正文至少要十个字才能发布成功。' });
    assert.match(pub.text, /发布成功/);
    const id = app.ctx.db.prepare('SELECT id FROM entries ORDER BY id DESC LIMIT 1').get().id;
    await c.post(`/entry/${id}/comment`, { body: '自己给自己留个言' });
    assert.match((await c.get(`/entry/${id}`)).text, /自己给自己留个言/);
  });

  test('未登录不能发布和留言，会被带回登录页', async () => {
    const c = app.client();
    await c.init();
    const res = await c.post('/publish', { channel: '闲聊', title: '未登录发布', body: '这条不应该发出去。' });
    assert.equal(res.status, 302);
    assert.match(res.location, /^\/login\?next=/);
    assert.equal((await c.post('/entry/1/comment', { body: '未登录留言' })).status, 302);
  });

  test('CSRF、越权与安全响应头', async () => {
    const c = await app.login('作者甲');
    const noToken = await c.request('POST', '/publish', { body: 'title=x', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    assert.equal(noToken.status, 403);
    const other = app.createUser('路人乙');
    const o = await app.login('路人乙');
    assert.equal((await o.post('/entry/1/delete')).status, 404, '别人删不掉我的内容');
    assert.ok(other > 0);
    const head = await app.client().get('/');
    assert.match(head.headers.get('content-security-policy'), /script-src 'self'/);
    assert.equal(head.headers.get('x-content-type-options'), 'nosniff');
  });

  test('XSS：脚本会被转义', async () => {
    const c = await app.login('作者甲');
    await c.post('/publish', { channel: '闲聊', title: 'XSS 测试 <script>alert(1)</script>', body: '<img src=x onerror=alert(2)> 正文十个字以上。' });
    const list = await app.client().get('/');
    assert.doesNotMatch(list.text, /<script>alert\(1\)<\/script>/);
    const id = app.ctx.db.prepare('SELECT id FROM entries ORDER BY id DESC LIMIT 1').get().id;
    assert.doesNotMatch((await app.client().get(`/entry/${id}`)).text, /<img src=x onerror/);
  });

  test('后台：站长能进，普通会员不能', async () => {
    const admin = await app.login(ADMIN.username, ADMIN.password);
    for (const url of ['/admin', '/admin/users', '/admin/entries', '/admin/settings']) {
      assert.equal((await admin.get(url)).status, 200, url);
    }
    const c = await app.login('作者甲', PASSWORD);
    assert.equal((await c.get('/admin')).status, 403);
  });

  test('后台封禁会员后对方不能登录', async () => {
    const admin = await app.login(ADMIN.username, ADMIN.password);
    const id = app.createUser('待封禁');
    await admin.post(`/admin/users/${id}/ban`, { ban: '1', reason: '测试' });
    const c = app.client();
    assert.equal((await c.post('/login', { username: '待封禁', password: PASSWORD })).status, 403);
  });
});
