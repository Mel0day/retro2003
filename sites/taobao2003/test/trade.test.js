import test, { after, before, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, num } from './helpers.js';
import { creditOf } from '../src/services/credit.js';

let app, s1, s2, buyer;
const ADDR = { receiver: '王小明', address: '浙江省杭州市文二路 88 号 3 幢 201 室', tel: '0571-88881234' };
const balance = (id) => app.ctx.db.prepare('SELECT balance_cents FROM users WHERE id = ?').get(id).balance_cents;
const item = (id) => app.ctx.db.prepare('SELECT * FROM items WHERE id = ?').get(id);
const lastNo = () => app.ctx.db.prepare('SELECT no FROM orders ORDER BY id DESC LIMIT 1').get().no;

before(async () => { app = await startApp(); });
after(() => app.stop());

beforeEach(() => {
  app.ctx.db.exec('DELETE FROM ratings; DELETE FROM order_logs; DELETE FROM order_items; DELETE FROM orders; DELETE FROM carts; DELETE FROM alipay_logs; DELETE FROM items; DELETE FROM users WHERE role <> \'admin\'');
  s1 = app.createUser('卖家一');
  s2 = app.createUser('卖家二');
  buyer = app.createUser('买家');
  app.createItem(s1, { title: '爱国者 MP3 播放器', price_cents: 39900, stock: 5 });   // 1
  app.createItem(s1, { title: '不锈钢保温杯 500ml', price_cents: 990, stock: 10 });    // 2（9.9 元，验证角分）
  app.createItem(s2, { title: '哈利波特与凤凰社', price_cents: 4500, stock: 2 });      // 3
});

describe('购物车', () => {
  test('游客可以加购物车，登录后合并到账号（不超过库存）', async () => {
    const g = app.client();
    await g.post('/cart/add', { item_id: 1, qty: 2 });
    assert.match((await g.get('/cart')).text, /爱国者 MP3/);
    const c = await app.login('买家');
    await c.post('/cart/add', { item_id: 1, qty: 1 });
    // 用游客的 cookie 登录：购物车合并
    await g.post('/login', { username: '买家', password: 'pass1234' });
    const rows = app.ctx.db.prepare('SELECT * FROM carts WHERE owner_key = ?').all(`u:${buyer}`);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].qty, 3);
    assert.equal(app.ctx.db.prepare('SELECT COUNT(*) AS n FROM carts').get().n, 1, '游客购物车已清空');
  });

  test('加购物车受库存限制，自己的宝贝不能买', async () => {
    const c = await app.login('买家');
    const many = await c.post('/cart/add', { item_id: 1, qty: 99 });
    assert.equal(many.status, 302);
    assert.equal(app.ctx.db.prepare('SELECT qty FROM carts WHERE owner_key = ?').get(`u:${buyer}`).qty, 5, '最多加到库存数');
    const again = await c.post('/cart/add', { item_id: 1, qty: 1 });
    assert.equal(again.status, 400);
    assert.match(again.text, /库存/);

    const seller = await app.login('卖家一');
    const own = await seller.post('/cart/add', { item_id: 1, qty: 1 });
    assert.equal(own.status, 400);
    assert.match(own.text, /自己发布的宝贝/);
  });

  test('数量加减与删除；减到 1 件为止', async () => {
    const c = await app.login('买家');
    await c.post('/cart/add', { item_id: 2, qty: 1 });
    await c.post('/cart/update', { item_id: 2, op: 'plus' });
    assert.equal(app.ctx.db.prepare('SELECT qty FROM carts WHERE item_id = 2').get().qty, 2);
    await c.post('/cart/update', { item_id: 2, op: 'minus' });
    await c.post('/cart/update', { item_id: 2, op: 'minus' });
    assert.equal(app.ctx.db.prepare('SELECT qty FROM carts WHERE item_id = 2').get().qty, 1, '减到 1 不再减');
    await c.post('/cart/update', { item_id: 2, op: 'set', qty: 99 });
    assert.equal(app.ctx.db.prepare('SELECT qty FROM carts WHERE item_id = 2').get().qty, 10, '不超过库存');
    await c.post('/cart/remove', { item_id: 2 });
    assert.equal(app.ctx.db.prepare('SELECT COUNT(*) AS n FROM carts').get().n, 0);
  });

  test('两个会员的购物车互不影响', async () => {
    const a = await app.login('买家');
    const b = await app.login('卖家二');
    await a.post('/cart/add', { item_id: 1, qty: 1 });
    await b.post('/cart/add', { item_id: 2, qty: 3 });
    assert.match((await a.get('/cart')).text, /爱国者/);
    assert.doesNotMatch((await a.get('/cart')).text, /保温杯/);
    assert.match((await b.get('/cart')).text, /保温杯/);
  });
});

