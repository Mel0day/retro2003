import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, ADMIN, PNG_1PX } from './helpers.js';

let t;
let productId;
before(async () => {
  t = await startApp();
  productId = Number(t.ctx.db.prepare(`INSERT INTO products (category, name, price_cents, market_price_cents, stock, sales, description, featured)
    VALUES ('数码电器', '测试随身听', 19900, 29900, 5, 0, '[b]好用[/b]', 1)`).run().lastInsertRowid);
  t.ctx.db.prepare(`INSERT INTO products (category, name, price_cents, stock, status) VALUES ('数码电器', '下架商品', 100, 5, 'off')`).run();
  t.createUser('买家甲', 'pass123456');
  t.createUser('买家乙', 'pass123456');
});
after(async () => { await t.stop(); });

const orderForm = (extra = {}) => ({ qty: 2, receiver: '张三', phone: '13800138000', address: '上海市徐汇区漕溪北路 100 号', payment: 'cod', remark: '', ...extra });

test('商品列表、分类、详情页；下架商品不显示', async () => {
  const c = t.client();
  const list = await c.get('/shop');
  assert.equal(list.status, 200);
  assert.match(list.text, /测试随身听/);
  assert.ok(!list.text.includes('下架商品'));
  assert.match((await c.get(`/shop?category=${encodeURIComponent('数码电器')}&sort=price_desc`)).text, /测试随身听/);
  const detail = await c.get(`/shop/${productId}`);
  assert.equal(detail.status, 200);
  assert.match(detail.text, /<b>好用<\/b>/);
  assert.match(detail.text, /购买商品需要先/);
  const off = t.ctx.db.prepare("SELECT id FROM products WHERE name = '下架商品'").get().id;
  assert.equal((await c.get(`/shop/${off}`)).status, 404);
  assert.equal((await c.get('/shop/99999')).status, 404);
});

test('未登录不能下单', async () => {
  const c = t.client();
  const res = await c.post(`/shop/${productId}/order`, orderForm());
  assert.equal(res.status, 302);
  assert.match(res.location, /^\/login/);
});

test('下单扣库存、库存不足失败、输入校验、取消恢复库存', async () => {
  const c = t.client();
  await c.login('买家甲', 'pass123456');
  const ok = await c.post(`/shop/${productId}/order`, orderForm());
  assert.equal(ok.status, 200);
  assert.match(ok.text, /下单成功/);
  let p = t.ctx.db.prepare('SELECT stock, sales FROM products WHERE id = ?').get(productId);
  assert.deepEqual([p.stock, p.sales], [3, 2]);
  const order = t.ctx.db.prepare('SELECT * FROM orders WHERE user_id = (SELECT id FROM users WHERE username = ?)').get('买家甲');
  assert.match(order.order_no, /^\d{14}$/);
  assert.equal(order.total_cents, 39800);
  assert.match(ok.text, new RegExp(order.order_no));

  const tooMany = await c.post(`/shop/${productId}/order`, orderForm({ qty: 4 }));
  assert.equal(tooMany.status, 400);
  assert.match(tooMany.text, /库存不足/);

  const badPhone = await c.post(`/shop/${productId}/order`, orderForm({ phone: 'abc' }));
  assert.equal(badPhone.status, 400);
  assert.match(badPhone.text, /联系电话/);
  const badPay = await c.post(`/shop/${productId}/order`, orderForm({ payment: 'bitcoin' }));
  assert.match(badPay.text, /付款方式/);
  const badQty = await c.post(`/shop/${productId}/order`, orderForm({ qty: '1.5' }));
  assert.match(badQty.text, /购买数量/);
  p = t.ctx.db.prepare('SELECT stock FROM products WHERE id = ?').get(productId);
  assert.equal(p.stock, 3, '失败的下单不扣库存');

  const list = await c.get('/my/orders');
  assert.match(list.text, new RegExp(order.order_no));
  const detail = await c.get(`/my/orders/${order.order_no}`);
  assert.equal(detail.status, 200);
  assert.match(detail.text, /待确认/);

  // 他人看不到、不能取消
  const other = t.client();
  await other.login('买家乙', 'pass123456');
  assert.equal((await other.get(`/my/orders/${order.order_no}`)).status, 403);
  assert.equal((await other.post(`/my/orders/${order.order_no}/cancel`)).status, 403);
  assert.ok(!(await other.get('/my/orders')).text.includes(order.order_no));

  const cancel = await c.post(`/my/orders/${order.order_no}/cancel`);
  assert.match(cancel.text, /订单已取消/);
  p = t.ctx.db.prepare('SELECT stock, sales FROM products WHERE id = ?').get(productId);
  assert.deepEqual([p.stock, p.sales], [5, 0]);
  const again = await c.post(`/my/orders/${order.order_no}/cancel`);
  assert.equal(again.status, 400);
});

