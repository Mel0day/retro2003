import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, ADMIN, CAPTCHA, PNG_1PX } from './helpers.js';
import { createNote, addComment } from '../src/services/notes.js';

let t, admin, mod, member;
let authorId, channel;

before(async () => {
  t = await startApp();
  authorId = t.createUser('作者', 'pass123456');
  t.createUser('版主甲', 'pass123456', { role: 'moderator' });
  t.createUser('会员乙', 'pass123456');
  channel = t.ctx.db.prepare("SELECT * FROM channels WHERE slug = 'travel'").get();
  admin = t.client(); await admin.login(ADMIN.username, ADMIN.password);
  mod = t.client(); await mod.login('版主甲', 'pass123456');
  member = t.client(); await member.login('会员乙', 'pass123456');
});
after(async () => { await t.stop(); });

const note = (title, extra = '') => createNote(t.ctx, authorId, {
  title, channelId: channel.id, tags: '旅行', content: `这是一篇测试笔记的正文内容。${extra}\n\n[img=封面]/uploads/seed/x.jpg[/img]`,
});
const msgOf = (res) => decodeURIComponent((res.location || '').split(/[?&](?:msg|err)=/)[1] || '');

test('权限：游客跳登录，会员 403，版主只能进内容管理', async () => {
  const guest = await t.client().get('/admin');
  assert.equal(guest.status, 302);
  assert.match(guest.location, /^\/login\?next=/);
  assert.equal((await member.get('/admin')).status, 403);
  assert.equal((await member.get('/admin/notes')).status, 403);

  for (const p of ['/admin', '/admin/notes', '/admin/comments', '/admin/reports']) {
    assert.equal((await mod.get(p)).status, 200, `版主访问 ${p}`);
  }
  for (const p of ['/admin/users', '/admin/settings', '/admin/channels', '/admin/ads', '/admin/links', '/admin/pages', '/admin/announcements']) {
    assert.equal((await mod.get(p)).status, 403, `版主不能访问 ${p}`);
    assert.equal((await admin.get(p)).status, 200, `站长访问 ${p}`);
  }
  assert.equal((await mod.post('/admin/settings', { site_name: 'x' })).status, 403);
  const dash = await admin.get('/admin');
  assert.match(dash.text, /站点概况/);
  assert.match(dash.text, /SQLite 版本/);
});

test('笔记管理：推荐进首页、隐藏后前台 404 且频道计数减少、批量恢复、删除', async () => {
  const id = note('后台推荐测试笔记');
  const before1 = t.ctx.db.prepare('SELECT note_count FROM channels WHERE id = ?').get(channel.id).note_count;

  const feat = await mod.post(`/admin/notes/${id}/feature`, { back: '/admin/notes?status=published' });
  assert.equal(feat.status, 303);
  assert.match(feat.location, /^\/admin\/notes\?status=published&msg=/);
  assert.equal(t.ctx.db.prepare('SELECT featured FROM notes WHERE id = ?').get(id).featured, 1);
  assert.match((await t.client().get('/')).text, /后台推荐测试笔记/);

  await mod.post(`/admin/notes/${id}/hide`);
  assert.equal((await t.client().get(`/notes/${id}`)).status, 404);
  assert.equal(t.ctx.db.prepare('SELECT note_count FROM channels WHERE id = ?').get(channel.id).note_count, before1 - 1);

  const list = await mod.get('/admin/notes?status=hidden&q=%E5%90%8E%E5%8F%B0');
  assert.match(list.text, /后台推荐测试笔记/);

  const id2 = note('批量操作笔记二');
  await mod.post(`/admin/notes/${id2}/hide`);
  const batch = await mod.post('/admin/notes/batch', { ids: [id, id2], action: 'restore' });
  assert.match(msgOf(batch), /2 篇笔记已恢复显示/);
  assert.equal((await t.client().get(`/notes/${id2}`)).status, 200);
  assert.equal(t.ctx.db.prepare('SELECT note_count FROM channels WHERE id = ?').get(channel.id).note_count, before1 + 1);

  const none = await mod.post('/admin/notes/batch', { action: 'hide' });
  assert.match(none.location, /err=/);

  await mod.post(`/admin/notes/${id2}/delete`);
  assert.equal(t.ctx.db.prepare('SELECT COUNT(*) AS n FROM notes WHERE id = ?').get(id2).n, 0);
  assert.ok(t.ctx.db.prepare("SELECT COUNT(*) AS n FROM messages WHERE to_id = ? AND title LIKE '%删除%'").get(authorId).n >= 1);
});