describe('结算下单', () => {
  test('按卖家拆单、扣支付宝余额、扣库存、清购物车、存地址', async () => {
    const c = await app.login('买家');
    await c.post('/cart/add', { item_id: 1, qty: 1 });
    await c.post('/cart/add', { item_id: 3, qty: 2 });
    const before = balance(buyer);
    const res = await c.post('/checkout', { source: 'cart', ...ADDR, [`ship_${s1}`]: 'post', [`ship_${s2}`]: 'ems' });
    assert.equal(res.status, 302);
    const orders = app.ctx.db.prepare('SELECT * FROM orders ORDER BY id').all();
    assert.equal(orders.length, 2, '两个卖家拆成两张订单');
    assert.equal(orders[0].total_cents, 39900);
    assert.equal(orders[1].total_cents, 4500 * 2 + 2000, 'EMS 运费 20 元');
    assert.equal(before - balance(buyer), 39900 + 4500 * 2 + 2000);
    assert.equal(item(1).stock, 4);
    assert.equal(item(1).sold, 1);
    assert.equal(item(3).stock, 0);
    assert.equal(app.ctx.db.prepare('SELECT COUNT(*) AS n FROM carts').get().n, 0, '购物车已清空');
    assert.equal(app.ctx.db.prepare('SELECT COUNT(*) AS n FROM addresses WHERE user_id = ?').get(buyer).n, 1);
    // 成功页
    const success = await c.get(res.location);
    assert.equal(success.status, 200);
    assert.match(success.text, /付款成功/);
  });

  test('金额按分计算，角分不丢精度', async () => {
    const c = await app.login('买家');
    await c.post('/cart/add', { item_id: 2, qty: 3 });
    await c.post('/checkout', { source: 'cart', ...ADDR, [`ship_${s1}`]: 'ems' });
    const o = app.ctx.db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 1').get();
    assert.equal(o.goods_cents, 2970);
    assert.equal(o.total_cents, 4970);
    const page = await c.get(`/order/${o.no}`);
    assert.match(page.text, /￥29\.70/);
    assert.match(page.text, /￥49\.70/);
  });

  test('「立刻购买」不经过购物车', async () => {
    const c = await app.login('买家');
    await c.post('/cart/add', { item_id: 1, qty: 5 });
    const res = await c.post('/checkout', { source: 'buy', item: 3, qty: 1, ...ADDR, [`ship_${s2}`]: 'post' });
    assert.equal(res.status, 302);
    assert.equal(app.ctx.db.prepare('SELECT COUNT(*) AS n FROM orders').get().n, 1);
    assert.equal(app.ctx.db.prepare('SELECT qty FROM carts WHERE item_id = 1').get().qty, 5, '购物车原样保留');
  });

  test('地址不完整、电话格式错、余额不足、库存不足都会拦住', async () => {
    const c = await app.login('买家');
    await c.post('/cart/add', { item_id: 1, qty: 1 });
    assert.match((await c.post('/checkout', { source: 'cart', receiver: '王', address: ADDR.address, tel: ADDR.tel })).text, /收货人/);
    assert.match((await c.post('/checkout', { source: 'cart', ...ADDR, address: '杭州' })).text, /详细的收货地址/);
    assert.match((await c.post('/checkout', { source: 'cart', ...ADDR, tel: 'abc' })).text, /电话/);
    assert.equal(app.ctx.db.prepare('SELECT COUNT(*) AS n FROM orders').get().n, 0);

    app.ctx.db.prepare('UPDATE users SET balance_cents = 100 WHERE id = ?').run(buyer);
    assert.match((await c.post('/checkout', { source: 'cart', ...ADDR })).text, /余额不足/);
    app.ctx.db.prepare('UPDATE users SET balance_cents = 100000 WHERE id = ?').run(buyer);

    app.ctx.db.prepare('UPDATE items SET stock = 0 WHERE id = 1').run();
    assert.match((await c.post('/checkout', { source: 'cart', ...ADDR })).text, /已卖完/);
    assert.equal(app.ctx.db.prepare('SELECT COUNT(*) AS n FROM orders').get().n, 0);
  });

  test('结算页显示的总额和提交的不一致时拒绝（卖家改价）', async () => {
    const c = await app.login('买家');
    await c.post('/cart/add', { item_id: 1, qty: 1 });
    const res = await c.post('/checkout', { source: 'cart', ...ADDR, expect_cents: 100 });
    assert.match(res.text, /价格或数量刚刚发生了变化/);
    assert.equal(app.ctx.db.prepare('SELECT COUNT(*) AS n FROM orders').get().n, 0);
  });

  test('下架、卖完、自己的宝贝在购物车里会被跳过', async () => {
    const c = await app.login('买家');
    await c.post('/cart/add', { item_id: 1, qty: 1 });
    await c.post('/cart/add', { item_id: 3, qty: 1 });
    app.ctx.db.prepare("UPDATE items SET status = 'warehouse' WHERE id = 1").run();
    const page = await c.get('/checkout');
    assert.match(page.text, /不能购买/);
    await c.post('/checkout', { source: 'cart', ...ADDR });
    const orders = app.ctx.db.prepare('SELECT * FROM orders').all();
    assert.equal(orders.length, 1, '只给还能买的宝贝下单');
    assert.equal(orders[0].seller_id, s2);
    assert.equal(app.ctx.db.prepare('SELECT COUNT(*) AS n FROM carts').get().n, 1, '不能买的还留在购物车里');
  });

  test('两个人抢最后一件，只有一个能下单，库存不会为负', async () => {
    app.ctx.db.prepare('UPDATE items SET stock = 1 WHERE id = 3').run();
    const buyers = [];
    for (let i = 0; i < 6; i++) {
      app.createUser(`抢购${i}`);
      const c = await app.login(`抢购${i}`);
      await c.post('/cart/add', { item_id: 3, qty: 1 });
      buyers.push(c);
    }
    const results = await Promise.all(buyers.map((c) => c.post('/checkout', { source: 'cart', ...ADDR })));
    const ok = results.filter((r) => r.status === 302);
    assert.equal(ok.length, 1, '只有一个人买到');
    assert.equal(item(3).stock, 0);
    assert.equal(item(3).sold, 1);
    assert.equal(app.ctx.db.prepare('SELECT COUNT(*) AS n FROM orders').get().n, 1);
    for (const r of results.filter((x) => x.status !== 302)) assert.match(r.text, /库存|卖完|被别人买走/);
  });
});

