import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startApp, ADMIN, PNG_1PX } from './helpers.js';

let t;
before(async () => {
  t = await startApp();
  t.createUser('相册主人', 'pass123456');
  t.createUser('路人', 'pass123456');
});
after(async () => { await t.stop(); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('相册首页和个人相册页可访问', async () => {
  const c = t.client();
  assert.equal((await c.get('/album')).status, 200);
  const r = await c.get('/album/my');
  assert.equal(r.status, 302);
  assert.match(r.location, /^\/login/);
});

test('建相册、上传、设封面、改说明、删照片与文件、他人无权操作、删相册', async () => {
  const owner = t.client();
  await owner.login('相册主人', 'pass123456');
  assert.equal((await owner.get('/album/my')).status, 200);

  const bad = await owner.post('/album/create', { title: '' });
  assert.equal(bad.status, 400);
  const created = await owner.post('/album/create', { title: '周末扫街', description: '随手拍' });
  assert.match(created.text, /创建成功/);
  const album = t.ctx.db.prepare("SELECT * FROM albums WHERE title = '周末扫街'").get();
  assert.ok(album);

  // 两次上传（fetch 方式返回 JSON）
  const up1 = await owner.upload(`/album/${album.id}/upload`, {}, { photos: { buffer: PNG_1PX, name: 'first.png' } });
  assert.equal(up1.json.ok, true, up1.text);
  const up2 = await owner.upload(`/album/${album.id}/upload`, {}, { photos: { buffer: PNG_1PX, name: 'second.png' } });
  assert.equal(up2.json.saved, 1);
  let a = t.ctx.db.prepare('SELECT * FROM albums WHERE id = ?').get(album.id);
  assert.equal(a.photo_count, 2);
  const photos = t.ctx.db.prepare('SELECT * FROM photos WHERE album_id = ? ORDER BY id').all(album.id);
  assert.equal(a.cover, `/uploads/${photos[0].path}`, '第一张自动成为封面');
  assert.equal(photos[0].caption, 'first');
  assert.ok(photos[0].upload_id);

  // 非图片被拒
  const notImage = await owner.upload(`/album/${album.id}/upload`, {}, { photos: { buffer: Buffer.from('hello world, not an image'), name: 'x.png' } });
  assert.equal(notImage.status, 400);

  // 页面展示
  const view = await t.client().get(`/album/${album.id}`);
  assert.equal(view.status, 200);
  assert.match(view.text, /周末扫街/);
  const photoPage = await t.client().get(`/album/photo/${photos[1].id}`);
  assert.equal(photoPage.status, 200);
  assert.match(photoPage.text, /上一张/);
  assert.match(photoPage.text, /type=photo/);

  // 他人不能上传、删除、设封面、改相册
  const stranger = t.client();
  await stranger.login('路人', 'pass123456');
  assert.equal((await stranger.upload(`/album/${album.id}/upload`, {}, { photos: { buffer: PNG_1PX } })).status, 403);
  assert.equal((await stranger.api(`/album/photo/${photos[0].id}/delete`)).status, 403);
  assert.equal((await stranger.post(`/album/photo/${photos[0].id}/cover`)).status, 403);
  assert.equal((await stranger.post(`/album/${album.id}/edit`, { title: '被改了' })).status, 403);
  assert.equal((await stranger.post(`/album/${album.id}/delete`)).status, 403);
  assert.equal(t.ctx.db.prepare('SELECT COUNT(*) AS n FROM photos WHERE album_id = ?').get(album.id).n, 2);

  // 设封面、改说明
  assert.equal((await owner.api(`/album/photo/${photos[1].id}/cover`)).json.ok, true);
  a = t.ctx.db.prepare('SELECT * FROM albums WHERE id = ?').get(album.id);
  assert.equal(a.cover, `/uploads/${photos[1].path}`);
  await owner.post(`/album/photo/${photos[1].id}/edit`, { caption: '夕阳下的老街' });
  assert.equal(t.ctx.db.prepare('SELECT caption FROM photos WHERE id = ?').get(photos[1].id).caption, '夕阳下的老街');
  await owner.post(`/album/${album.id}/edit`, { title: '周末扫街（改）', description: '新描述' });
  assert.equal(t.ctx.db.prepare('SELECT title FROM albums WHERE id = ?').get(album.id).title, '周末扫街（改）');

  // 删除封面照片：计数减少、文件被删、封面回落到剩下的照片
  const file1 = path.join(t.ctx.config.uploadDir, photos[1].path);
  assert.ok(fs.existsSync(file1));
  assert.equal((await owner.api(`/album/photo/${photos[1].id}/delete`)).json.ok, true);
  await sleep(100);
  assert.ok(!fs.existsSync(file1), '照片文件已删除');
  assert.ok(!t.ctx.db.prepare('SELECT 1 FROM uploads WHERE id = ?').get(photos[1].upload_id));
  a = t.ctx.db.prepare('SELECT * FROM albums WHERE id = ?').get(album.id);
  assert.equal(a.photo_count, 1);
  assert.equal(a.cover, `/uploads/${photos[0].path}`);
  assert.equal((await t.client().get(`/album/photo/${photos[1].id}`)).status, 404);

  // 删除整个相册
  const file0 = path.join(t.ctx.config.uploadDir, photos[0].path);
  const delAlbum = await owner.post(`/album/${album.id}/delete`);
  assert.match(delAlbum.text, /删除成功/);
  await sleep(100);
  assert.ok(!fs.existsSync(file0));
  assert.equal(t.ctx.db.prepare('SELECT COUNT(*) AS n FROM photos WHERE album_id = ?').get(album.id).n, 0);
  assert.equal((await owner.get(`/album/${album.id}`)).status, 404);
});

test('相册空间配额用完时拒绝上传；版主可以删除违规照片', async () => {
  const owner = t.client();
  await owner.login('相册主人', 'pass123456');
  await owner.post('/album/create', { title: '配额测试' });
  const album = t.ctx.db.prepare("SELECT * FROM albums WHERE title = '配额测试'").get();

  t.ctx.settings.set('album_quota_mb', '0');
  const res = await owner.upload(`/album/${album.id}/upload`, {}, { photos: { buffer: PNG_1PX } });
  assert.equal(res.status, 400);
  assert.match(res.json.error, /空间不足/);
  assert.equal(t.ctx.db.prepare('SELECT COUNT(*) AS n FROM photos WHERE album_id = ?').get(album.id).n, 0);

  t.ctx.settings.set('album_quota_mb', '20');
  const ok = await owner.upload(`/album/${album.id}/upload`, {}, { photos: { buffer: PNG_1PX } });
  assert.equal(ok.json.ok, true);
  const photo = t.ctx.db.prepare('SELECT * FROM photos WHERE album_id = ?').get(album.id);

  // 普通表单提交（非 fetch）也能用
  const form = await owner.request('POST', `/album/${album.id}/upload?_csrf=${owner.csrf}`, {
    body: (() => { const fd = new FormData(); fd.append('photos', new Blob([PNG_1PX], { type: 'image/png' }), 'c.png'); return fd; })(),
  });
  assert.equal(form.status, 200);
  assert.match(form.text, /上传成功/);

  const admin = t.client();
  await admin.login(ADMIN.username, ADMIN.password);
  const del = await admin.api(`/album/photo/${photo.id}/delete`);
  assert.equal(del.json.ok, true);
  assert.equal(t.ctx.db.prepare('SELECT photo_count FROM albums WHERE id = ?').get(album.id).photo_count, 1);
});