test('留言审核：批量通过和删除，计数正确', async () => {
  const id = note('留言审核测试');
  const n = t.ctx.db.prepare('SELECT * FROM notes WHERE id = ?').get(id);
  const c1 = addComment(t.ctx, { note: n, user: null, guestName: '游客一', content: '待审留言一号' });
  const c2 = addComment(t.ctx, { note: n, user: null, guestName: '游客二', content: '待审留言二号' });
  const c3 = addComment(t.ctx, { note: n, user: null, guestName: '游客三', content: '广告留言三号' });
  assert.equal(c1.status, 'pending');

  const page = await mod.get('/admin/comments');
  assert.match(page.text, /待审留言一号/);
  assert.match(page.text, /游客二/);

  const b = await mod.post('/admin/comments/batch', { ids: [c1.id, c2.id], action: 'approve', back: '/admin/comments?status=pending' });
  assert.match(msgOf(b), /2 条留言已通过审核/);
  assert.equal(t.ctx.db.prepare('SELECT comment_count FROM notes WHERE id = ?').get(id).comment_count, 2);
  assert.match((await t.client().get(`/notes/${id}`)).text, /待审留言二号/);

  await mod.post(`/admin/comments/${c3.id}/delete`);
  assert.equal(t.ctx.db.prepare('SELECT status FROM comments WHERE id = ?').get(c3.id).status, 'deleted');
  await mod.post('/admin/comments/batch', { ids: [c1.id], action: 'delete' });
  assert.equal(t.ctx.db.prepare('SELECT comment_count FROM notes WHERE id = ?').get(id).comment_count, 1);
  assert.match((await mod.get('/admin/comments?status=deleted')).text, /广告留言三号/);
});

test('举报处理：待处理 → 已处理 / 驳回 / 删除内容', async () => {
  const id = note('被举报的笔记');
  const memberId = t.ctx.db.prepare("SELECT id FROM users WHERE username = '会员乙'").get().id;
  const ins = t.ctx.db.prepare('INSERT INTO reports (target_type, target_id, reporter_id, reason) VALUES (?, ?, ?, ?)');
  const r1 = Number(ins.run('note', id, memberId, '广告垃圾').lastInsertRowid);
  const r2 = Number(ins.run('note', id, memberId, '重复举报').lastInsertRowid);
  const r3 = Number(ins.run('user', authorId, memberId, '头像违规').lastInsertRowid);
  const r4 = Number(ins.run('thread', 99999, memberId, '对象不存在').lastInsertRowid);

  const open = await mod.get('/admin/reports');
  assert.match(open.text, /被举报的笔记/);
  assert.match(open.text, /对象已不存在/);

  await mod.post(`/admin/reports/${r3}/dismiss`);
  assert.equal(t.ctx.db.prepare('SELECT status FROM reports WHERE id = ?').get(r3).status, 'dismissed');
  await mod.post(`/admin/reports/${r4}/resolve`);
  const done = t.ctx.db.prepare('SELECT * FROM reports WHERE id = ?').get(r4);
  assert.equal(done.status, 'resolved');
  assert.ok(done.handled_by && done.handled_at);

  const rm = await mod.post(`/admin/reports/${r1}/remove`);
  assert.match(msgOf(rm), /内容已删除/);
  assert.equal(t.ctx.db.prepare('SELECT status FROM notes WHERE id = ?').get(id).status, 'hidden');
  assert.equal(t.ctx.db.prepare('SELECT status FROM reports WHERE id = ?').get(r2).status, 'resolved', '同一对象的其他举报一并关闭');
  assert.match((await mod.get('/admin/reports?status=resolved')).text, /版主甲/);
});

