import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';

let t;
before(async () => { t = await startApp(); });
after(async () => { await t.stop(); });

test('帮助中心：各章节和 UBB 示例渲染', async () => {
  const res = await t.client().get('/help');
  assert.equal(res.status, 200);
  for (const s of ['新手指南', '如何发表笔记', 'UBB 代码说明', '积分与等级', '社区规则', '常见问题']) assert.match(res.text, new RegExp(s));
  assert.match(res.text, /id="ubb"/);
  assert.match(res.text, /\[b\]粗体\[\/b\]/, '示例代码原样显示');
  assert.match(res.text, /<b>粗体<\/b>/, '示例效果被渲染');
  assert.match(res.text, /元老会员/);
  assert.match(res.text, /class="on">帮 助</);
});

test('单页：从数据库读取并渲染 UBB，不存在返回 404', async () => {
  const about = await t.client().get('/page/about');
  assert.equal(about.status, 200);
  assert.match(about.text, /关于我们/);
  assert.match(about.text, /class="ubb-h"/);
  t.ctx.db.prepare("UPDATE pages SET content = '[b]自定义内容[/b]<script>' WHERE slug = 'contact'").run();
  const contact = await t.client().get('/page/contact');
  assert.match(contact.text, /<b>自定义内容<\/b>&lt;script&gt;/);
  assert.equal((await t.client().get('/page/no-such-page')).status, 404);
});

test('网站地图列出频道、论坛版块、聊天室和单页', async () => {
  const res = await t.client().get('/sitemap');
  assert.equal(res.status, 200);
  for (const s of ['穿搭搭配', '校园生活', '灌水乐园', '数码天地', '/chat/lobby', '/page/disclaimer', '免责声明']) assert.ok(res.text.includes(s), s);
});