describe('交易流程与评价', () => {
  const placeOrder = async () => {
    const c = await app.login('买家');
    await c.post('/cart/add', { item_id: 1, qty: 1 });
    await c.post('/checkout', { source: 'cart', ...ADDR });
    return { c, no: lastNo() };
  };

  test('完整流程：付款 → 发货 → 确认收货 → 双方互评，钱和信用都对', async () => {
    const { c, no } = await placeOrder();
    const sellerBefore = balance(s1);
    const seller = await app.login('卖家一');

    const bad = await c.post(`/order/${no}/confirm`);
    assert.equal(bad.status, 409, '还没发货不能确认收货');

    const ship = await seller.post(`/order/${no}/ship`, { company: '申通快递', tracking_no: 'ST12345678' });
    assert.match(ship.text, /已发货/);
    assert.equal(balance(s1), sellerBefore, '发货时卖家还拿不到钱');

    const confirm = await c.post(`/order/${no}/confirm`);
    assert.match(confirm.text, /交易成功/);
    assert.equal(balance(s1) - sellerBefore, 39900, '确认收货后货款到账');

    await c.post(`/order/${no}/rate`, { grade: '1', text: '东西不错，发货快' });
    await seller.post(`/order/${no}/rate`, { grade: '1', text: '好买家' });
    assert.equal(creditOf(app.ctx.db, s1, 'seller').score, 1);
    assert.equal(creditOf(app.ctx.db, buyer, 'buyer').score, 1);
    const detail = await c.get(`/order/${no}`);
    assert.match(detail.text, /东西不错，发货快/);
    assert.match(detail.text, /好买家/);

    const dup = await c.post(`/order/${no}/rate`, { grade: '1', text: '再评一次' });
    assert.equal(dup.status, 409);
  });

  test('买家取消未发货的订单：退款并退回库存', async () => {
    const { c, no } = await placeOrder();
    const before = balance(buyer);
    const res = await c.post(`/order/${no}/cancel`, { reason: '我不想买了' });
    assert.match(res.text, /交易已取消/);
    assert.equal(balance(buyer) - before, 39900);
    assert.equal(item(1).stock, 5);
    assert.equal(item(1).sold, 0);
    const again = await c.post(`/order/${no}/cancel`, { reason: '我不想买了' });
    assert.equal(again.status, 409);
  });

  test('发货后买家不能取消，卖家也不能关闭', async () => {
    const { c, no } = await placeOrder();
    const seller = await app.login('卖家一');
    await seller.post(`/order/${no}/ship`, { company: 'EMS' });
    assert.equal((await c.post(`/order/${no}/cancel`, { reason: '我不想买了' })).status, 409);
    assert.equal((await seller.post(`/order/${no}/close`, { reason: '宝贝缺货' })).status, 409);
  });

  test('卖家缺货关闭交易：退款退库存', async () => {
    const { no } = await placeOrder();
    const seller = await app.login('卖家一');
    const before = balance(buyer);
    const res = await seller.post(`/order/${no}/close`, { reason: '宝贝缺货' });
    assert.match(res.text, /交易已关闭/);
    assert.equal(balance(buyer) - before, 39900);
    assert.equal(item(1).stock, 5);
  });

  test('只有交易成功才能评价；中评差评必须写原因', async () => {
    const { c, no } = await placeOrder();
    assert.equal((await c.post(`/order/${no}/rate`, { grade: '1', text: '好' })).status, 400);
    const seller = await app.login('卖家一');
    await seller.post(`/order/${no}/ship`, { company: 'EMS' });
    await c.post(`/order/${no}/confirm`);
    assert.match((await c.post(`/order/${no}/rate`, { grade: '-1', text: '差' })).text, /写明原因/);
    const ok = await c.post(`/order/${no}/rate`, { grade: '-1', text: '收到的东西和描述不符' });
    assert.match(ok.text, /评价成功/);
    assert.equal(creditOf(app.ctx.db, s1, 'seller').score, 0, '差评扣 1 分，不会是负数显示');
    assert.equal(creditOf(app.ctx.db, s1, 'seller').rawScore, -1);
    // 被评价方可以解释一次
    const reply = await seller.post(`/order/${no}/reply`, { text: '已经协商退款，是快递损坏' });
    assert.match(reply.text, /解释已发布/);
    assert.equal((await seller.post(`/order/${no}/reply`, { text: '再解释一次' })).status, 409);
  });

  test('同一买家 30 天内重复评价同一卖家只计一次分', async () => {
    for (let i = 0; i < 2; i++) {
      const { c, no } = await placeOrder();
      const seller = await app.login('卖家一');
      await seller.post(`/order/${no}/ship`, { company: 'EMS' });
      await c.post(`/order/${no}/confirm`);
      await c.post(`/order/${no}/rate`, { grade: '1', text: `第 ${i + 1} 次好评` });
    }
    const cr = creditOf(app.ctx.db, s1, 'seller');
    assert.equal(cr.score, 1, '30 天内只计一次');
    assert.equal(app.ctx.db.prepare('SELECT COUNT(*) AS n FROM ratings').get().n, 2, '两条评价都保留');
  });

  test('系统在超时后自动确认收货', async () => {
    const { no } = await placeOrder();
    const seller = await app.login('卖家一');
    await seller.post(`/order/${no}/ship`, { company: 'EMS' });
    app.ctx.db.prepare('UPDATE orders SET auto_confirm_at = 1 WHERE no = ?').run(no);
    const { autoConfirm } = await import('../src/services/orders.js');
    const before = balance(s1);
    assert.equal(autoConfirm(app.ctx), 1);
    const o = app.ctx.db.prepare('SELECT * FROM orders WHERE no = ?').get(no);
    assert.equal(o.status, 'done');
    assert.equal(balance(s1) - before, 39900);
    assert.match(app.ctx.db.prepare('SELECT text FROM order_logs WHERE order_id = ? ORDER BY id DESC LIMIT 1').get(o.id).text, /系统自动确认/);
  });

  test('订单只有买卖双方能看，别人一律 404', async () => {
    const { no } = await placeOrder();
    app.createUser('路人');
    const other = await app.login('路人');
    assert.equal((await other.get(`/order/${no}`)).status, 404);
    assert.equal((await other.post(`/order/${no}/confirm`)).status, 404);
    assert.equal((await other.post(`/order/${no}/cancel`, { reason: '我不想买了' })).status, 404);
    assert.equal((await other.post(`/order/${no}/ship`, { company: 'EMS' })).status, 404);
    // 不存在的订单号也是 404，不泄露是否存在
    assert.equal((await other.get('/order/TB99999999')).status, 404);
    const seller = await app.login('卖家一');
    assert.equal((await seller.post(`/order/${no}/confirm`)).status, 404, '卖家不能替买家确认收货');
    const c = await app.login('买家');
    assert.equal((await c.post(`/order/${no}/ship`, { company: 'EMS' })).status, 404, '买家不能发货');
  });

  test('支付宝账户明细记录每一笔进出', async () => {
    const { c, no } = await placeOrder();
    const seller = await app.login('卖家一');
    await seller.post(`/order/${no}/ship`, { company: 'EMS' });
    await c.post(`/order/${no}/confirm`);
    const buyerLogs = app.ctx.db.prepare('SELECT * FROM alipay_logs WHERE user_id = ? ORDER BY id').all(buyer);
    assert.equal(buyerLogs.at(-1).amount_cents, -39900);
    assert.equal(buyerLogs.at(-1).order_no, no);
    const page = await c.get('/my/alipay');
    assert.match(page.text, /付款给卖家/);
    const sellerPage = await seller.get('/my/alipay');
    assert.match(sellerPage.text, /货款到账/);
  });

  test('已买到 / 已卖出列表按状态筛选', async () => {
    const { c, no } = await placeOrder();
    const seller = await app.login('卖家一');
    assert.equal(num((await c.get('/my/bought')).text, /共 (\d+) 笔/), 1);
    assert.match((await c.get('/my/bought?status=paid')).text, /爱国者/);
    assert.doesNotMatch((await c.get('/my/bought?status=done')).text, /爱国者/);
    assert.match((await seller.get('/my/sold?status=paid')).text, /爱国者/);
    await seller.post(`/order/${no}/ship`, { company: 'EMS' });
    assert.match((await c.get('/my/bought?status=shipped')).text, /爱国者/);
  });
});