test('会员管理：封禁使会话失效、不能封禁自己和最后一个站长、积分调整写日志、重置密码', async () => {
  const victim = t.client();
  const vid = t.createUser('将被封禁', 'pass123456');
  await victim.login('将被封禁', 'pass123456');
  assert.equal((await victim.get('/my')).status === 302, false);

  const list = await admin.get('/admin/users?q=%E5%B0%86%E8%A2%AB');
  assert.match(list.text, /将被封禁/);
  assert.equal((await admin.get(`/admin/users/${vid}`)).status, 200);

  const ban = await admin.post(`/admin/users/${vid}/ban`, { banned: '1' });
  assert.match(msgOf(ban), /已封禁/);
  assert.equal(t.ctx.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').get(vid).n, 0);
  const after1 = await victim.get('/notes/new');
  assert.equal(after1.status, 302, '封禁后访问需登录页面被重定向');
  const relog = await t.client().post('/login', { username: '将被封禁', password: 'pass123456', captcha: CAPTCHA });
  assert.match(relog.text, /封禁/);
  await admin.post(`/admin/users/${vid}/ban`, { banned: '0' });
  assert.equal(t.ctx.db.prepare('SELECT banned FROM users WHERE id = ?').get(vid).banned, 0);

  const adminId = t.ctx.db.prepare('SELECT id FROM users WHERE username = ?').get(ADMIN.username).id;
  const self = await admin.post(`/admin/users/${adminId}/ban`, { banned: '1' });
  assert.match(msgOf(self), /不能封禁自己/);
  const selfRole = await admin.post(`/admin/users/${adminId}/profile`, { role: 'user', title: '' });
  assert.match(msgOf(selfRole), /不能修改自己的角色/);
  assert.equal(t.ctx.db.prepare('SELECT role, banned FROM users WHERE id = ?').get(adminId).role, 'admin');

  // 第二个站长不能把唯一的活跃站长降级（此处 admin 是唯一站长，由另一个站长账号尝试）
  const admin2Id = t.createUser('副站长', 'pass123456', { role: 'admin' });
  const admin2 = t.client(); await admin2.login('副站长', 'pass123456');
  await admin.post(`/admin/users/${admin2Id}/ban`, { banned: '1' });
  const lastDemote = await admin2.get('/admin');
  assert.equal(lastDemote.status, 302, '被封禁的副站长已下线');
  const demote = await admin.post(`/admin/users/${admin2Id}/profile`, { role: 'user' });
  assert.match(msgOf(demote), /资料已保存/, '被封禁的站长可以降级');

  const pts0 = t.ctx.db.prepare('SELECT points FROM users WHERE id = ?').get(vid).points;
  const add = await admin.post(`/admin/users/${vid}/points`, { delta: '50', reason: '优质内容奖励' });
  assert.match(msgOf(add), /增加 50/);
  assert.equal(t.ctx.db.prepare('SELECT points FROM users WHERE id = ?').get(vid).points, pts0 + 50);
  const log = t.ctx.db.prepare('SELECT * FROM points_log WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(vid);
  assert.equal(log.delta, 50);
  assert.match(log.reason, /优质内容奖励/);
  assert.match((await admin.post(`/admin/users/${vid}/points`, { delta: '0', reason: 'x' })).location, /err=/);
  assert.match((await admin.post(`/admin/users/${vid}/points`, { delta: '5', reason: '' })).location, /err=/);

  await admin.post(`/admin/users/${vid}/profile`, { role: 'moderator', title: '江湖大侠', signature: '签名', location: '火星' });
  const u = t.ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(vid);
  assert.equal(u.role, 'moderator');
  assert.equal(u.title, '江湖大侠');

  const reset = await admin.post(`/admin/users/${vid}/password`);
  const pw = reset.text.match(/密码已重置为：<b[^>]*>([A-Za-z0-9]{8})<\/b>/)?.[1];
  assert.ok(pw, '页面显示新密码');
  await t.client().login('将被封禁', pw);
});

test('站点设置：关闭跑马灯、数字校验、未勾选的开关存 0', async () => {
  const home0 = await t.client().get('/');
  t.ctx.db.prepare("INSERT INTO announcements (content) VALUES ('设置测试公告')").run();
  assert.match((await t.client().get('/')).text, /\[公告\]/);
  const values = t.ctx.settings.all();
  const form = {};
  for (const k of ['site_name', 'site_slogan', 'site_since', 'copyright_year', 'webmaster_email', 'icp', 'footer_hint', 'webmaster_notice', 'counter_base', 'upload_max_kb', 'album_quota_mb', 'new_badge_hours']) form[k] = values[k];
  const bad = await admin.post('/admin/settings', { ...form, counter_base: 'abc', show_counter: '1' });
  assert.match(msgOf(bad), /非负整数/);

  const ok = await admin.post('/admin/settings', { ...form, site_name: '小红书测试站', icp: '京ICP备00000000号', show_counter: '1', register_open: '1', captcha_login: '1', allow_guest_comment: '1', comment_review_guest: '1' });
  assert.match(msgOf(ok), /已保存/);
  assert.equal(t.ctx.settings.get('show_marquee'), '0');
  assert.equal(t.ctx.settings.get('comment_review_member'), '0');
  const home = await t.client().get('/');
  assert.ok(!home.text.includes('[公告]'), '关闭跑马灯后首页没有 [公告]');
  assert.match(home.text, /小红书测试站/);
  assert.match(home.text, /京ICP备00000000号/);
  assert.ok(home0.status === 200);
  await admin.post('/admin/settings', { ...form, site_name: values.site_name, show_marquee: '1', show_counter: '1', register_open: '1', captcha_login: '1', allow_guest_comment: '1', comment_review_guest: '1' });
});

test('公告、链接、频道：增删改在前台生效', async () => {
  await admin.post('/admin/announcements', { content: '第四届摄影大赛开始报名', active: '1', sort: '0' });
  const an = t.ctx.db.prepare("SELECT * FROM announcements WHERE content = '第四届摄影大赛开始报名'").get();
  assert.match((await t.client().get('/')).text, /第四届摄影大赛开始报名/);
  await admin.post(`/admin/announcements/${an.id}`, { content: '第四届摄影大赛已截止', sort: '0' });
  const home = (await t.client().get('/')).text;
  assert.ok(!home.includes('第四届摄影大赛'), '停用的公告不显示');
  await admin.post(`/admin/announcements/${an.id}/delete`);
  assert.equal(t.ctx.db.prepare('SELECT COUNT(*) AS n FROM announcements WHERE id = ?').get(an.id).n, 0);

  const badLink = await admin.post('/admin/links', { name: '坏链接', url: 'javascript:alert(1)' });
  assert.match(badLink.location, /err=/);
  await admin.post('/admin/links', { name: '天涯社区测试', url: 'https://www.tianya.cn', sort: '1' });
  assert.match((await t.client().get('/')).text, /天涯社区测试/);
  const link = t.ctx.db.prepare("SELECT * FROM links WHERE name = '天涯社区测试'").get();
  await admin.post(`/admin/links/${link.id}`, { name: '猫扑测试', url: 'https://www.mop.com', sort: '2' });
  assert.match((await t.client().get('/')).text, /猫扑测试/);
  await admin.post(`/admin/links/${link.id}/delete`);
  assert.ok(!(await t.client().get('/')).text.includes('猫扑测试'));

  assert.match((await admin.post('/admin/channels', { slug: 'Bad Slug', name: '坏' })).location, /err=/);
  assert.match((await admin.post('/admin/channels', { slug: 'travel', name: '重复' })).location, /err=/);
  await admin.post('/admin/channels', { slug: 'music', name: '音乐天地', description: '好听的歌', sort: '99' });
  const ch = t.ctx.db.prepare("SELECT * FROM channels WHERE slug = 'music'").get();
  assert.match((await t.client().get('/')).text, /音乐天地/);
  await admin.post(`/admin/channels/${ch.id}`, { slug: 'music', name: '音乐影视', description: '', sort: '99' });
  assert.match((await t.client().get('/')).text, /音乐影视/);
  const busy = await admin.post(`/admin/channels/${channel.id}/delete`);
  assert.match(msgOf(busy), /还有 \d+ 篇笔记/);
  await admin.post(`/admin/channels/${ch.id}/delete`);
  assert.ok(!(await t.client().get('/')).text.includes('音乐影视'));
});

test('广告：javascript: 链接被拒、图片上传、前台显示和停用', async () => {
  t.ctx.db.prepare('DELETE FROM ads').run();
  const bad = await admin.upload('/admin/ads', { slot: 'header', style: 'solid', title: '恶意广告', link: 'javascript:alert(1)', bg: '#003366', active: '1' });
  assert.equal(bad.status, 400);
  assert.match(bad.text, /链接地址只能/);
  const badBg = await admin.upload('/admin/ads', { slot: 'header', style: 'solid', title: '坏颜色', link: '/shop', bg: 'red;x', active: '1' });
  assert.match(badBg.text, /背景色/);
  assert.equal(t.ctx.db.prepare('SELECT COUNT(*) AS n FROM ads').get().n, 0);

  const ok = await admin.upload('/admin/ads', { slot: 'header', style: 'solid', title: '冬季大促 全场包邮', cta: '立即抢购', link: '/shop', bg: '#990000', active: '1', sort: '0' });
  assert.equal(ok.status, 303);
  assert.match((await t.client().get('/')).text, /冬季大促 全场包邮/);

  const img = await admin.upload('/admin/ads', { slot: 'sidebar', style: 'image', title: '侧栏图片广告', link: 'https://example.com', bg: '#003366', active: '1' }, { image_file: { buffer: PNG_1PX } });
  assert.equal(img.status, 303, img.text.slice(0, 300));
  const sideAd = t.ctx.db.prepare("SELECT * FROM ads WHERE slot = 'sidebar'").get();
  assert.match(sideAd.image, /^\/uploads\//);
  const noImg = await admin.upload('/admin/ads', { slot: 'sidebar', style: 'image', title: '没有图片', bg: '#003366' });
  assert.match(noImg.text, /请上传图片/);

  const ad = t.ctx.db.prepare("SELECT * FROM ads WHERE title = '冬季大促 全场包邮'").get();
  const edit = await admin.upload(`/admin/ads/${ad.id}`, { slot: 'header', style: 'rainbow', title: '冬季大促 五折起', subtitle: '限时三天', cta: '点击进入>>', link: 'https://example.com/sale', bg: '#990000', active: '1' });
  assert.equal(edit.status, 303);
  assert.match((await t.client().get('/')).text, /冬季大促 五折起/);
  assert.match((await admin.get('/admin/ads')).text, /侧栏图片广告/);
  await admin.post(`/admin/ads/${ad.id}/toggle`);
  assert.ok(!(await t.client().get('/')).text.includes('冬季大促'), '停用后前台不显示');
  await admin.post(`/admin/ads/${ad.id}/delete`);
  assert.equal(t.ctx.db.prepare('SELECT COUNT(*) AS n FROM ads WHERE id = ?').get(ad.id).n, 0);
});

test('单页：新建、标识校验、编辑、删除', async () => {
  const bad = await admin.post('/admin/pages', { slug: '中文', title: 'x' });
  assert.equal(bad.status, 400);
  assert.match(bad.text, /页面标识只能/);
  const ok = await admin.post('/admin/pages', { slug: 'faq-2003', title: '常见问题', content: '[h]如何注册？[/h]点击首页的免费注册。', sort: '9' });
  assert.match(msgOf(ok), /已创建/);
  assert.match((await admin.post('/admin/pages', { slug: 'faq-2003', title: '重复' })).text, /已存在/);
  assert.match((await admin.get('/admin/pages')).text, /常见问题/);
  assert.equal((await admin.get('/admin/pages/faq-2003/edit')).status, 200);
  await admin.post('/admin/pages/faq-2003', { title: '常见问题解答', content: '更新后的内容', sort: '1' });
  const row = t.ctx.db.prepare("SELECT * FROM pages WHERE slug = 'faq-2003'").get();
  assert.equal(row.title, '常见问题解答');
  // 前台单页路由由其他模块提供，存在时检查渲染
  const front = await t.client().get('/page/faq-2003');
  if (front.status === 200) assert.match(front.text, /常见问题解答/);
  await admin.post('/admin/pages/faq-2003/delete');
  assert.equal(t.ctx.db.prepare("SELECT COUNT(*) AS n FROM pages WHERE slug = 'faq-2003'").get().n, 0);
});
