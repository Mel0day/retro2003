import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, CAPTCHA } from './helpers.js';
import { createNote } from '../src/services/notes.js';
import { createThread } from '../src/services/forum.js';

const MOBILE = { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Mobile' };
let t;
let author;
let longNote;

before(async () => {
  t = await startApp();
  const authorId = t.createUser('手机作者', 'pass123456');
  author = t.ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(authorId);
  const channelId = t.ctx.db.prepare("SELECT id FROM channels WHERE slug = 'travel'").get().id;
  const paras = Array.from({ length: 8 }, (_, i) => `第${i + 1}段：${'江南水乡的清晨，石板路上还带着露水，河边的乌篷船慢慢划过。'.repeat(3)}`);
  const id = createNote(t.ctx, author.id, { title: '手机版长笔记测试', content: paras.join('\n\n'), channelId, tags: '旅行' });
  longNote = { id, paras };
});
after(async () => { await t.stop(); });

test('WAP 首页：各入口、手机 UA 跳转、页脚字节数', async () => {
  const c = t.client();
  const pc = await c.get('/', { headers: MOBILE });
  assert.equal(pc.status, 302);
  assert.equal(pc.location, '/wap');
  const home = await c.get('/wap', { headers: MOBILE });
  assert.equal(home.status, 200);
  for (const href of ['/wap/notes', '/wap/forum', '/wap/chat', '/wap/album', '/wap/shop', '/wap/my', '/wap/login', '/wap/register', '/?pc=1']) {
    assert.ok(home.text.includes(`href="${href}"`), `首页缺少入口 ${href}`);
  }
  assert.match(home.text, /accesskey="1"/);
  assert.match(home.text, /WAP 2\.0/);
  assert.match(home.text, /name="viewport" content="width=device-width, initial-scale=1"/);
  const m = home.text.match(/([\d.]+)KB · 在线/);
  assert.ok(m, '页脚显示字节数');
  const actual = Buffer.byteLength(home.text) / 1024;
  assert.ok(Math.abs(Number(m[1]) - actual) / actual < 0.1, `页脚 ${m[1]}KB 与实际 ${actual.toFixed(2)}KB 差距过大`);
  assert.ok(!home.text.includes('%%WAP_PAGE_KB%%'));
});

test('WAP 笔记：列表、分页阅读、看全文', async () => {
  const c = t.client();
  const list = await c.get('/wap/notes?channel=travel');
  assert.equal(list.status, 200);
  assert.match(list.text, /手机版长笔记测试/);
  assert.equal((await c.get('/wap/notes?channel=nope')).status, 404);
  assert.equal((await c.get('/wap/channels')).status, 200);

  const p1 = await c.get(`/wap/note/${longNote.id}`);
  const p2 = await c.get(`/wap/note/${longNote.id}?p=2`);
  assert.equal(p1.status, 200);
  assert.equal(p2.status, 200);
  assert.match(p1.text, /第1段/);
  assert.ok(!p1.text.includes('第8段'));
  assert.match(p2.text, /\(2\/\d\)/);
  assert.ok(!p2.text.includes('第1段：'), '第二页不包含第一段');
  assert.match(p1.text, /看全文/);
  const all = await c.get(`/wap/note/${longNote.id}?all=1`);
  for (let i = 1; i <= 8; i++) assert.ok(all.text.includes(`第${i}段`), `全文缺少第${i}段`);
  assert.equal((await c.get('/wap/note/999999')).status, 404);
});

test('WAP 顶一下防重复、收藏需登录', async () => {
  const c = t.client();
  await c.init();
  const r1 = await c.post(`/wap/note/${longNote.id}/like`, { back: `/wap/note/${longNote.id}` });
  assert.equal(r1.status, 303);
  const r2 = await c.post(`/wap/note/${longNote.id}/like`, { back: `/wap/note/${longNote.id}` });
  assert.match(r2.text, /已经顶过/);
  assert.equal(t.ctx.db.prepare('SELECT likes FROM notes WHERE id = ?').get(longNote.id).likes, 1);
  const fav = await c.post(`/wap/note/${longNote.id}/favorite`, { back: `/wap/note/${longNote.id}` });
  assert.equal(fav.status, 303);
  assert.match(fav.location, /^\/wap\/login\?next=/);
  // 外站跳转地址被忽略
  const evil = await c.post(`/wap/note/${longNote.id}/like`, { back: 'https://evil.example/' });
  assert.ok(!String(evil.location || '').includes('evil'));
});

test('WAP 留言：游客验证码与审核、会员直接显示', async () => {
  const guest = t.client();
  await guest.init();
  const bad = await guest.post(`/wap/note/${longNote.id}/comments`, { nickname: '手机游客', content: '路过看看', captcha: 'XXXX' });
  assert.equal(bad.status, 400);
  assert.match(bad.text, /验证码错误/);
  assert.match(bad.text, /wap\.css/);
  const ok = await guest.post(`/wap/note/${longNote.id}/comments`, { nickname: '手机游客', content: '路过看看', captcha: CAPTCHA });
  assert.match(ok.text, /审核/);
  assert.equal(t.ctx.db.prepare("SELECT status FROM comments WHERE guest_name = '手机游客'").get().status, 'pending');

  t.createUser('手机读者', 'pass123456');
  const member = t.client();
  await member.login('手机读者', 'pass123456');
  const res = await member.post(`/wap/note/${longNote.id}/comments`, { content: '会员手机留言 <b>不转义就糟了</b>' });
  assert.equal(res.status, 303);
  const page = await member.get(`/wap/note/${longNote.id}/comments`);
  assert.match(page.text, /会员手机留言/);
  assert.ok(!page.text.includes('<b>不转义就糟了</b>'));
  assert.ok(!page.text.includes('路过看看'), '待审核留言不显示');
});

test('WAP 登录、退出、注册', async () => {
  t.createUser('手机登录', 'pass123456');
  const c = t.client();
  assert.equal((await c.get('/wap/login')).status, 200);
  const wrong = await c.post('/wap/login', { username: '手机登录', password: 'nope', captcha: CAPTCHA });
  assert.match(wrong.text, /用户名或密码错误/);
  const ok = await c.post('/wap/login', { username: '手机登录', password: 'pass123456', captcha: CAPTCHA, next: '/wap/my' });
  assert.match(ok.text, /登录成功/);
  assert.ok(c.jar.has('sid'));
  const home = await c.get('/wap');
  assert.match(home.text, /手机登录/);
  assert.match(home.text, /短消息/);
  await c.post('/wap/logout');
  assert.ok(!c.jar.has('sid'));

  const r = t.client();
  await r.init();
  const reg = await r.post('/wap/register', { username: '手机新人', password: 'secret123', password2: 'secret123', question: '我的手机？', answer: '诺基亚', captcha: CAPTCHA });
  assert.match(reg.text, /注册成功/);
  assert.ok(r.jar.has('sid'));
  const dup = await t.client().post('/wap/register', { username: '手机新人', password: 'secret123', password2: 'secret123', question: 'q', answer: 'a', captcha: CAPTCHA });
  assert.match(dup.text, /已被注册/);
});

test('WAP 论坛：版块、主题分页、回帖', async () => {
  const board = t.ctx.db.prepare('SELECT * FROM forum_boards ORDER BY id LIMIT 1').get();
  const tid = createThread(t.ctx, { boardId: board.id, user: author, title: '手机论坛测试帖', content: '大家好，这是手机版测试。' });
  const c = t.client();
  assert.match((await c.get('/wap/forum')).text, new RegExp(board.name));
  assert.match((await c.get(`/wap/forum/board/${board.id}`)).text, /手机论坛测试帖/);
  const thread = await c.get(`/wap/forum/thread/${tid}`);
  assert.equal(thread.status, 200);
  assert.match(thread.text, /登录/);

  t.createUser('手机回帖', 'pass123456');
  await c.login('手机回帖', 'pass123456');
  const reply = await c.post(`/wap/forum/thread/${tid}/reply`, { content: '手机回帖内容' });
  assert.equal(reply.status, 303);
  assert.equal(t.ctx.db.prepare('SELECT reply_count FROM forum_threads WHERE id = ?').get(tid).reply_count, 1);
  assert.match((await c.get(`/wap/forum/thread/${tid}`)).text, /手机回帖内容/);
  assert.equal((await c.get('/wap/forum/thread/999999')).status, 404);
});

test('WAP 聊天室：发言与限速', async () => {
  const t2 = await startApp({ DISABLE_RATE_LIMIT: '0' });
  try {
    t2.createUser('手机聊天', 'pass123456');
    const c = t2.client();
    assert.equal((await c.get('/wap/chat')).status, 200);
    const guestRoom = await c.get('/wap/chat/lobby');
    assert.match(guestRoom.text, /登录/);
    await c.login('手机聊天', 'pass123456');
    const s1 = await c.post('/wap/chat/lobby', { content: '手机上线啦 <script>' });
    assert.equal(s1.status, 303);
    const s2 = await c.post('/wap/chat/lobby', { content: '连发第二句' });
    assert.equal(s2.status, 429);
    assert.match(s2.text, /太快/);
    const room = await c.get('/wap/chat/lobby');
    assert.match(room.text, /手机上线啦 &lt;script&gt;/);
    assert.equal(t2.ctx.db.prepare("SELECT COUNT(*) AS n FROM chat_messages WHERE username = '手机聊天'").get().n, 1);
    assert.equal((await c.get('/wap/chat/nope')).status, 404);
  } finally {
    await t2.stop();
  }
});

test('WAP 我的小红书需登录，短消息不能越权查看', async () => {
  const anon = t.client();
  const my = await anon.get('/wap/my');
  assert.equal(my.status, 303);
  assert.equal(my.location, `/wap/login?next=${encodeURIComponent('/wap/my')}`);

  const aId = t.createUser('收信人', 'pass123456');
  t.createUser('偷看者', 'pass123456');
  const mid = Number(t.ctx.db.prepare("INSERT INTO messages (from_id, to_id, title, body) VALUES (NULL, ?, '手机系统通知', '看这篇 [url=/notes/1]笔记[/url]')").run(aId).lastInsertRowid);

  const spy = t.client();
  await spy.login('偷看者', 'pass123456');
  assert.equal((await spy.get(`/wap/pm/${mid}`)).status, 404);

  const owner = t.client();
  await owner.login('收信人', 'pass123456');
  const myPage = await owner.get('/wap/my');
  assert.equal(myPage.status, 200);
  assert.match(myPage.text, /1 条未读/);
  assert.match((await owner.get('/wap/pm')).text, /手机系统通知/);
  const view = await owner.get(`/wap/pm/${mid}`);
  assert.equal(view.status, 200);
  assert.match(view.text, /href="\/wap\/note\/1"/, '站内笔记链接改写为 WAP 地址');
  assert.ok(t.ctx.db.prepare('SELECT read_at FROM messages WHERE id = ?').get(mid).read_at);
});

test('WAP 相册、好物、404 模板', async () => {
  const c = t.client();
  const uid = t.ctx.db.prepare("SELECT id FROM users WHERE username = '手机作者'").get().id;
  const aid = Number(t.ctx.db.prepare("INSERT INTO albums (user_id, title) VALUES (?, '手机相册')").run(uid).lastInsertRowid);
  const pid = Number(t.ctx.db.prepare("INSERT INTO photos (album_id, user_id, path, size, caption) VALUES (?, ?, 'x/a.jpg', 12345, '手机照片')").run(aid, uid).lastInsertRowid);
  assert.match((await c.get('/wap/album')).text, /手机照片/);
  const photo = await c.get(`/wap/album/photo/${pid}`);
  assert.match(photo.text, /12KB/);
  assert.equal((await c.get(`/wap/album/a/${aid}`)).status, 200);

  const prod = Number(t.ctx.db.prepare("INSERT INTO products (name, price_cents, description) VALUES ('手机好物', 1990, '好用')").run().lastInsertRowid);
  assert.match((await c.get('/wap/shop')).text, /¥19\.9/);
  const detail = await c.get(`/wap/shop/${prod}`);
  assert.match(detail.text, new RegExp(`/shop/${prod}\\?pc=1`));

  const nf = await c.get('/wap/no-such-page');
  assert.equal(nf.status, 404);
  assert.match(nf.text, /wap\.css/);
  assert.ok(!nf.text.includes('site.css'));
});
