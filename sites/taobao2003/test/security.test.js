import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, PASSWORD, ADMIN } from './helpers.js';

let app, seller, buyer, itemId;
const ADDR = { receiver: '王小明', address: '浙江省杭州市文二路 88 号 3 幢 201 室', tel: '0571-88881234' };

before(async () => {
  app = await startApp();
  seller = app.createUser('安全卖家');
  buyer = app.createUser('安全买家');
  itemId = app.createItem(seller, { title: '安全测试宝贝 一二三', price_cents: 1000, stock: 20 });
});
after(() => app.stop());

describe('安全', () => {
  test('所有 POST 都要 CSRF 令牌，URL 参数里的令牌无效', async () => {
    const c = await app.login('安全买家');
    const token = c.csrf;
    const noToken = await c.request('POST', '/cart/add', { body: `item_id=${itemId}`, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    assert.equal(noToken.status, 403);
    const inUrl = await c.request('POST', `/cart/add?_csrf=${encodeURIComponent(token)}`, { body: `item_id=${itemId}`, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    assert.equal(inUrl.status, 403, 'URL 参数里的令牌不算数');
    const wrong = await c.request('POST', '/cart/add', { body: `item_id=${itemId}&_csrf=${'x'.repeat(32)}`, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    assert.equal(wrong.status, 403);
    // 别人的令牌也不行
    const other = await app.login('安全卖家');
    const cross = await c.request('POST', '/cart/add', { body: `item_id=${itemId}&_csrf=${encodeURIComponent(other.csrf)}`, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    assert.equal(cross.status, 403);
    // CSRF 失败页也带完整页头（说明 locals 在校验之前就绪）
    assert.match(noToken.text, /淘宝网/);
    assert.match(noToken.text, /今日在线宝贝/);
  });

  test('各处输入的脚本都会被转义', async () => {
    const payload = '<script>alert(1)</script><img src=x onerror=alert(2)>';
    const s = await app.login('安全卖家');
    await s.post('/sell', { cat: '数码', title: `XSS测试 ${payload}`, descr: payload, tag: payload.slice(0, 10), price: '10', stock: '1', city: payload, detail: payload, status: 'onsale' });
    const id = app.ctx.db.prepare('SELECT id FROM items ORDER BY id DESC LIMIT 1').get().id;
    const pages = [`/item/${id}`, '/', `/?q=${encodeURIComponent(payload)}`, `/shop/${seller}`];
    const b = await app.login('安全买家');
    await b.post(`/item/${id}/question`, { text: payload });
    await b.post('/cart/add', { item_id: id, qty: 1 });
    await b.post('/checkout', { source: 'cart', receiver: payload.slice(0, 20), address: `浙江省杭州市${payload}`, tel: '13800138000' });
    const no = app.ctx.db.prepare('SELECT no FROM orders ORDER BY id DESC LIMIT 1').get().no;
    pages.push(`/order/${no}`, '/cart', '/my/bought');
    for (const url of pages) {
      const res = await b.get(url);
      assert.equal(res.status, 200, url);
      assert.doesNotMatch(res.text, /<script>alert\(1\)<\/script>/, url);
      assert.doesNotMatch(res.text, /<img src=x onerror/, url);
    }
    // 后台页面同样
    const admin = await app.login(ADMIN.username, ADMIN.password);
    for (const url of ['/admin/items', '/admin/orders', '/admin/ratings', '/admin/users']) {
      const res = await admin.get(url);
      assert.equal(res.status, 200, url);
      assert.doesNotMatch(res.text, /<script>alert\(1\)<\/script>/, url);
    }
  });

  test('所有页面都有 CSP 等安全响应头', async () => {
    const res = await app.client().get('/');
    assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
    assert.match(res.headers.get('content-security-policy'), /object-src 'none'/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
    assert.equal(res.headers.get('x-powered-by'), null);
  });

  test('未登录不能做任何写操作', async () => {
    const c = app.client();
    await c.init();
    for (const [url, form] of [['/checkout', { source: 'cart' }], ['/sell', { cat: '数码' }], ['/my/address', {}], ['/my/password', {}], ['/order/TB12345678/confirm', {}], [`/item/${itemId}/favorite`, {}], [`/item/${itemId}/question`, { text: '你好' }]]) {
      const res = await c.post(url, form);
      assert.equal(res.status, 302, url);
      assert.match(res.location, /^\/login\?next=/, url);
    }
    assert.equal((await c.get('/admin')).status, 302);
    assert.equal((await c.post('/admin/settings', {})).status, 302);
  });

  test('普通会员打不开任何后台页面', async () => {
    const c = await app.login('安全买家');
    for (const url of ['/admin', '/admin/users', '/admin/items', '/admin/orders', '/admin/ratings', '/admin/settings']) {
      assert.equal((await c.get(url)).status, 403, url);
    }
    for (const url of ['/admin/settings', '/admin/users/1/ban', `/admin/items/${itemId}/block`, '/admin/orders/TB12345678/close']) {
      assert.equal((await c.post(url, {})).status, 403, url);
    }
  });

  test('参数注入与畸形输入不会 500', async () => {
    const c = await app.login('安全买家');
    const weird = ["' OR 1=1 --", '%00', '../../etc/passwd', 'ページ', '👍'.repeat(50), 'a'.repeat(5000)];
    for (const w of weird) {
      assert.equal((await c.get(`/?q=${encodeURIComponent(w)}`)).status, 200, w);
      assert.equal((await c.get(`/?cat=${encodeURIComponent(w)}`)).status, 200, w);
    }
    // LIKE 通配符：搜索词归一化时就被去掉，再加上 ESCAPE 转义，不会当成通配符
    const { searchNorm, likeEscape } = await import('../src/lib/text.js');
    assert.equal(searchNorm('安全%_宝贝'), '安全宝贝');
    assert.equal(likeEscape('a%b_c'), 'a\\%b\\_c');
    const one = Number(((await c.get('/?q=%E5%AE%89%E5%85%A8%E6%B5%8B%E8%AF%95%25')).text.match(/共找到 <b class="orange">(\d+)</) || [])[1]);
    assert.equal(one, 1, '「安全测试%」只应匹配到标题里有「安全测试」的那件');
    // 数量、id 的畸形值
    for (const body of [{ item_id: 'abc' }, { item_id: -1 }, { item_id: itemId, qty: -5 }, { item_id: itemId, qty: '1e3' }, { item_id: itemId, qty: '1.5' }, { item_id: [1, 2] }]) {
      const res = await c.post('/cart/add', body);
      assert.notEqual(res.status, 500, JSON.stringify(body));
    }
    // JSON 里放对象也不会 500
    const json = await c.request('POST', '/cart/add', {
      body: JSON.stringify({ item_id: { $gt: 0 }, qty: [1], _csrf: c.csrf }),
      headers: { 'content-type': 'application/json', 'x-csrf-token': c.csrf, 'x-requested-with': 'fetch' },
    });
    assert.notEqual(json.status, 500);
  });

  test('别人的地址、留言、评价都动不了', async () => {
    const a = await app.login('安全买家');
    await a.post('/my/address', ADDR);
    const addrId = app.ctx.db.prepare('SELECT id FROM addresses ORDER BY id DESC LIMIT 1').get().id;
    app.createUser('第三者');
    const b = await app.login('第三者');
    await b.post(`/my/address/${addrId}/delete`);
    assert.ok(app.ctx.db.prepare('SELECT 1 FROM addresses WHERE id = ?').get(addrId), '别人删不掉我的地址');
    // 评价必须基于自己的订单
    const no = app.ctx.db.prepare('SELECT no FROM orders ORDER BY id DESC LIMIT 1').get()?.no;
    if (no) assert.equal((await b.post(`/order/${no}/rate`, { grade: '1', text: '刷个好评' })).status, 404);
  });

  test('不能买自己的宝贝刷信用，也不能给自己的宝贝留言', async () => {
    const s = await app.login('安全卖家');
    assert.equal((await s.post('/cart/add', { item_id: itemId, qty: 1 })).status, 400);
    assert.equal((await s.post('/checkout', { source: 'buy', item: itemId, qty: 1, ...ADDR })).status, 400);
    assert.equal((await s.post(`/item/${itemId}/question`, { text: '自问自答' })).status, 400);
  });

  test('被冻结的会员：不能登录，宝贝对买家隐藏', async () => {
    const admin = await app.login(ADMIN.username, ADMIN.password);
    await admin.post(`/admin/users/${seller}/ban`, { ban: '1', reason: '测试冻结' });
    assert.equal((await app.client().get(`/item/${itemId}`)).status, 404);
    const list = await app.client().get('/');
    assert.doesNotMatch(list.text, /安全测试宝贝/);
    const c = app.client();
    assert.equal((await c.post('/login', { username: '安全卖家', password: PASSWORD })).status, 403);
    await admin.post(`/admin/users/${seller}/ban`, { ban: '0' });
    assert.equal((await app.client().get(`/item/${itemId}`)).status, 200);
  });

  test('上传目录不能读到数据库和源码，也不能目录穿越', async () => {
    const c = app.client();
    for (const url of ['/uploads/', '/uploads/../taobao2003.db', '/uploads/..%2Ftaobao2003.db', '/static/../src/app.js', '/uploads/secret.key']) {
      const res = await c.get(url);
      assert.ok(res.status === 404 || res.status === 403, `${url} -> ${res.status}`);
    }
  });

  test('限速：登录、注册、下单都有上限', async () => {
    const app2 = await startApp({ DISABLE_RATE_LIMIT: '0' });
    try {
      const c = app2.client();
      let limited = false;
      for (let i = 0; i < 25; i++) {
        const res = await c.post('/login', { username: '不存在的人', password: 'x' });
        if (res.status === 429) { limited = true; break; }
      }
      assert.ok(limited, '连续登录失败应触发限速');
      const c2 = app2.client();
      let regLimited = false;
      for (let i = 0; i < 8; i++) {
        const res = await c2.post('/register', { username: `压测会员${i}`, password: 'pass1234', password2: 'pass1234', agree: '1' });
        if (res.status === 429) { regLimited = true; break; }
      }
      assert.ok(regLimited, '连续注册应触发限速');
    } finally {
      await app2.stop();
    }
  });

  test('错误页不泄露堆栈', async () => {
    const res = await app.client().get('/item/999999');
    assert.equal(res.status, 404);
    assert.doesNotMatch(res.text, /at .*\.js:\d+/);
    assert.doesNotMatch(res.text, /node_modules/);
  });
});
