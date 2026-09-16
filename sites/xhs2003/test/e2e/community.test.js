import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { startE2E, loginVia, ADMIN, CAPTCHA, OUT } from './helpers.js';
import { PNG_1PX } from '../helpers.js';

let e;
before(async () => {
  e = await startE2E();
  e.createUser('甲会员', 'pass123456');
  e.createUser('乙会员', 'pass123456');
});
after(async () => { await e.close(); });
beforeEach(() => { if (e) e.problems.length = 0; });

const member = async (name) => {
  const page = await e.newPage();
  await loginVia(page, e.base, name, 'pass123456');
  return page;
};

test('聊天室：两位会员实时互发，游客同步看到，在线名单更新', async () => {
  const a = await member('甲会员');
  const b = await member('乙会员');
  const guest = await e.newPage();
  await Promise.all([a.goto(`${e.base}/chat/lobby`), b.goto(`${e.base}/chat/lobby`), guest.goto(`${e.base}/chat/lobby`)]);
  await b.waitForSelector('#online-list [data-name="甲会员"]', { timeout: 8000 });
  await a.fill('#chat-input', '大家好，我是甲 <b>不加粗</b>');
  await a.press('#chat-input', 'Enter');
  await b.waitForFunction(() => document.querySelector('#chat-log').innerText.includes('大家好，我是甲 <b>不加粗</b>'), null, { timeout: 8000 });
  await guest.waitForFunction(() => document.querySelector('#chat-log').innerText.includes('我是甲'), null, { timeout: 8000 });
  assert.equal(await b.locator('#chat-log b:text("不加粗")').count(), 0, '用户内容按纯文本显示');
  await b.fill('#chat-input', '收到！');
  await b.press('#chat-input', 'Enter');
  await a.waitForFunction(() => document.querySelector('#chat-log').innerText.includes('收到！'), null, { timeout: 8000 });
  assert.ok(await guest.locator('#chat-form input[name=content]').count() === 0 || await guest.locator('text=游客只能旁观').count() > 0);
  await a.screenshot({ path: path.join(OUT, 'chat.png') });
  assert.deepEqual(e.problems, []);
});

test('购物：下单扣库存 → 我的订单 → 取消恢复库存', async () => {
  const page = await member('甲会员');
  const product = e.ctx.db.prepare("SELECT * FROM products WHERE name LIKE '雅芳%'").get();
  await page.goto(`${e.base}/shop/${product.id}`);
  await page.fill('input[name=qty]', '2');
  await page.fill('input[name=receiver]', '张甲');
  await page.fill('input[name=phone]', '13800138000');
  await page.fill('input[name=address]', '上海市徐汇区漕溪北路 1 号');
  await page.check('input[name=payment][value=cod]');
  await page.click('form[action$="/order"] button[type=submit]');
  await page.waitForSelector('text=订单号');
  assert.equal(e.ctx.db.prepare('SELECT stock FROM products WHERE id = ?').get(product.id).stock, product.stock - 2);
  const order = e.ctx.db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 1').get();
  await page.goto(`${e.base}/my/orders/${order.order_no}`);
  await page.click('form[action$="/cancel"] button[type=submit]');
  await page.waitForLoadState('load');
  assert.equal(e.ctx.db.prepare('SELECT status FROM orders WHERE id = ?').get(order.id).status, 'cancelled');
  assert.equal(e.ctx.db.prepare('SELECT stock FROM products WHERE id = ?').get(product.id).stock, product.stock);
  assert.deepEqual(e.problems, []);
});

