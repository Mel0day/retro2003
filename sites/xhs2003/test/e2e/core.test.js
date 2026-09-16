import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { startE2E, loginVia, ADMIN, CAPTCHA, OUT } from './helpers.js';
import { PNG_1PX } from '../helpers.js';

let e;
before(async () => { e = await startE2E(); });
after(async () => { await e.close(); });
beforeEach(() => { if (e) e.problems.length = 0; });

test('首页：演示内容完整渲染，无脚本错误', async () => {
  const page = await e.newPage();
  await page.goto(e.base + '/');
  assert.equal(await page.locator('.pics .pic').count(), 6);
  assert.equal(await page.locator('.news-row').count(), 12);
  assert.equal(await page.locator('.rank-row').count(), 10);
  assert.ok(await page.locator('.marquee-txt').isVisible());
  assert.equal(await page.locator('.digit').count(), 8);
  const first = await page.locator('.tagcloud a').first().getAttribute('style');
  assert.match(first, /16px/);
  await page.screenshot({ path: path.join(OUT, 'home.png'), fullPage: true });
  assert.deepEqual(e.problems, []);
});

test('首页登录框登录 → 发笔记（上传图片 + 预览）→ 顶一下 → 留言盖楼', async () => {
  const page = await e.newPage();
  await page.goto(e.base + '/');
  await page.fill('.box.red input[name=username]', ADMIN.username);
  await page.fill('.box.red input[name=password]', ADMIN.password);
  await page.fill('.box.red input[name=captcha]', CAPTCHA);
  await page.click('.box.red button[type=submit]');
  await page.waitForURL(e.base + '/', { timeout: 8000 });
  await page.waitForSelector('text=会员信息');

  await page.goto(e.base + '/notes/new');
  await page.selectOption('select[name=channel_id]', { label: '旅游攻略' });
  await page.fill('input[name=title]', '端到端测试：周末游乌镇');
  await page.fill('input[name=tags]', '旅行 乌镇');
  await page.fill('#note-content', '乌镇的夜景很美。\n\n');
  await page.setInputFiles('input[data-upload]', { name: 'dot.png', mimeType: 'image/png', buffer: PNG_1PX });
  await page.waitForFunction(() => document.querySelector('#note-content').value.includes('[img='));
  await page.click('button[data-preview]');
  await page.waitForSelector('#note-content-preview img');
  await page.click('form button[type=submit]');
  await page.waitForURL(/\/notes\/\d+$/, { timeout: 8000 });
  assert.equal(await page.locator('h1.note-title').innerText(), '端到端测试：周末游乌镇');
  assert.equal(await page.locator('.note-body img').count(), 1);

  await page.click('button[data-count-key=likes]');
  await page.waitForFunction(() => document.querySelector('[data-count=likes]').textContent === '1');

  await page.click('[data-fontsize=fs-l]');
  assert.ok(await page.locator('.note-body.fs-l').count());

  await page.click('[data-emot=":-)"]');
  await page.type('#reply-content', '端到端留言，盖一楼');
  await page.click('.cmt-form button[type=submit]');
  await page.waitForURL(/#floor-1$/);
  assert.match(await page.locator('#floor-1 .cmt-text').innerText(), /端到端留言/);
  await page.screenshot({ path: path.join(OUT, 'note-detail.png'), fullPage: true });
  assert.deepEqual(e.problems, []);
});

test('游客：留言进入审核，收藏提示登录，验证码可点击刷新', async () => {
  const page = await e.newPage();
  const note = e.ctx.db.prepare("SELECT id FROM notes WHERE title LIKE '西塘%'").get();
  await page.goto(`${e.base}/notes/${note.id}`);
  const img = page.locator('.cmt-form img.captcha');
  const src1 = await img.getAttribute('src');
  await img.click();
  await page.waitForFunction((s) => document.querySelector('.cmt-form img.captcha').getAttribute('src') !== s, src1);
  await page.fill('input[name=nickname]', '路过的游客');
  await page.fill('#reply-content', '游客留言测试');
  await page.fill('.cmt-form input[name=captcha]', CAPTCHA);
  await page.click('.cmt-form button[type=submit]');
  await page.waitForSelector('text=审核通过后显示');

  // 游客点收藏：弹出提示后跳到登录页
  await page.goto(`${e.base}/notes/${note.id}`);
  await page.click('.note-actions button[data-count-key=fav]');
  await page.waitForURL(/\/login\?next=/);
  assert.deepEqual(e.problems, []);
});
