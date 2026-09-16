import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { now, fileSize, thousands, TZ } from '../../lib/format.js';

// 站点时区的今日零点（Unix 秒）
export function todayStart() {
  const tz = TZ;
  const p = {};
  for (const x of new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(new Date())) p[x.type] = x.value;
  const h = p.hour === '24' ? 0 : Number(p.hour);
  return now() - (h * 3600 + Number(p.minute) * 60 + Number(p.second));
}

function dirSize(dir, limit = 200000) {
  let total = 0, files = 0;
  const stack = [dir];
  while (stack.length && files < limit) {
    const d = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) { try { total += fs.statSync(p).size; files++; } catch { /* 忽略 */ } }
    }
  }
  return { total, files };
}

function fileBytes(f) {
  try { return fs.statSync(f).size; } catch { return 0; }
}

function duration(sec) {
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  return `${d ? `${d} 天 ` : ''}${h} 小时 ${m} 分钟`;
}

export default function adminDashboard(ctx) {
  const r = express.Router();
  const { db, settings, config } = ctx;
  const count = (sql, ...args) => db.prepare(sql).get(...args).n;

  r.get('/', (req, res) => {
    const t0 = todayStart();
    const stats = {
      users: count('SELECT COUNT(*) AS n FROM users'),
      usersToday: count('SELECT COUNT(*) AS n FROM users WHERE created_at >= ?', t0),
      notes: count("SELECT COUNT(*) AS n FROM notes WHERE status = 'published'"),
      notesToday: count("SELECT COUNT(*) AS n FROM notes WHERE created_at >= ?", t0),
      pendingComments: count("SELECT COUNT(*) AS n FROM comments WHERE status = 'pending'"),
      openReports: count("SELECT COUNT(*) AS n FROM reports WHERE status = 'open'"),
      pendingOrders: count("SELECT COUNT(*) AS n FROM orders WHERE status = 'pending'"),
      threads: count("SELECT COUNT(*) AS n FROM forum_threads WHERE status = 'published'"),
      posts: count("SELECT COUNT(*) AS n FROM forum_posts WHERE status = 'published'"),
      photos: count('SELECT COUNT(*) AS n FROM photos'),
      comments: count("SELECT COUNT(*) AS n FROM comments WHERE status = 'approved'"),
      visitors: settings.int('counter_base') + settings.int('visitor_count'),
      online: ctx.online.count(),
    };
    const recentUsers = db.prepare('SELECT id, username, role, banned, points, location, created_at FROM users ORDER BY id DESC LIMIT 8').all();
    const recentNotes = db.prepare(`SELECT n.id, n.title, n.status, n.featured, n.created_at, u.username, u.id AS user_id, c.name AS channel_name
      FROM notes n JOIN users u ON u.id = n.user_id JOIN channels c ON c.id = n.channel_id ORDER BY n.id DESC LIMIT 8`).all();
    const uploads = dirSize(config.uploadDir);
    const dbBytes = fileBytes(config.dbFile) + fileBytes(`${config.dbFile}-wal`);
    const system = {
      node: process.version,
      sqlite: db.prepare('SELECT sqlite_version() AS v').get().v,
      uptime: duration(Math.floor(process.uptime())),
      env: config.env,
      dbSize: fileSize(dbBytes),
      uploadSize: fileSize(uploads.total),
      uploadFiles: thousands(uploads.files),
      memory: fileSize(process.memoryUsage().rss),
      platform: `${process.platform} ${process.arch}`,
    };
    res.render('admin/dashboard.njk', { title: '后台首页', adminNav: 'dashboard', stats, recentUsers, recentNotes, system });
  });

  return r;
}
