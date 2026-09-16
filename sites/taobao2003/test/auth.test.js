import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, Client, ADMIN, PASSWORD } from './helpers.js';

let app;
before(async () => { app = await startApp(); });
after(() => app.stop());

describe('注册与登录', () => {
  test('注册成功：送体验金、自动登录、记一条支付宝流水', async () => {
    const c = app.client();
    const res = await c.post('/register', { username: '小明', password: 'pass1234', password2: 'pass1234', city: '浙江 杭州', agree: '1' });
    assert.equal(res.status, 200);
    assert.match(res.text, /注册成功/);
    const u = app.ctx.db.prepare('SELECT * FROM users WHERE username = ?').get('小明');
    assert.equal(u.balance_cents, 100000);
    assert.equal(app.ctx.db.prepare('SELECT COUNT(*) AS n FROM alipay_logs WHERE user_id = ?').get(u.id).n, 1);
    const my = await c.get('/my');
    assert.equal(my.status, 200);
    assert.match(my.text, /小明/);
  });

  test('会员名不区分大小写、全角，保留字和重名都拒绝', async () => {
    const c = app.client();
    app.createUser('xiaoming');
    // 大小写不同
    assert.match((await c.post('/register', { username: 'XiaoMing', password: 'pass1234', password2: 'pass1234', agree: '1' })).text, /已被注册/);
    // 全角字母（NFKC 归一化后与已有会员相同）
    assert.match((await c.post('/register', { username: 'ｘｉａｏｍｉｎｇ', password: 'pass1234', password2: 'pass1234', agree: '1' })).text, /已被注册/);
    // 首尾空格
    assert.match((await c.post('/register', { username: '  xiaoming  ', password: 'pass1234', password2: 'pass1234', agree: '1' })).text, /已被注册/);
    const reserved = await c.post('/register', { username: '淘宝小二2', password: 'pass1234', password2: 'pass1234', agree: '1' });
    assert.match(reserved.text, /保留字/);
    const short = await c.post('/register', { username: 'ok_user', password: '123', password2: '123', agree: '1' });
    assert.match(short.text, /密码长度/);
    const noAgree = await c.post('/register', { username: 'ok_user', password: 'pass1234', password2: 'pass1234' });
    assert.match(noAgree.text, /服务协议/);
  });

  test('登录：密码错误、大小写不敏感、被冻结、next 跳转', async () => {
    app.createUser('buyer1');
    const c = app.client();
    const bad = await c.post('/login', { username: 'buyer1', password: 'wrong' });
    assert.equal(bad.status, 200);
    assert.match(bad.text, /会员名或密码错误/);
    assert.equal(c.jar.has('sid'), false);

    const ok = await c.post('/login', { username: 'BUYER1', password: PASSWORD, next: '/my/bought' });
    assert.equal(ok.location, '/my/bought');
    assert.ok(c.jar.has('sid'));

    const id = app.ctx.db.prepare('SELECT id FROM users WHERE username = ?').get('buyer1').id;
    app.ctx.db.prepare("UPDATE users SET banned = 1, ban_reason = '违规' WHERE id = ?").run(id);
    const c2 = app.client();
    const banned = await c2.post('/login', { username: 'buyer1', password: PASSWORD });
    assert.equal(banned.status, 403);
    assert.match(banned.text, /冻结/);
    // 已登录的会话也立即失效
    assert.equal((await c.get('/my')).status, 302);
    app.ctx.db.prepare('UPDATE users SET banned = 0 WHERE id = ?').run(id);
  });

  test('next 只接受站内相对地址', async () => {
    app.createUser('buyer2');
    for (const [next, want] of [['//evil.com', '/'], ['/\\evil.com', '/'], ['https://evil.com', '/'], ['/cart', '/cart'], ['%2F%5Cevil.com', '/']]) {
      const c = app.client();
      const res = await c.post('/login', { username: 'buyer2', password: PASSWORD, next });
      assert.equal(res.location, want, `next=${next}`);
    }
  });

  test('未登录访问受保护页面跳登录并带回原地址；POST 回到来源页', async () => {
    const c = app.client();
    const res = await c.get('/my/bought?status=paid');
    assert.equal(res.status, 302);
    assert.equal(res.location, `/login?next=${encodeURIComponent('/my/bought?status=paid')}`);
    const post = await c.post('/item/1/question', { text: '在吗' }, { headers: { referer: `${app.base}/item/1` } });
    assert.equal(post.location, `/login?next=${encodeURIComponent('/item/1')}`);
    const noref = await c.post('/item/1/question', { text: '在吗' });
    assert.equal(noref.location, '/login?next=%2F');
  });

  test('退出后会话失效；改密码会踢掉其它设备', async () => {
    app.createUser('buyer3');
    const c1 = await app.login('buyer3');
    const c2 = await app.login('buyer3');
    await c1.logout();
    assert.equal((await c1.get('/my')).status, 302);
    assert.equal((await c2.get('/my')).status, 200);

    const c3 = await app.login('buyer3');
    const pw = await c3.post('/my/password', { old: PASSWORD, password: 'newpass123', password2: 'newpass123' });
    assert.match(pw.text, /密码已修改/);
    assert.equal((await c2.get('/my')).status, 302, '其它设备应被下线');
    assert.equal((await c3.get('/my')).status, 200, '当前设备保持登录');
    const again = await app.login('buyer3', 'newpass123');
    assert.ok(again.jar.has('sid'));
  });

  test('会话 cookie 有 HttpOnly 和 SameSite', async () => {
    app.createUser('buyer4');
    const c = app.client();
    const res = await c.post('/login', { username: 'buyer4', password: PASSWORD });
    const cookie = res.headers.getSetCookie().find((x) => x.startsWith('sid='));
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /Path=\//);
  });

  test('站长账号自动创建并能进后台，普通会员不能', async () => {
    const admin = await app.login(ADMIN.username, ADMIN.password);
    assert.equal((await admin.get('/admin')).status, 200);
    app.createUser('buyer5');
    const c = await app.login('buyer5');
    const res = await c.get('/admin');
    assert.equal(res.status, 403);
    assert.match(res.text, /没有权限/);
  });

  test('关闭注册后不能注册', async () => {
    app.ctx.settings.set('register_open', '0');
    const c = app.client();
    const res = await c.post('/register', { username: '新会员', password: 'pass1234', password2: 'pass1234', agree: '1' });
    assert.match(res.text, /暂停新会员注册/);
    app.ctx.settings.set('register_open', '1');
  });
});
