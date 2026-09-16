import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, ADMIN } from './helpers.js';

let t;
before(async () => { t = await startApp(); });
after(async () => { await t.stop(); });

const loginAs = async (app, name, pw = 'pass123456') => { const c = app.client(); await c.login(name, pw); return c; };

// 读取 SSE 流直到满足条件
async function openStream(app, client, slug) {
  const ctrl = new AbortController();
  const res = await fetch(`${app.base}/api/chat/${slug}/stream`, { headers: { cookie: client.cookieHeader() }, signal: ctrl.signal });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  return {
    res,
    async until(pred, ms = 3000) {
      const deadline = Date.now() + ms;
      while (!pred(buf)) {
        const left = deadline - Date.now();
        if (left <= 0) throw new Error(`SSE 等待超时，已收到：${buf.slice(-300)}`);
        const chunk = await Promise.race([reader.read(), new Promise((r) => setTimeout(() => r({ timeout: true }), left))]);
        if (chunk.timeout) continue;
        if (chunk.done) throw new Error('SSE 流提前结束');
        buf += dec.decode(chunk.value, { stream: true });
      }
      return buf;
    },
    close() { ctrl.abort(); reader.cancel().catch(() => {}); },
  };
}

test('聊天室列表和房间页', async () => {
  const g = t.client();
  const list = await g.get('/chat');
  assert.equal(list.status, 200);
  assert.match(list.text, /大厅/);
  const room = await g.get('/chat/lobby');
  assert.equal(room.status, 200);
  assert.match(room.text, /游客只能旁观/);
  assert.equal((await g.get('/chat/no-such-room')).status, 404);
});

test('发言：游客 401、会员成功、颜色和动作白名单、内容校验', async () => {
  const g = t.client();
  const guest = await g.api('/api/chat/lobby/send', { content: '你好' });
  assert.equal(guest.status, 401);

  t.createUser('聊天君');
  const c = await loginAs(t, '聊天君');
  assert.match((await c.get('/chat/lobby')).text, /chat-form/);

  const ok = await c.api('/api/chat/lobby/send', { content: '大家好 <b>hi</b>', color: '#cc0000', action: '微笑着', to: '小雨' });
  assert.equal(ok.json.ok, true);
  assert.equal(ok.json.message.color, '#cc0000');
  assert.equal(ok.json.message.action, '微笑着');
  assert.equal(ok.json.message.to_name, '小雨');
  assert.equal(ok.json.message.content, '大家好 <b>hi</b>', '接口原样返回纯文本，由前端 textContent 渲染');

  const evil = await c.api('/api/chat/lobby/send', { content: '换个颜色', color: 'red;background:url(x)', action: '<script>' });
  assert.equal(evil.json.message.color, '#000000');
  assert.equal(evil.json.message.action, '');

  assert.equal((await c.api('/api/chat/lobby/send', { content: '   ' })).status, 400);
  assert.equal((await c.api('/api/chat/lobby/send', { content: '长'.repeat(201) })).status, 400);
  assert.equal((await c.api('/api/chat/nope/send', { content: 'x' })).status, 404);

  // 服务端渲染房间页时做了转义
  const page = await t.client().get('/chat/lobby');
  assert.ok(page.text.includes('大家好 &lt;b&gt;hi&lt;/b&gt;'));
  assert.ok(!page.text.includes('<b>hi</b>'));
});

test('after 参数只返回更新的消息', async () => {
  t.createUser('补拉君');
  const c = await loginAs(t, '补拉君');
  const first = await c.api('/api/chat/travel/send', { content: '第一句' });
  const firstId = first.json.message.id;
  const second = await c.api('/api/chat/travel/send', { content: '第二句' });
  const res = await c.get(`/api/chat/travel/messages?after=${firstId}`);
  assert.equal(res.json.ok, true);
  assert.deepEqual(res.json.messages.map((m) => m.content), ['第二句']);
  assert.equal(res.json.messages[0].id, second.json.message.id);
  const all = await t.client().get('/api/chat/travel/messages');
  assert.ok(all.json.messages.length >= 2);
  assert.ok(all.json.presence);
});

