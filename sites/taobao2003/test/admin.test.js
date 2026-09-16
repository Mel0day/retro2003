import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, ADMIN, PASSWORD } from './helpers.js';

let app, admin, seller, buyer, itemId;
const ADDR = { receiver: '王小明', address: '浙江省杭州市文二路 88 号 3 幢 201 室', tel: '0571-88881234' };
const balance = (id) => app.ctx.db.prepare('SELECT balance_cents FROM users WHERE id = ?').get(id).balance_cents;

before(async () => {
  app = await startApp();
  admin = await app.login(ADMIN.username, ADMIN.password);
  seller = app.createUser('后台卖家');
  buyer = app.createUser('后台买家');
  itemId = app.createItem(seller, { title: '后台测试宝贝 一二三', price_cents: 5000, stock: 10 });
});
after(() => app.stop());

const placeOrder = async () => {
  const c = await app.login('后台买家');
  await c.post('/cart/add', { item_id: itemId, qty: 1 });
  await c.post('/checkout', { source: 'cart', ...ADDR });
  return { c, no: app.ctx.db.prepare('SELECT no FROM orders ORDER BY id DESC LIMIT 1').get().no };
};

describe('淘宝小二后台', () => {
  test('后台页面都能打开，统计数字正确', async () => {
    await placeOrder();
    for (const url of ['/admin', '/admin/users', '/admin/items', '/admin/orders', '/admin/ratings', '/admin/settings']) {
      const res = await admin.get(url);
      assert.equal(res.status, 200, url);
      assert.doesNotMatch(res.text, /undefined|NaN|\[object Object\]/, url);
    }
    const home = await admin.get('/admin');
    assert.match(home.text, /担保中资金/);
    assert.match(home.text, /￥50\.00/, '担保中的钱等于订单金额');
  });

  test('强制下架：买家看不到，卖家能看到原因，之后可以恢复', async () => {
    await admin.post(`/admin/items/${itemId}/block`, { block: '1', reason: '疑似违规商品' });
    assert.equal((await app.client().get(`/item/${itemId}`)).status, 404);
    const s = await app.login('后台卖家');
    const page = await s.get('/my/items?tab=warehouse');
    assert.match(page.text, /疑似违规商品/);
    const cannot = await s.post(`/my/items/${itemId}/onsale`);
    assert.equal(cannot.status, 400, '卖家不能自己恢复被小二下架的宝贝');
    await admin.post(`/admin/items/${itemId}/block`, { block: '0' });
    assert.equal((await app.client().get(`/item/${itemId}`)).status, 200);
  });

  test('强制下架必须填原因', async () => {
    const res = await admin.post(`/admin/items/${itemId}/block`, { block: '1', reason: '' });
    assert.equal(res.status, 400);
    assert.match(res.text, /请填写原因/);
  });

  test('纠纷处理：关闭未完成交易并退款退库存；已完成的不能关闭', async () => {
    const { no } = await placeOrder();
    const before = balance(buyer);
    const stockBefore = app.ctx.db.prepare('SELECT stock FROM items WHERE id = ?').get(itemId).stock;
    const res = await admin.post(`/admin/orders/${no}/close`, { reason: '买卖双方协商一致' });
    assert.match(res.text, /已关闭交易/);
    assert.equal(balance(buyer) - before, 5000);
    assert.equal(app.ctx.db.prepare('SELECT stock FROM items WHERE id = ?').get(itemId).stock, stockBefore + 1);
    const o = app.ctx.db.prepare('SELECT * FROM orders WHERE no = ?').get(no);
    assert.equal(o.status, 'closed');
    assert.equal(o.closed_by, 'admin');
    // 交易成功的订单不能再关闭
    const { c, no: no2 } = await placeOrder();
    const s = await app.login('后台卖家');
    await s.post(`/order/${no2}/ship`, { company: 'EMS' });
    await c.post(`/order/${no2}/confirm`);
    const nope = await admin.post(`/admin/orders/${no2}/close`, { reason: '试试' });
    assert.equal(nope.status, 409);
    // 已发货的可以关闭（退款给买家）
    const { no: no3 } = await placeOrder();
    await s.post(`/order/${no3}/ship`, { company: 'EMS' });
    const ok = await admin.post(`/admin/orders/${no3}/close`, { reason: '买家收到空包裹' });
    assert.match(ok.text, /已关闭交易/);
  });

  test('屏蔽评价只隐藏内容，不改信用积分', async () => {
    const { c, no } = await placeOrder();
    const s = await app.login('后台卖家');
    await s.post(`/order/${no}/ship`, { company: 'EMS' });
    await c.post(`/order/${no}/confirm`);
    await c.post(`/order/${no}/rate`, { grade: '-1', text: '这里是一句违规的辱骂内容' });
    const rid = app.ctx.db.prepare('SELECT id FROM ratings ORDER BY id DESC LIMIT 1').get().id;
    await admin.post(`/admin/ratings/${rid}/hide`, { hide: '1' });
    const shop = await app.client().get(`/shop/${seller}?tab=rates`);
    assert.doesNotMatch(shop.text, /违规的辱骂内容/);
    assert.match(shop.text, /内容已被屏蔽/);
    const { creditOf } = await import('../src/services/credit.js');
    assert.equal(creditOf(app.ctx.db, seller, 'seller').bad, 1, '信用积分不受屏蔽影响');
  });

  test('屏蔽留言', async () => {
    const c = await app.login('后台买家');
    await c.post(`/item/${itemId}/question`, { text: '这是一条要被屏蔽的留言' });
    const qid = app.ctx.db.prepare('SELECT id FROM questions ORDER BY id DESC LIMIT 1').get().id;
    await admin.post(`/admin/questions/${qid}/hide`, { hide: '1' });
    assert.doesNotMatch((await app.client().get(`/item/${itemId}`)).text, /要被屏蔽的留言/);
  });

  test('冻结与解冻会员，不能冻结小二', async () => {
    await admin.post(`/admin/users/${buyer}/ban`, { ban: '1', reason: '恶意下单' });
    assert.equal(app.ctx.db.prepare('SELECT banned FROM users WHERE id = ?').get(buyer).banned, 1);
    const c = app.client();
    assert.equal((await c.post('/login', { username: '后台买家', password: PASSWORD })).status, 403);
    await admin.post(`/admin/users/${buyer}/ban`, { ban: '0' });
    assert.equal(app.ctx.db.prepare('SELECT banned FROM users WHERE id = ?').get(buyer).banned, 0);
    const adminId = app.ctx.db.prepare('SELECT id FROM users WHERE role = ?').get('admin').id;
    const res = await admin.post(`/admin/users/${adminId}/ban`, { ban: '1', reason: '试试' });
    assert.equal(res.status, 400);
  });

  test('站点设置：公告、热门词、广告位链接校验', async () => {
    const res = await admin.post('/admin/settings', {
      announcement: '☆ 新公告：全场包邮 ☆', ad_text: '广告位\n招租', ad_url: '/?cat=数码', hot_words: 'MP3 台灯',
      counter_base: '123456', register_open: '1', service_email: 'help@example.com', icp: '浙ICP证030001号',
    });
    assert.equal(res.status, 302);
    const home = await app.client().get('/');
    assert.match(home.text, /新公告：全场包邮/);
    assert.match(home.text, /help@example.com/);
    assert.match(home.text, /广告位/);
    const bad = await admin.post('/admin/settings', { ...Object.fromEntries(Object.entries(app.ctx.settings.all())), ad_url: 'javascript:alert(1)' });
    assert.match(bad.text, /只能填/);
    assert.notEqual(app.ctx.settings.get('ad_url'), 'javascript:alert(1)');
  });

  test('后台搜索会员、宝贝、订单', async () => {
    assert.match((await admin.get('/admin/users?q=%E5%90%8E%E5%8F%B0')).text, /后台卖家/);
    assert.match((await admin.get('/admin/items?q=%E5%90%8E%E5%8F%B0')).text, /后台测试宝贝/);
    assert.match((await admin.get('/admin/items?filter=onsale')).text, /后台测试宝贝/);
    const no = app.ctx.db.prepare('SELECT no FROM orders ORDER BY id DESC LIMIT 1').get().no;
    assert.match((await admin.get(`/admin/orders?q=${no}`)).text, new RegExp(no));
    assert.match((await admin.get('/admin/orders?status=closed')).text, /交易关闭/);
  });

  test('小二可以查看任意订单，但不能替买卖双方操作', async () => {
    const { no } = await placeOrder();
    const page = await admin.get(`/order/${no}`);
    assert.equal(page.status, 200);
    assert.match(page.text, /淘宝小二查看中/);
    assert.equal((await admin.post(`/order/${no}/confirm`)).status, 404);
    assert.equal((await admin.post(`/order/${no}/ship`, { company: 'EMS' })).status, 404);
  });
});
