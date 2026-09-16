// 浏览器端到端：C2C 完整链路（发布 → 购买 → 发货 → 确认收货 → 互评）与游客购物流程
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startE2E, login, DEMO_PASSWORD, ADMIN } from './helpers.js';

let e, base;
before(async () => { e = await startE2E(); base = e.base; });
after(() => e.close());

describe('浏览器端到端', () => {
  test('卖家发布带图宝贝 → 买家下单 → 卖家发货 → 买家确认收货 → 双方评价', async () => {
    const seller = await e.newPage();
    await login(seller, base, '小乖服饰', DEMO_PASSWORD);
    await seller.goto(`${base}/sell`);
    await seller.selectOption('#sellform select[name=cat]', '服饰');
    await seller.fill('input[name=title]', '真丝围巾 端到端测试专用');
    await seller.fill('input[name=descr]', '端到端测试用的宝贝');
    await seller.fill('input[name=price]', '39.90');
    await seller.fill('input[name=stock]', '2');
    await seller.fill('input[name=city]', '广东 广州');
    await seller.fill('textarea[name=detail]', '这是一件用于端到端测试的宝贝。');
    await seller.setInputFiles('input[name=images]', {
      name: 'scarf.png', mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64'),
    });
    await Promise.all([seller.waitForNavigation(), seller.click('button.btn-orange')]);
    await seller.waitForSelector('text=发布成功');
    await e.shot(seller, '01-sell-done');

    // 买家搜索并「立刻购买」
    const buyer = await e.newPage();
    await login(buyer, base, 'demo', DEMO_PASSWORD);
    await buyer.goto(base);
    await buyer.fill('.search input[name=q]', '真丝围巾');
    await Promise.all([buyer.waitForNavigation(), buyer.click('.search button')]);
    await buyer.click('a.ttl');
    await buyer.waitForSelector('text=真丝围巾 端到端测试专用');
    assert.ok(await buyer.$('.bigpic img'), '详情页显示上传的图片');
    await e.shot(buyer, '02-item');
    await Promise.all([buyer.waitForNavigation(), buyer.click('button.btn-orange')]);
    await buyer.waitForSelector('text=确认订单');
    await buyer.fill('input[name=receiver]', '王小明');
    await buyer.fill('input[name=address]', '浙江省杭州市文二路 88 号 3 幢 201 室');
    await buyer.fill('input[name=tel]', '0571-88881234');
    await buyer.click('input[value=ems]');
    await buyer.waitForFunction(() => document.querySelector('#grand').textContent.includes('59.90'));
    await e.shot(buyer, '03-checkout');
    await Promise.all([buyer.waitForNavigation(), buyer.click('button.btn-blue')]);
    await buyer.waitForSelector('text=付款成功');
    await e.shot(buyer, '04-paid');
    const no = (await buyer.textContent('.carttable a')).trim();
    assert.match(no, /^TB\d{8}$/);

    // 卖家发货
    await seller.goto(`${base}/my/sold?status=paid`);
    await seller.waitForSelector(`text=${no}`);
    await seller.goto(`${base}/order/${no}`);
    await seller.selectOption('select[name=company]', '圆通速递');
    await seller.fill('input[name=tracking_no]', 'YT1234567890');
    await Promise.all([seller.waitForNavigation(), seller.click('button.btn-orange')]);
    await seller.waitForSelector('text=已发货');
    await e.shot(seller, '05-shipped');

    // 买家确认收货并评价
    await buyer.goto(`${base}/order/${no}`);
    await buyer.waitForSelector('text=卖家已发货');
    await Promise.all([buyer.waitForNavigation(), buyer.click('button.btn-orange')]);
    await buyer.waitForSelector('text=交易成功');
    await buyer.goto(`${base}/order/${no}`);
    await buyer.fill('.reviewform input[name=text]', '围巾很漂亮，发货也快，好评！');
    await Promise.all([buyer.waitForNavigation(), buyer.click('.reviewform button')]);
    await buyer.waitForSelector('text=评价成功');
    await e.shot(buyer, '06-rated');

    // 卖家评价买家，并看到货款到账
    await seller.goto(`${base}/order/${no}`);
    await seller.waitForSelector('text=交易成功');
    await seller.fill('.reviewform input[name=text]', '爽快的买家，欢迎再来');
    await Promise.all([seller.waitForNavigation(), seller.click('.reviewform button')]);
    await seller.goto(`${base}/my/alipay`);
    assert.match(await seller.textContent('body'), /货款到账/);

    // 评价出现在宝贝页和店铺页
    const guest = await e.newPage();
    await guest.goto(`${base}/?q=真丝围巾`);
    await guest.click('a.ttl');
    assert.match(await guest.textContent('body'), /围巾很漂亮/);
    await e.shot(guest, '07-item-rated');
    assert.deepEqual(e.problems, []);
  });

  test('游客加购物车 → 登录合并 → 结算下单', async () => {
    const page = await e.newPage();
    await page.goto(`${base}/item/5`); // 纯棉 T 恤，库存充足
    await Promise.all([page.waitForNavigation(), page.click('#cartform button')]);
    await Promise.all([page.waitForNavigation(), page.click('a[href="/cart"]')]);
    await page.waitForSelector('text=我的购物车');
    assert.match(await page.textContent('.cartsum'), /共 1 件/);
    await Promise.all([page.waitForNavigation(), page.click('button[value=plus]')]); // 加一件
    assert.match(await page.textContent('.cartsum'), /共 2 件/);
    await e.shot(page, '10-cart-guest');
    await login(page, base, 'tb_88', DEMO_PASSWORD);
    await page.goto(`${base}/cart`);
    assert.match(await page.textContent('.cartsum'), /共 2 件/, '游客购物车已合并到账号');
    await Promise.all([page.waitForNavigation(), page.click('a.btn-orange')]);
    await page.waitForSelector('text=确认订单');
    await page.fill('input[name=receiver]', '陈大伟');
    await page.fill('input[name=address]', '广东省广州市天河区体育西路 103 号');
    await page.fill('input[name=tel]', '020-38881234');
    await Promise.all([page.waitForNavigation(), page.click('button.btn-blue')]);
    await page.waitForSelector('text=付款成功');
    await page.goto(`${base}/cart`);
    assert.match(await page.textContent('body'), /购物车是空的/);
    assert.deepEqual(e.problems, []);
  });

  test('买家取消未发货订单，钱退回支付宝', async () => {
    const page = await e.newPage();
    await login(page, base, 'lucy', DEMO_PASSWORD);
    await page.goto(`${base}/item/9`);
    await Promise.all([page.waitForNavigation(), page.click('button.btn-orange')]);
    await page.fill('input[name=receiver]', '林小慧');
    await page.fill('input[name=address]', '福建省厦门市思明区厦大学生公寓 7 号楼');
    await page.fill('input[name=tel]', '0592-2181234');
    const before = await page.textContent('.paybox');
    assert.match(before, /支付宝账户余额/);
    await Promise.all([page.waitForNavigation(), page.click('button.btn-blue')]);
    const no = (await page.textContent('.carttable a')).trim();
    await page.goto(`${base}/order/${no}`);
    await Promise.all([page.waitForNavigation(), page.click('button[type=submit]:near(select[name=reason])')]);
    await page.waitForSelector('text=交易已取消');
    await page.goto(`${base}/my/alipay`);
    assert.match(await page.textContent('body'), /交易关闭，货款退回/);
    assert.deepEqual(e.problems, []);
  });

  test('淘宝小二后台：冻结会员、下架宝贝、改公告', async () => {
    const page = await e.newPage();
    await login(page, base, ADMIN.username, ADMIN.password);
    await page.goto(`${base}/admin`);
    await e.shot(page, '20-admin');
    await page.goto(`${base}/admin/items?q=保温杯`);
    await page.fill('input[name=reason]', '测试强制下架');
    await Promise.all([page.waitForNavigation(), page.click('button.btn-red')]);
    const guest = await e.newPage();
    await guest.goto(`${base}/?q=保温杯`);
    assert.match(await guest.textContent('body'), /没有找到/);

    await page.goto(`${base}/admin/settings`);
    await page.fill('input[name=announcement]', '☆ 端到端测试公告：全场包平邮 ☆');
    await Promise.all([page.waitForNavigation(), page.click('button.btn')]);
    await guest.goto(base);
    assert.match(await guest.textContent('.marquee'), /端到端测试公告/);
    assert.deepEqual(e.problems, []);
  });

  test('主要页面在浏览器里没有报错，也没有模板残留', async () => {
    const page = await e.newPage();
    await login(page, base, 'demo', DEMO_PASSWORD);
    const urls = ['/', '/?cat=数码', '/?q=MP3', '/item/1', '/cart', '/my', '/my/bought', '/my/sold', '/my/items', '/my/rates', '/my/favorites', '/my/alipay', '/my/address', '/my/profile', '/my/questions', '/sell', '/shop/2', '/shop/2?tab=rates', '/page/help', '/page/rules', '/page/sitemap', '/order/TB20030512'];
    for (const url of urls) {
      await page.goto(base + url, { waitUntil: 'domcontentloaded' });
      const body = await page.textContent('body');
      assert.doesNotMatch(body, /undefined|NaN|\[object Object\]|\{\{/, url);
      assert.equal(await page.title() !== '', true, url);
    }
    await e.shot(page, '30-my');
    assert.deepEqual(e.problems, []);
  });
});