test('SSE：会员进入推送欢迎语，能实时收到别人的消息和在线名单', async () => {
  t.createUser('监听君');
  t.createUser('说话君');
  const listener = await loginAs(t, '监听君');
  const speaker = await loginAs(t, '说话君');
  const stream = await openStream(t, listener, 'digital');
  try {
    assert.match(stream.res.headers.get('content-type'), /text\/event-stream/);
    assert.equal(stream.res.headers.get('x-accel-buffering'), 'no');
    await stream.until((b) => b.includes('欢迎 监听君 进入聊天室'));
    await stream.until((b) => b.includes('event: presence') && b.includes('监听君'));
    const sent = await speaker.api('/api/chat/digital/send', { content: 'SSE 测试消息' });
    assert.equal(sent.json.ok, true);
    const buf = await stream.until((b) => b.includes('SSE 测试消息'));
    assert.match(buf, /event: message/);
    // 游客连接会计入在线名单的游客数
    const guestStream = await openStream(t, t.client(), 'digital');
    await stream.until((b) => /"guests":1/.test(b));
    guestStream.close();
  } finally {
    stream.close();
  }
});

test('限速：1.5 秒内连续发言被拒绝', async () => {
  const app = await startApp({ DISABLE_RATE_LIMIT: '0' });
  try {
    app.createUser('刷屏君');
    const c = await loginAs(app, '刷屏君');
    assert.equal((await c.api('/api/chat/lobby/send', { content: '一' })).json.ok, true);
    const second = await c.api('/api/chat/lobby/send', { content: '二' });
    assert.equal(second.status, 429);
  } finally {
    await app.stop();
  }
});

test('后台聊天室管理：仅站长可用，增改清空删除', async () => {
  t.createUser('版主君', 'pass123456', { role: 'moderator' });
  const mod = await loginAs(t, '版主君');
  assert.equal((await mod.get('/admin/chat')).status, 403);

  const admin = await loginAs(t, ADMIN.username, ADMIN.password);
  assert.equal((await admin.get('/admin/chat')).status, 200);

  const bad = await admin.post('/admin/chat/rooms', { slug: 'Bad Slug!', name: '坏', topic: '' });
  assert.match(bad.location, /err=/);
  const add = await admin.post('/admin/chat/rooms', { slug: 'music', name: '音乐', topic: '听歌聊歌', sort: '9' });
  assert.match(add.location, /msg=/);
  const dup = await admin.post('/admin/chat/rooms', { slug: 'music', name: '音乐2', topic: '' });
  assert.match(decodeURIComponent(dup.location), /已存在/);
  const room = t.ctx.db.prepare("SELECT * FROM chat_rooms WHERE slug = 'music'").get();
  assert.equal((await t.client().get('/chat/music')).status, 200);

  await admin.post(`/admin/chat/rooms/${room.id}`, { slug: 'music', name: '音乐厅', topic: '新话题', sort: '1' });
  assert.equal(t.ctx.db.prepare('SELECT name FROM chat_rooms WHERE id = ?').get(room.id).name, '音乐厅');

  await admin.api('/api/chat/music/send', { content: '要被清空的消息' });
  await admin.post(`/admin/chat/rooms/${room.id}/clear`);
  assert.equal(t.ctx.db.prepare('SELECT COUNT(*) AS n FROM chat_messages WHERE room_id = ?').get(room.id).n, 0);

  assert.equal((await mod.post(`/admin/chat/rooms/${room.id}/delete`)).status, 403);
  await admin.post(`/admin/chat/rooms/${room.id}/delete`);
  assert.equal((await t.client().get('/chat/music')).status, 404);
});
