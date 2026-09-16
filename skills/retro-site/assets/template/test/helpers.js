// 测试工具：每个测试文件启动一个独立的应用实例（临时数据目录 + 随机端口）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { createUser } from '../src/services/auth.js';
import { now } from '../src/lib/format.js';
import { searchNorm } from '../src/lib/text.js';

export const ADMIN = { username: '__ADMIN__', password: 'admin123456789' };
export const PASSWORD = 'pass1234';

export async function startApp(env = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), '__SLUG__-test-'));
  const config = loadConfig({
    NODE_ENV: 'test', DATA_DIR: dataDir, ADMIN_USERNAME: ADMIN.username, ADMIN_PASSWORD: ADMIN.password, LOG_REQUESTS: '0', ...env,
  });
  const { app, ctx, close } = createApp(config);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = {
    base, ctx, config, dataDir,
    client: () => new Client(base),
    // 直接在数据库里建会员（比走注册页快）
    createUser: (username, extra = {}) => createUser(ctx, { username, password: PASSWORD, ...extra }),
    // 直接建一条内容，返回 id
    createEntry: (authorId, over = {}) => {
      const e = { title: '示例条目 一二三四', body: '这是一条演示内容。', channel: '闲聊', status: 'public', ...over };
      const t = now();
      return Number(ctx.db.prepare(`INSERT INTO entries (author_id, channel, title, body, status, search_text, created_at, updated_at)
        VALUES (@author_id, @channel, @title, @body, @status, @search_text, @t, @t)`)
        .run({ ...e, author_id: authorId, search_text: searchNorm(`${e.title} ${e.body}`), t }).lastInsertRowid);
    },
    // 登录并返回客户端
    login: async (username, password = PASSWORD) => {
      const c = new Client(base);
      await c.login(username, password);
      return c;
    },
    async stop() {
      server.closeAllConnections?.();
      await new Promise((r) => server.close(r));
      close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
  return api;
}

export class Client {
  constructor(base) { this.base = base; this.jar = new Map(); this.csrf = ''; }

  cookieHeader() { return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; '); }

  store(res) {
    for (const c of res.headers.getSetCookie?.() || []) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      const k = pair.slice(0, i).trim();
      const v = pair.slice(i + 1).trim();
      if (/Max-Age=0/i.test(c) || v === '') this.jar.delete(k); else this.jar.set(k, v);
    }
  }

  async request(method, url, { body, headers = {}, redirect = 'manual' } = {}) {
    const res = await fetch(this.base + url, {
      method, body, redirect,
      headers: { cookie: this.cookieHeader(), 'user-agent': 'Mozilla/5.0 (Macintosh) taobao-test', ...headers },
    });
    this.store(res);
    const text = await res.text();
    const m = text.match(/data-csrf="([^"]+)"/);
    if (m) this.csrf = m[1];
    let json = null;
    try { json = JSON.parse(text); } catch { /* 非 JSON */ }
    return { status: res.status, headers: res.headers, text, json, location: res.headers.get('location') };
  }

  async init() { if (!this.csrf) await this.get('/login'); return this; }

  get(url, opts) { return this.request('GET', url, opts); }

  async post(url, form = {}, opts = {}) {
    await this.init();
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries({ _csrf: this.csrf, ...form })) {
      if (Array.isArray(v)) v.forEach((x) => body.append(k, String(x)));
      else if (v !== undefined && v !== null) body.append(k, String(v));
    }
    return this.request('POST', url, { ...opts, body, headers: { 'content-type': 'application/x-www-form-urlencoded', ...(opts.headers || {}) } });
  }

  async upload(url, fields = {}, files = {}, opts = {}) {
    await this.init();
    const fd = new FormData();
    for (const [k, v] of Object.entries({ _csrf: this.csrf, ...fields })) {
      if (Array.isArray(v)) v.forEach((x) => fd.append(k, String(x)));
      else if (v !== undefined && v !== null) fd.append(k, String(v));
    }
    for (const [k, list] of Object.entries(files)) {
      for (const f of Array.isArray(list) ? list : [list]) {
        const buf = Buffer.isBuffer(f) ? f : f.buffer;
        fd.append(k, new Blob([buf], { type: f.type || 'image/png' }), f.filename || 'a.png');
      }
    }
    return this.request('POST', url, { ...opts, body: fd });
  }

  async login(username, password = PASSWORD) {
    await this.init();
    const res = await this.post('/login', { username, password });
    if (!this.jar.has('sid')) throw new Error(`登录失败：${username} ${res.status} ${(res.text.match(/class="err">([^<]+)/) || [])[1] || ''}`);
    return res;
  }

  logout() { return this.post('/logout'); }
}

// 1×1 PNG，用于上传测试
export const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

// 从页面里找出一个数字（如「共找到 N 件宝贝」）
export const num = (text, re) => Number((text.match(re) || [])[1] ?? NaN);