test('论坛：发投票帖 → 另一位会员投票并回帖 → 结果条出现', async () => {
  const a = await member('甲会员');
  const board = e.ctx.db.prepare("SELECT id FROM forum_boards WHERE name = '灌水乐园'").get();
  await a.goto(`${e.base}/forum/board/${board.id}/new`);
  await a.fill('input[name=title]', '端到端投票：周末去哪');
  await a.fill('#thread-content', '大家投个票吧');
  await a.check('input[name=poll]');
  await a.fill('textarea[name=poll_options]', '爬山\n看电影\n宅家');
  await a.click('form[action$="/new"] button[type=submit]');
  await a.waitForURL(/\/forum\/thread\/\d+/, { timeout: 8000 });
  const threadUrl = a.url().replace(/[?#].*$/, '');

  const b = await member('乙会员');
  await b.goto(threadUrl);
  await b.check('input[name=option_id] >> nth=1');
  await b.click('form[action$="/vote"] button[type=submit]');
  await b.waitForSelector('.poll-bar');
  const replyBox = b.locator('form[action$="/reply"] textarea');
  await replyBox.fill('我投看电影');
  await b.click('form[action$="/reply"] button[type=submit]');
  await b.waitForSelector('text=我投看电影');
  const t = e.ctx.db.prepare("SELECT * FROM forum_threads WHERE title = '端到端投票：周末去哪'").get();
  assert.equal(t.reply_count, 1);
  assert.equal(e.ctx.db.prepare('SELECT SUM(votes) AS n FROM poll_options WHERE thread_id = ?').get(t.id).n, 1);
  assert.deepEqual(e.problems, []);
});

test('后台：游客留言待审 → 站长在后台批量通过 → 前台可见', async () => {
  const note = e.ctx.db.prepare("SELECT id FROM notes WHERE title LIKE '西塘%'").get();
  const guest = await e.newPage();
  await guest.goto(`${e.base}/notes/${note.id}`);
  await guest.fill('input[name=nickname]', '江南游客');
  await guest.fill('#reply-content', '等审核的游客留言');
  await guest.fill('.cmt-form input[name=captcha]', CAPTCHA);
  await guest.click('.cmt-form button[type=submit]');
  await guest.waitForSelector('text=审核通过后显示');

  const admin = await e.newPage();
  await loginVia(admin, e.base, ADMIN.username, ADMIN.password);
  await admin.goto(`${e.base}/admin/comments?status=pending`);
  const row = admin.locator('tr', { hasText: '等审核的游客留言' });
  await row.locator('input[name=ids]').check();
  await admin.click('button[name=action][value=approve]');
  await admin.waitForLoadState('load');
  await guest.goto(`${e.base}/notes/${note.id}?page=5`);
  await guest.waitForSelector('text=等审核的游客留言');
  assert.deepEqual(e.problems, []);
});

test('相册：新建相册并通过页面上传照片', async () => {
  const page = await member('乙会员');
  await page.goto(`${e.base}/album/my`);
  await page.fill('input[name=title]', '端到端相册');
  await page.click('form[action="/album/create"] button[type=submit]');
  await page.waitForURL(/\/album\/\d+/, { timeout: 8000 });
  await page.setInputFiles('#album-upload input[type=file]', [
    { name: 'a.png', mimeType: 'image/png', buffer: PNG_1PX },
    { name: 'b.png', mimeType: 'image/png', buffer: PNG_1PX },
  ]);
  await page.click('#album-upload button[type=submit]');
  await page.waitForFunction(() => document.querySelectorAll('img[src^="/uploads/"]').length >= 2, null, { timeout: 10000 });
  const album = e.ctx.db.prepare("SELECT * FROM albums WHERE title = '端到端相册'").get();
  assert.equal(album.photo_count, 2);
  assert.deepEqual(e.problems, []);
});

test('WAP：手机访问首页跳转，正文翻页、顶一下', async () => {
  const page = await e.newPage({ viewport: { width: 390, height: 844 }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148' });
  await page.goto(`${e.base}/`);
  await page.waitForURL(`${e.base}/wap`);
  const note = e.ctx.db.prepare("SELECT id, likes FROM notes WHERE title LIKE '西塘%'").get();
  await page.goto(`${e.base}/wap/note/${note.id}`);
  const page1 = await page.locator('.content').innerText();
  await page.click('a:text("下一页")');
  const page2 = await page.locator('.content').innerText();
  assert.notEqual(page1, page2);
  await page.click('button:text("顶(")');
  await page.waitForLoadState('load');
  assert.equal(e.ctx.db.prepare('SELECT likes FROM notes WHERE id = ?').get(note.id).likes, note.likes + 1);
  await page.screenshot({ path: path.join(OUT, 'wap-note.png'), fullPage: true });
  assert.deepEqual(e.problems, []);
});
