// 演示数据、重启持久化、空库可用性
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startApp, num } from './helpers.js';
import { seedDemo, BUYERS, SELLERS, PRODUCTS, DEMO_PASSWORD } from '../scripts/seed-data.js';
import { creditOf } from '../src/services/credit.js';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { createUser } from '../src/services/auth.js';

let app;
before(async () => {
  app = await startApp();
  seedDemo(app.ctx, { onlyIfEmpty: false });
});
after(() => app.stop());

describe('演示数据', () => {
  test('导入后有完整的会员、宝贝、订单、评价', async () => {
    const one = (sql) => app.ctx.db.prepare(sql).get().n;
    assert.equal(one("SELECT COUNT(*) AS n FROM items WHERE status = 'onsale'"), PRODUCTS.length);
    assert.ok(one('SELECT COUNT(*) AS n FROM users') > SELLERS.length + BUYERS.length);
    assert.ok(one('SELECT COUNT(*) AS n FROM orders') >= 45);
    assert.ok(one('SELECT COUNT(*) AS n FROM ratings') > 1000);
    assert.equal(one('SELECT COUNT(*) AS n FROM orders WHERE total_cents <= 0'), 0);
    assert.equal(one('SELECT COUNT(*) AS n FROM users WHERE balance_cents < 0'), 0);
    assert.equal(one('SELECT COUNT(*) AS n FROM items WHERE stock < 0'), 0);
  });

  test('重复导入不会写第二遍', async () => {
    const before = app.ctx.db.prepare('SELECT COUNT(*) AS n FROM items').get().n;
    assert.equal(seedDemo(app.ctx, { onlyIfEmpty: true }), false);
    assert.equal(app.ctx.db.prepare('SELECT COUNT(*) AS n FROM items').get().n, before);
  });

  test('卖家信用和原型接近，好评率合理', async () => {
    for (const s of SELLERS.slice(0, 5)) {
      const id = app.ctx.db.prepare('SELECT id FROM users WHERE username = ?').get(s.name).id;
      const cr = creditOf(app.ctx.db, id, 'seller');
      assert.ok(cr.total >= s.total * 0.8 && cr.total <= s.total * 1.2, `${s.name} 评价数 ${cr.total}，期望约 ${s.total}`);
      assert.ok(Number(cr.rate) >= 90, `${s.name} 好评率 ${cr.rate}%`);
      assert.ok(cr.score > 0);
    }
  });

  test('演示账号能登录，demo 手上各种状态的订单都有', async () => {
    const c = await app.login('demo', DEMO_PASSWORD);
    const bought = await c.get('/my/bought');
    assert.equal(bought.status, 200);
    assert.ok(num(bought.text, /共 (\d+) 笔/) >= 4);
    for (const [status, re] of [['paid', /等待发货/], ['shipped', /卖家已发货/], ['done', /交易成功/]]) {
      const page = await c.get(`/my/bought?status=${status}`);
      assert.match(page.text, re, status);
      assert.doesNotMatch(page.text, /没有买到的宝贝/, status);
    }
    // 有一笔可以确认收货，有一笔可以评价，有一笔可以取消
    assert.match((await c.get('/order/TB20030614')).text, /确认收货/);
    assert.match((await c.get('/order/TB20030601')).text, /给卖家评价/);
    assert.match((await c.get('/order/TB20030618')).text, /取消交易/);
  });

  test('演示卖家有待发货订单和在售宝贝', async () => {
    const s = await app.login('数码小铺', DEMO_PASSWORD);
    const sold = await s.get('/my/sold?status=paid');
    assert.match(sold.text, /发货/);
    const items = await s.get('/my/items');
    assert.match(items.text, /爱国者 MP3/);
    assert.match((await s.get('/my/questions')).text, /还有货吗/);
  });

  test('首页看起来像运营了两年：有图片、有销量、有评价', async () => {
    const home = await app.client().get('/');
    assert.equal(num(home.text, /共找到 <b class="orange">(\d+)</), PRODUCTS.length);
    assert.match(home.text, /<img src="\/uploads\/seed\//, '宝贝有配图');
    assert.match(home.text, /★/, '卖家有信用星级');
    const item = await app.client().get('/item/1');
    assert.match(item.text, /好评率/);
    assert.match(item.text, /买家评价/);
  });

  test('演示图片都能访问', async () => {
    const images = app.ctx.db.prepare("SELECT images FROM items WHERE images <> '[]' LIMIT 10").all().flatMap((r) => JSON.parse(r.images));
    assert.ok(images.length > 0);
    for (const url of images) {
      const res = await app.client().get(url);
      assert.equal(res.status, 200, url);
    }
    assert.ok(fs.existsSync(path.join(app.config.root, 'seed/images/credits.json')), '图片署名文件在');
  });
});

describe('持久化与空库', () => {
  test('重启后数据还在，再次启动不会重复执行迁移', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'taobao2003-restart-'));
    try {
      const first = createApp(loadConfig({ NODE_ENV: 'test', DATA_DIR: dataDir, LOG_REQUESTS: '0' }));
      const id = createUser(first.ctx, { username: '持久会员', password: 'pass1234' });
      first.db.prepare("INSERT INTO items (seller_id, cat, title, price_cents, stock, city, search_text) VALUES (?, '家居', '重启前发布的宝贝', 100, 1, '杭州', '重启前发布的宝贝')").run(id);
      first.close();

      const again = createApp(loadConfig({ NODE_ENV: 'test', DATA_DIR: dataDir, LOG_REQUESTS: '0' }));
      assert.equal(again.db.prepare('SELECT COUNT(*) AS n FROM items').get().n, 1);
      assert.equal(again.db.prepare('SELECT title FROM items').get().title, '重启前发布的宝贝');
      assert.equal(again.db.pragma('user_version', { simple: true }), 1);
      again.close();
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test('全新空库可以正常使用：首页、注册、发布第一件宝贝', async () => {
    const a = await startApp();
    try {
      const home = await a.client().get('/');
      assert.equal(home.status, 200);
      assert.match(home.text, /没有找到/);
      const c = a.client();
      await c.post('/register', { username: '第一个会员', password: 'pass1234', password2: 'pass1234', agree: '1' });
      const res = await c.post('/sell', { cat: '家居', title: '第一件宝贝 测试', descr: '开张大吉', price: '9.90', stock: '1', city: '浙江 杭州', status: 'onsale' });
      assert.match(res.text, /发布成功/);
      const list = await a.client().get('/');
      assert.match(list.text, /第一件宝贝/);
      assert.match(list.text, /￥9\.90/);
      // 空库的后台也能打开
      const admin = await a.login('淘宝小二', 'admin123456789');
      assert.equal((await admin.get('/admin')).status, 200);
    } finally {
      await a.stop();
    }
  });
});
