// 浏览器端到端：走完核心闭环并确认控制台零报错。按你的产品把这里换成真正的主线。
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startE2E, login, DEMO_PASSWORD } from './helpers.js';

let e, base;
before(async () => { e = await startE2E(); base = e.base; });
after(() => e.close());

describe('浏览器端到端', () => {
  test('登录 → 发布 → 留言 → 顶一下', async () => {
    const page = await e.newPage();
    await login(page, base, 'demo', DEMO_PASSWORD);
    await page.goto(`${base}/publish`);
    await page.selectOption('#publishform select[name=channel]', '分享');
    await page.fill('input[name=title]', '端到端测试发布的内容');
    await page.fill('textarea[name=body]', '这是端到端测试自动发布的正文，长度足够。');
    await Promise.all([page.waitForNavigation(), page.click('#publishform button[type=submit]')]);
    await page.waitForSelector('text=发布成功');
    await e.shot(page, '01-published');

    await page.goto(`${base}/`);
    await page.click('a.ttl');
    await page.fill('.qform input[name=body]', '端到端测试留言');
    await Promise.all([page.waitForNavigation(), page.click('.qform button')]);
    assert.match(await page.textContent('body'), /端到端测试留言/);
    await Promise.all([page.waitForNavigation(), page.click('.center button')]);
    assert.match(await page.textContent('body'), /顶一下（1）|顶 1/);
    await e.shot(page, '02-entry');
    assert.deepEqual(e.problems, []);
  });

  test('主要页面没有报错和模板残留', async () => {
    const page = await e.newPage();
    await login(page, base, 'demo', DEMO_PASSWORD);
    for (const url of ['/', '/?channel=分享', '/entry/1', '/publish', '/my', '/u/2', '/page/help', '/login', '/register']) {
      await page.goto(base + url, { waitUntil: 'domcontentloaded' });
      const body = await page.textContent('body');
      assert.doesNotMatch(body, /undefined|NaN|\[object Object\]|\{\{/, url);
    }
    assert.deepEqual(e.problems, []);
  });
});
