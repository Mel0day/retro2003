import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, num } from './helpers.js';

let app, seller, buyer;
const found = (text) => num(text, /共找到 <b class="orange">(\d+)</);

before(async () => {
  app = await startApp();
  seller = app.createUser('卖家甲', { city: '浙江 杭州' });
  buyer = app.createUser('买家甲');
  app.createItem(seller, { title: '爱国者 MP3 播放器 128M', descr: '带 FM 收音', cat: '数码', price_cents: 39900, stock: 10, tag: '担保交易' });
  app.createItem(seller, { title: '哈利·波特与凤凰社 中文版', descr: '人民文学出版社', cat: '图书', price_cents: 4500, stock: 60 });
  app.createItem(seller, { title: '纯棉短袖 T 恤 白色', descr: '夏日必备', cat: '服饰', price_cents: 2900, stock: 200, sold: 412 });
  app.createItem(seller, { title: '柯达数码相机 CX4230', descr: '200 万像素', cat: '数码', price_cents: 158000, stock: 3 });
  app.createItem(seller, { title: '仓库里的宝贝 不该出现', cat: '家居', price_cents: 1000, stock: 5, status: 'warehouse' });
});
after(() => app.stop());

describe('列表、搜索与详情', () => {
  test('首页列出在售宝贝，仓库中的不出现', async () => {
    const res = await app.client().get('/');
    assert.equal(res.status, 200);
    assert.equal(found(res.text), 4);
    assert.match(res.text, /爱国者 MP3/);
    assert.doesNotMatch(res.text, /仓库里的宝贝/);
  });

  test('分类、价格区间、排序、分页', async () => {
    const c = app.client();
    assert.equal(found((await c.get('/?cat=%E6%95%B0%E7%A0%81')).text), 2);
    assert.equal(found((await c.get('/?band=1')).text), 2, '50 元以下：T 恤和哈利波特');
    assert.equal(found((await c.get('/?band=3')).text), 2, '200 元以上有 MP3 和相机');
    const asc = (await c.get('/?sort=asc')).text;
    assert.ok(asc.indexOf('T 恤') < asc.indexOf('柯达'), '价格升序');
    const sold = (await c.get('/?sort=sold')).text;
    assert.ok(sold.indexOf('T 恤') < sold.indexOf('柯达'), '销量优先');
    // 非法参数退回默认值，不报错
    for (const q of ['?page=-1', '?page=abc', '?page=99999999', '?band=99', '?cat[]=x', '?sort=;drop', '?q=' + 'a'.repeat(500)]) {
      assert.equal((await c.get(`/${q}`)).status, 200, q);
    }
  });

  test('搜索忽略标点和大小写，多关键词取交集', async () => {
    const c = app.client();
    assert.equal(found((await c.get('/?q=%E5%93%88%E5%88%A9%E6%B3%A2%E7%89%B9')).text), 1, '哈利波特能搜到「哈利·波特」');
    assert.equal(found((await c.get('/?q=mp3')).text), 1, '小写 mp3 能搜到 MP3');
    assert.equal(found((await c.get('/?q=%E6%95%B0%E7%A0%81%20%E7%9B%B8%E6%9C%BA')).text), 1, '多关键词取交集');
    const none = await c.get('/?q=%E6%B2%A1%E6%9C%89%E8%BF%99%E4%B8%AA');
    assert.equal(found(none.text), 0);
    assert.match(none.text, /没有找到/);
  });

  test('搜索关键词高亮并且被转义', async () => {
    const res = await app.client().get(`/?q=${encodeURIComponent('<script>x</script>')}`);
    assert.equal(res.status, 200);
    assert.doesNotMatch(res.text, /<script>x<\/script>/);
    const hl = await app.client().get('/?q=MP3');
    assert.match(hl.text, /<b class="hl">MP3<\/b>/);
  });

  test('详情页显示价格、库存、卖家信用和留言；浏览数增加', async () => {
    const res = await app.client().get('/item/1');
    assert.equal(res.status, 200);
    assert.match(res.text, /￥399\.00/);
    assert.match(res.text, /库存：10 件/);
    assert.match(res.text, /卖家甲/);
    const views = app.ctx.db.prepare('SELECT views FROM items WHERE id = 1').get().views;
    assert.ok(views >= 1);
  });

  test('仓库中的宝贝：别人看不到，卖家自己能看到', async () => {
    const guest = await app.client().get('/item/5');
    assert.equal(guest.status, 404);
    assert.match(guest.text, /已经下架/);
    const c = await app.login('卖家甲');
    const own = await c.get('/item/5');
    assert.equal(own.status, 200);
    assert.match(own.text, /这是您发布的宝贝/);
  });

  test('不存在的宝贝返回 404', async () => {
    for (const url of ['/item/9999', '/item/abc', '/item/0', '/item/-1']) {
      assert.equal((await app.client().get(url)).status, 404, url);
    }
  });

  test('店铺页显示在售宝贝与评价统计', async () => {
    const res = await app.client().get(`/shop/${seller}`);
    assert.equal(res.status, 200);
    assert.match(res.text, /卖家甲的店铺/);
    assert.match(res.text, /出售中的宝贝\(4\)/);
    assert.equal((await app.client().get('/shop/99999')).status, 404);
  });

  test('宝贝留言：登录后可留言，卖家回复后显示，自己的宝贝不能留言', async () => {
    const c = await app.login('买家甲');
    const res = await c.post('/item/1/question', { text: '还有货吗？' });
    assert.equal(res.location, '/item/1?asked=1#questions');
    const page = await c.get('/item/1');
    assert.match(page.text, /还有货吗？/);

    const s = await app.login('卖家甲');
    assert.match((await s.post('/item/1/question', { text: '自问自答' })).text, /不能留言/);
    const qid = app.ctx.db.prepare('SELECT id FROM questions ORDER BY id DESC LIMIT 1').get().id;
    await s.post(`/my/questions/${qid}/reply`, { reply: '有货，随时发' });
    assert.match((await c.get('/item/1')).text, /有货，随时发/);
    // 别人的留言不能替卖家回复
    const other = await app.login('买家甲');
    assert.equal((await other.post(`/my/questions/${qid}/reply`, { reply: '我不是卖家' })).status, 404);
  });

  test('收藏夹：收藏、列表、取消', async () => {
    const c = await app.login('买家甲');
    await c.post('/item/2/favorite');
    const fav = await c.get('/my/favorites');
    assert.match(fav.text, /哈利·波特/);
    await c.post('/item/2/favorite', { remove: '1', back: 'favorites' });
    assert.doesNotMatch((await c.get('/my/favorites')).text, /哈利·波特/);
  });
});