test('后台：普通会员 403；站长管理商品、处理订单并通知买家', async () => {
  const member = t.client();
  await member.login('买家乙', 'pass123456');
  assert.equal((await member.get('/admin/products')).status, 403);
  assert.equal((await member.get('/admin/orders')).status, 403);

  // 版主也不能进商品和订单管理
  t.createUser('版主丙', 'pass123456', { role: 'moderator' });
  const mod = t.client();
  await mod.login('版主丙', 'pass123456');
  assert.equal((await mod.get('/admin/orders')).status, 403);

  const admin = t.client();
  await admin.login(ADMIN.username, ADMIN.password);
  assert.equal((await admin.get('/admin/products')).status, 200);
  assert.equal((await admin.get('/admin/products/new')).status, 200);

  // 新增商品（multipart + 图片，CSRF 放查询参数）
  const create = await admin.upload(`/admin/products?_csrf=${admin.csrf}`, {
    name: '后台新商品', category: '文具书籍', price: '12.5', market_price: '15', stock: '10', sort: '3', status: 'on', featured: '1', description: '介绍',
  }, { image_file: { buffer: PNG_1PX } });
  assert.equal(create.status, 303, create.text.slice(0, 300));
  const np = t.ctx.db.prepare("SELECT * FROM products WHERE name = '后台新商品'").get();
  assert.equal(np.price_cents, 1250);
  assert.equal(np.market_price_cents, 1500);
  assert.match(np.image, /^\/uploads\//);

  const badPrice = await admin.upload(`/admin/products/${np.id}?_csrf=${admin.csrf}`, { name: '后台新商品', price: '-1', stock: '1' });
  assert.equal(badPrice.status, 400);
  assert.match(badPrice.text, /价格/);

  const edit = await admin.upload(`/admin/products/${np.id}?_csrf=${admin.csrf}`, { name: '后台新商品改名', category: '文具书籍', price: '9.9', stock: '8', sort: '0', status: 'on', image: np.image });
  assert.equal(edit.status, 303);
  assert.equal(t.ctx.db.prepare('SELECT name FROM products WHERE id = ?').get(np.id).name, '后台新商品改名');

  const toggle = await admin.post(`/admin/products/${np.id}/toggle`, { back: '/admin/products?page=1&msg=x' });
  assert.equal(toggle.status, 303);
  assert.equal(t.ctx.db.prepare('SELECT status FROM products WHERE id = ?').get(np.id).status, 'off');

  // 买家下单，站长确认、发货、完成
  const buyer = t.client();
  await buyer.login('买家甲', 'pass123456');
  await buyer.post(`/shop/${productId}/order`, orderForm({ qty: 1, payment: 'bank' }));
  const order = t.ctx.db.prepare("SELECT * FROM orders WHERE status = 'pending' ORDER BY id DESC").get();
  assert.ok(order);
  assert.match((await admin.get('/admin/orders?status=pending')).text, new RegExp(order.order_no));
  assert.equal((await admin.get(`/admin/orders/${order.order_no}`)).status, 200);

  const msgCount = () => t.ctx.db.prepare('SELECT COUNT(*) AS n FROM messages WHERE to_id = ? AND from_id IS NULL').get(order.user_id).n;
  const before0 = msgCount();

  const skip = await admin.post(`/admin/orders/${order.order_no}/status`, { action: 'done' });
  assert.match(skip.location, /err=/, '不能跳过状态');

  await admin.post(`/admin/orders/${order.order_no}/status`, { action: 'confirm' });
  const noTracking = await admin.post(`/admin/orders/${order.order_no}/status`, { action: 'ship', tracking_no: '' });
  assert.match(noTracking.location, /err=/);
  await admin.post(`/admin/orders/${order.order_no}/status`, { action: 'ship', tracking_no: 'SF1234567890' });
  let o = t.ctx.db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
  assert.equal(o.status, 'shipped');
  assert.equal(o.tracking_no, 'SF1234567890');
  assert.match((await buyer.get(`/my/orders/${order.order_no}`)).text, /SF1234567890/);
  assert.equal((await buyer.post(`/my/orders/${order.order_no}/cancel`)).status, 400, '已发货不能自行取消');

  await admin.post(`/admin/orders/${order.order_no}/status`, { action: 'done' });
  o = t.ctx.db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
  assert.equal(o.status, 'done');
  assert.equal(msgCount() - before0, 3, '确认、发货、完成各发一条系统通知');

  // 后台取消会恢复库存
  await buyer.post(`/shop/${productId}/order`, orderForm({ qty: 2 }));
  const o2 = t.ctx.db.prepare("SELECT * FROM orders WHERE status = 'pending' ORDER BY id DESC").get();
  const stockBefore = t.ctx.db.prepare('SELECT stock FROM products WHERE id = ?').get(productId).stock;
  await admin.post(`/admin/orders/${o2.order_no}/status`, { action: 'cancel' });
  assert.equal(t.ctx.db.prepare('SELECT stock FROM products WHERE id = ?').get(productId).stock, stockBefore + 2);
  assert.equal(t.ctx.db.prepare('SELECT status FROM orders WHERE id = ?').get(o2.id).status, 'cancelled');

  // 删除商品后历史订单保留
  const del = await admin.post(`/admin/products/${productId}/delete`);
  assert.equal(del.status, 303);
  assert.ok(t.ctx.db.prepare('SELECT 1 FROM orders WHERE id = ?').get(order.id));
  assert.equal((await buyer.get(`/my/orders/${order.order_no}`)).status, 200);
});
