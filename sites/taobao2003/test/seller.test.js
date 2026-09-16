import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startApp, PNG_1PX } from './helpers.js';

let app, seller, other;
const GOOD = { cat: '数码', title: '索尼 CD 随身听 D-EJ011', descr: '防震，续航 50 小时', tag: '二手', price: '420.50', orig: '580', stock: '3', city: '上海', detail: '日版机器\n附充电电池两节', status: 'onsale' };

before(async () => {
  app = await startApp();
  seller = app.createUser('小熊数码');
  other = app.createUser('别人');
});
after(() => app.stop());

describe('我要卖：发布与管理宝贝', () => {
  test('发布宝贝：上架后买家能搜到，价格按分保存', async () => {
    const c = await app.login('小熊数码');
    const res = await c.post('/sell', GOOD);
    assert.equal(res.status, 200);
    assert.match(res.text, /发布成功/);
    const it = app.ctx.db.prepare('SELECT * FROM items ORDER BY id DESC LIMIT 1').get();
    assert.equal(it.price_cents, 42050);
    assert.equal(it.orig_cents, 58000);
    assert.equal(it.stock, 3);
    assert.equal(it.status, 'onsale');
    const list = await app.client().get('/?q=%E9%9A%8F%E8%BA%AB%E5%90%AC');
    assert.match(list.text, /索尼 CD /);
    assert.match(list.text, /￥420\.50/);
  });

  test('发布校验：分类、标题、价格、库存、所在地', async () => {
    const c = await app.login('小熊数码');
    const bad = await c.post('/sell', { ...GOOD, cat: '不存在', title: '短', price: '1e5', stock: '-1', city: '' });
    assert.equal(bad.status, 200);
    for (const re of [/请选择宝贝分类/, /标题至少 4 个字/, /一口价/, /库存请填写/, /请填写所在地/]) assert.match(bad.text, re);
    assert.match((await c.post('/sell', { ...GOOD, price: '100', orig: '50' })).text, /原价要高于一口价/);
    assert.match((await c.post('/sell', { ...GOOD, price: '0' })).text, /一口价/);
    assert.match((await c.post('/sell', { ...GOOD, price: '0x10' })).text, /一口价/);
  });

  test('带图片发布：图片落盘、能访问、非图片被拒', async () => {
    const c = await app.login('小熊数码');
    const res = await c.upload('/sell', { ...GOOD, title: '柯达数码相机 CX4230' }, { images: [{ buffer: PNG_1PX, filename: 'a.png' }, { buffer: PNG_1PX, filename: 'b.jpg', type: 'image/jpeg' }] });
    assert.match(res.text, /发布成功/);
    const it = app.ctx.db.prepare('SELECT * FROM items ORDER BY id DESC LIMIT 1').get();
    const images = JSON.parse(it.images);
    assert.equal(images.length, 2);
    assert.match(images[0], /^\/uploads\/\d{6}\/[0-9a-f]{24}\.png$/);
    assert.ok(fs.existsSync(path.join(app.config.uploadDir, images[0].replace('/uploads/', ''))));
    const img = await app.client().get(images[0]);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/png');
    assert.equal(img.headers.get('x-content-type-options'), 'nosniff');
    // 伪装成图片的 HTML / SVG 会被拒
    const bad = await c.upload('/sell', { ...GOOD, title: '假图片测试宝贝' }, { images: { buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), filename: 'x.png' } });
    assert.match(bad.text, /只支持 JPG/);
    // 超过 3 张
    const many = await c.upload('/sell', { ...GOOD, title: '四张图片的宝贝' }, { images: [PNG_1PX, PNG_1PX, PNG_1PX, PNG_1PX] });
    assert.ok(many.status === 200 || many.status === 400);
    assert.match(many.text, /最多|图片/);
  });

  test('编辑宝贝：改价格、改图片、重新上架', async () => {
    const c = await app.login('小熊数码');
    await c.post('/sell', { ...GOOD, title: '朗科 U 盘 128M 优盘' });
    const id = app.ctx.db.prepare('SELECT id FROM items ORDER BY id DESC LIMIT 1').get().id;
    const page = await c.get(`/my/items/${id}/edit`);
    assert.equal(page.status, 200);
    assert.match(page.text, /朗科 U 盘/);
    const res = await c.post(`/my/items/${id}/edit`, { ...GOOD, title: '朗科 U 盘 256M 优盘', price: '199', stock: '30' });
    assert.match(res.text, /保存成功/);
    const it = app.ctx.db.prepare('SELECT * FROM items WHERE id = ?').get(id);
    assert.equal(it.title, '朗科 U 盘 256M 优盘');
    assert.equal(it.price_cents, 19900);
    assert.match(it.search_text, /256m/);
  });

  test('别人不能编辑、下架、删除我的宝贝', async () => {
    const id = app.ctx.db.prepare('SELECT id FROM items ORDER BY id LIMIT 1').get().id;
    const c = await app.login('别人');
    assert.equal((await c.get(`/my/items/${id}/edit`)).status, 404);
    assert.equal((await c.post(`/my/items/${id}/edit`, GOOD)).status, 404);
    assert.equal((await c.post(`/my/items/${id}/warehouse`)).status, 404);
    assert.equal((await c.post(`/my/items/${id}/delete`)).status, 404);
  });

  test('下架、上架、删除；有未完成交易时不能删除', async () => {
    const c = await app.login('小熊数码');
    await c.post('/sell', { ...GOOD, title: '测试用下架宝贝 一' });
    const id = app.ctx.db.prepare('SELECT id FROM items ORDER BY id DESC LIMIT 1').get().id;
    await c.post(`/my/items/${id}/warehouse`);
    assert.equal(app.ctx.db.prepare('SELECT status FROM items WHERE id = ?').get(id).status, 'warehouse');
    assert.match((await c.get('/my/items?tab=warehouse')).text, /测试用下架宝贝/);
    await c.post(`/my/items/${id}/onsale`);
    assert.equal(app.ctx.db.prepare('SELECT status FROM items WHERE id = ?').get(id).status, 'onsale');

    // 有人买了但还没完成
    const buyerId = app.createUser('买家乙');
    const b = await app.login('买家乙');
    await b.post('/cart/add', { item_id: id, qty: 1 });
    await b.post('/checkout', { source: 'cart', receiver: '张三', address: '浙江省杭州市文三路 100 号', tel: '13800138000' });
    const nope = await c.post(`/my/items/${id}/delete`);
    assert.equal(nope.status, 400);
    assert.match(nope.text, /没有完成/);
    // 交易完成后可以删除，订单快照仍在
    const no = app.ctx.db.prepare('SELECT no FROM orders ORDER BY id DESC LIMIT 1').get().no;
    await c.post(`/order/${no}/ship`, { company: 'EMS' });
    await b.post(`/order/${no}/confirm`);
    await c.post(`/my/items/${id}/delete`);
    assert.equal(app.ctx.db.prepare('SELECT status FROM items WHERE id = ?').get(id).status, 'deleted');
    const detail = await b.get(`/order/${no}`);
    assert.equal(detail.status, 200);
    assert.match(detail.text, /测试用下架宝贝/, '订单里仍能看到交易快照');
    assert.equal((await app.client().get(`/item/${id}`)).status, 404);
    assert.equal(buyerId > 0, true);
  });

  test('库存为 0 时不能上架', async () => {
    const c = await app.login('小熊数码');
    await c.post('/sell', { ...GOOD, title: '零库存的宝贝 测试', stock: '0', status: 'warehouse' });
    const id = app.ctx.db.prepare('SELECT id FROM items ORDER BY id DESC LIMIT 1').get().id;
    const res = await c.post(`/my/items/${id}/onsale`);
    assert.equal(res.status, 400);
    assert.match(res.text, /库存为 0/);
  });

  test('卖家中心页面都能打开', async () => {
    const c = await app.login('小熊数码');
    for (const url of ['/sell', '/my', '/my/items', '/my/items?tab=warehouse', '/my/sold', '/my/questions', '/my/rates', '/my/favorites', '/my/alipay', '/my/address', '/my/profile']) {
      const res = await c.get(url);
      assert.equal(res.status, 200, url);
      assert.doesNotMatch(res.text, /undefined|NaN|\[object Object\]/, url);
    }
  });

  test('个人资料与店铺介绍', async () => {
    const c = await app.login('小熊数码');
    await c.post('/my/profile', { city: '上海 徐汇', shop_intro: '太平洋数码广场，索尼、朗科授权经销。' });
    const shop = await app.client().get(`/shop/${seller}`);
    assert.match(shop.text, /太平洋数码广场/);
    assert.match(shop.text, /上海 徐汇/);
  });
});
