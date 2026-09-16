import express from 'express';
import * as album from '../services/album.js';
import { requireLogin, isMod } from '../services/auth.js';
import { paginate } from '../lib/pager.js';
import { memoryUpload, UploadError } from '../lib/uploads.js';
import { httpError, intParam, wantsJson } from '../lib/http.js';
import { RANK_BG } from '../services/portal.js';

const WALL_PER_PAGE = 20;
const ALBUM_PER_PAGE = 20;

export default function albumRoutes(ctx) {
  const r = express.Router();
  const { db, limiter } = ctx;

  const sidebar = () => ({
    hotAlbums: db.prepare(`SELECT a.id, a.title, a.hits, u.username FROM albums a JOIN users u ON u.id = a.user_id
      WHERE a.photo_count > 0 ORDER BY a.hits DESC, a.id DESC LIMIT 8`).all()
      .map((a, i) => ({ ...a, rank: i + 1, bg: RANK_BG[Math.min(i, 2)], url: `/album/${a.id}` })),
    members: db.prepare(`SELECT u.id, u.username, COUNT(a.id) AS albums, SUM(a.photo_count) AS photos, MAX(a.updated_at) AS last
      FROM albums a JOIN users u ON u.id = a.user_id GROUP BY u.id ORDER BY last DESC LIMIT 12`).all(),
  });

  // ---------- 照片墙 ----------
  r.get('/album', (req, res) => {
    const total = db.prepare('SELECT COUNT(*) AS n FROM photos').get().n;
    const pager = paginate({ total, page: req.query.page, perPage: WALL_PER_PAGE, baseUrl: '/album' });
    const photos = db.prepare(`SELECT p.id, p.path, p.caption, p.size, p.hits, a.id AS album_id, a.title AS album_title, u.id AS user_id, u.username
      FROM photos p JOIN albums a ON a.id = p.album_id JOIN users u ON u.id = a.user_id
      ORDER BY p.created_at DESC, p.id DESC LIMIT ? OFFSET ?`).all(WALL_PER_PAGE, pager.offset);
    const latestAlbums = db.prepare(`SELECT a.*, u.username FROM albums a JOIN users u ON u.id = a.user_id
      WHERE a.photo_count > 0 ORDER BY a.updated_at DESC, a.id DESC LIMIT 5`).all();
    res.render('album/index.njk', {
      title: '相册', nav: 'album', crumbs: [['相册']],
      photos, pager, latestAlbums, ...sidebar(),
      stats: {
        albums: db.prepare('SELECT COUNT(*) AS n FROM albums').get().n,
        photos: total,
      },
      quotaMb: ctx.settings.int('album_quota_mb'),
    });
  });

  // ---------- 我的相册 ----------
  r.get('/album/my', requireLogin, (req, res) => {
    const albums = db.prepare('SELECT * FROM albums WHERE user_id = ? ORDER BY updated_at DESC, id DESC').all(req.user.id);
    res.render('album/my.njk', {
      title: '我的相册', panelNav: 'album', crumbs: [['控制面板', '/my'], ['我的相册']],
      albums, quota: album.quotaInfo(ctx, req.user.id), form: {},
    });
  });

  r.post('/album/create', requireLogin, (req, res) => {
    if (!limiter.check(`album-create:${req.user.id}`, 20, 3600_000)) {
      return res.message({ title: '创建失败', text: '操作太频繁了，请稍后再试', ok: false, status: 429 });
    }
    try {
      const id = album.createAlbum(ctx, req.user, req.body);
      res.message({ title: '创建成功', text: '相册创建成功，快去上传照片吧！', redirect: `/album/${id}` });
    } catch (e) {
      if (!(e instanceof album.ValidationError)) throw e;
      res.message({ title: '创建失败', text: e.message, ok: false, status: 400 });
    }
  });

  // ---------- 某会员的相册 ----------
  r.get('/album/user/:uid', (req, res) => {
    const owner = db.prepare('SELECT id, username, avatar_color, avatar_path FROM users WHERE id = ?').get(intParam(req.params.uid));
    if (!owner) throw httpError(404, '会员不存在');
    const albums = db.prepare('SELECT * FROM albums WHERE user_id = ? ORDER BY updated_at DESC, id DESC').all(owner.id);
    res.render('album/user.njk', {
      title: `${owner.username} 的相册`, nav: 'album', crumbs: [['相册', '/album'], [`${owner.username} 的相册`]],
      owner, albums, isOwner: req.user?.id === owner.id, ...sidebar(),
    });
  });

  // ---------- 照片 ----------
  const loadPhoto = (req) => {
    const p = album.getPhoto(ctx, intParam(req.params.id));
    if (!p) throw httpError(404, '照片不存在或已被删除');
    return p;
  };
  const ownPhoto = (req) => {
    const p = loadPhoto(req);
    if (!(req.user && (req.user.id === p.owner_id || isMod(req.user)))) throw httpError(403, '只能管理自己的照片');
    return p;
  };

  r.get('/album/photo/:id', (req, res) => {
    const photo = loadPhoto(req);
    if (ctx.countHit?.('photos', photo.id, req.vid)) photo.hits += 1;
    const prev = db.prepare('SELECT id FROM photos WHERE album_id = ? AND id < ? ORDER BY id DESC LIMIT 1').get(photo.album_id, photo.id);
    const next = db.prepare('SELECT id FROM photos WHERE album_id = ? AND id > ? ORDER BY id ASC LIMIT 1').get(photo.album_id, photo.id);
    const index = db.prepare('SELECT COUNT(*) AS n FROM photos WHERE album_id = ? AND id <= ?').get(photo.album_id, photo.id).n;
    const total = db.prepare('SELECT COUNT(*) AS n FROM photos WHERE album_id = ?').get(photo.album_id).n;
    const strip = db.prepare(`SELECT id, path FROM photos WHERE album_id = ? ORDER BY ABS(id - ?) , id LIMIT 7`).all(photo.album_id, photo.id)
      .sort((a, b) => a.id - b.id);
    res.render('album/photo.njk', {
      title: photo.caption || photo.album_title, nav: 'album',
      crumbs: [['相册', '/album'], [`${photo.username} 的相册`, `/album/user/${photo.owner_id}`], [photo.album_title, `/album/${photo.album_id}`], ['照片']],
      photo, prev, next, index, total, strip,
      canManage: !!(req.user && (req.user.id === photo.owner_id || isMod(req.user))),
      isCover: photo.album_cover === album.photoUrl(photo),
    });
  });

  r.post('/album/photo/:id/edit', requireLogin, (req, res) => {
    const photo = ownPhoto(req);
    try {
      album.updateCaption(ctx, photo, req.body.caption);
      res.message({ title: '保存成功', text: '照片说明已更新。', redirect: `/album/photo/${photo.id}` });
    } catch (e) {
      if (!(e instanceof album.ValidationError)) throw e;
      res.message({ title: '保存失败', text: e.message, ok: false, status: 400 });
    }
  });

  r.post('/album/photo/:id/cover', requireLogin, (req, res) => {
    const photo = ownPhoto(req);
    album.setCover(ctx, photo);
    if (wantsJson(req)) return res.json({ ok: true, message: '已设为相册封面', reload: true });
    res.message({ title: '设置成功', text: '已设为相册封面。', redirect: `/album/${photo.album_id}` });
  });

  r.post('/album/photo/:id/delete', requireLogin, (req, res) => {
    const photo = ownPhoto(req);
    album.deletePhoto(ctx, photo);
    if (wantsJson(req)) return res.json({ ok: true, reload: true });
    res.message({ title: '删除成功', text: '照片已删除。', redirect: `/album/${photo.album_id}` });
  });

  // ---------- 相册 ----------
  const loadAlbum = (req) => {
    const a = album.getAlbum(ctx, intParam(req.params.id));
    if (!a) throw httpError(404, '相册不存在或已被删除');
    return a;
  };
  const ownAlbum = (req) => {
    const a = loadAlbum(req);
    if (!(req.user && (req.user.id === a.user_id || isMod(req.user)))) throw httpError(403, '只能管理自己的相册');
    return a;
  };

  r.get('/album/:id', (req, res) => {
    const a = loadAlbum(req);
    if (ctx.countHit?.('albums', a.id, req.vid)) a.hits += 1;
    const total = db.prepare('SELECT COUNT(*) AS n FROM photos WHERE album_id = ?').get(a.id).n;
    const pager = paginate({ total, page: req.query.page, perPage: ALBUM_PER_PAGE, baseUrl: `/album/${a.id}` });
    const photos = db.prepare('SELECT * FROM photos WHERE album_id = ? ORDER BY id LIMIT ? OFFSET ?').all(a.id, ALBUM_PER_PAGE, pager.offset);
    photos.forEach((p) => { p.url = album.photoUrl(p); p.isCover = p.url === a.cover; });
    const isOwner = req.user?.id === a.user_id;
    res.render('album/view.njk', {
      title: a.title, nav: 'album',
      crumbs: [['相册', '/album'], [`${a.username} 的相册`, `/album/user/${a.user_id}`], [a.title]],
      album: a, photos, pager, isOwner, canManage: !!(req.user && (isOwner || isMod(req.user))),
      quota: isOwner ? album.quotaInfo(ctx, req.user.id) : null,
      uploadMaxKb: ctx.settings.int('upload_max_kb'),
      others: db.prepare('SELECT id, title, photo_count FROM albums WHERE user_id = ? AND id <> ? ORDER BY updated_at DESC LIMIT 10').all(a.user_id, a.id),
    });
  });

  r.post('/album/:id/upload', requireLogin, memoryUpload.array('photos', 10), (req, res) => {
    const a = loadAlbum(req);
    if (req.user.id !== a.user_id) throw httpError(403, '只能往自己的相册上传照片');
    const files = req.files || [];
    const json = wantsJson(req);
    if (!files.length) {
      if (json) return res.status(400).json({ ok: false, error: '请选择要上传的照片' });
      return res.message({ title: '上传失败', text: '请选择要上传的照片', ok: false, status: 400 });
    }
    if (!limiter.check(`album-upload:${req.user.id}`, 200, 3600_000)) {
      if (json) return res.status(429).json({ ok: false, error: '上传太频繁了，休息一下吧' });
      return res.message({ title: '上传失败', text: '上传太频繁了，休息一下吧', ok: false, status: 429 });
    }
    const saved = [];
    const errors = [];
    files.forEach((f, i) => {
      try {
        saved.push(album.addPhoto(ctx, { album: a, user: req.user, file: f, caption: files.length === 1 ? req.body.caption : undefined }));
      } catch (e) {
        if (!(e instanceof UploadError)) throw e;
        errors.push(files.length > 1 ? `第 ${i + 1} 张：${e.message}` : e.message);
      }
    });
    if (json) {
      const status = saved.length ? 200 : 400;
      return res.status(status).json({ ok: saved.length > 0, saved: saved.length, photos: saved, errors, error: errors[0] });
    }
    if (!saved.length) return res.message({ title: '上传失败', text: errors.join('；'), ok: false, status: 400 });
    res.message({
      title: '上传成功',
      text: `成功上传 ${saved.length} 张照片${errors.length ? `，${errors.length} 张失败：${errors.join('；')}` : ''}。`,
      redirect: `/album/${a.id}`,
    });
  });

  r.post('/album/:id/edit', requireLogin, (req, res) => {
    const a = ownAlbum(req);
    try {
      album.updateAlbum(ctx, a, req.body);
      res.message({ title: '保存成功', text: '相册信息已更新。', redirect: `/album/${a.id}` });
    } catch (e) {
      if (!(e instanceof album.ValidationError)) throw e;
      res.message({ title: '保存失败', text: e.message, ok: false, status: 400 });
    }
  });

  r.post('/album/:id/delete', requireLogin, (req, res) => {
    const a = ownAlbum(req);
    album.deleteAlbum(ctx, a);
    res.message({ title: '删除成功', text: `相册「${a.title}」及其中的照片已删除。`, redirect: req.user.id === a.user_id ? '/album/my' : '/album' });
  });

  return r;
}
