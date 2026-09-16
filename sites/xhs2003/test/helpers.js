// 测试工具：每个测试文件启动一个独立的应用实例（临时数据目录 + 随机端口）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { createUser } from '../src/services/bootstrap.js';

export const CAPTCHA = 'TEST';
export const ADMIN = { username: 'admin', password: 'admin123456' };

export async function startApp(env = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xhs2003-test-'));
  const config = loadConfig({
    NODE_ENV: 'test', DATA_DIR: dataDir, CAPTCHA_TEST_CODE: CAPTCHA,
    ADMIN_USERNAME: ADMIN.username, ADMIN_PASSWORD: ADMIN.password, LOG_REQUESTS: '0', ...env,
  });
  const { app, ctx, close } = createApp(config);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base, ctx, dataDir,
    client: () => new Client(base),
    // 直接在数据库里建会员（比走注册页快）
    createUser: (username, password = 'pass123456', extra = {}) => {
      const id = createUser(ctx, { username, password, ...extra });
      if (extra.role) ctx.db.prepare('UPDATE users SET role = ? WHERE id = ?').run(extra.role, id);
      return id;
    },
    async stop() {
      server.closeAllConnections?.();
      await new Promise((r) => server.close(r));
      close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

export class Client {
  constructor(base) {
    this.base = base;
    this.jar = new Map();
    this.csrf = '';
  }

  cookieHeader() {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
  }

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
      headers: { cookie: this.cookieHeader(), 'user-agent': 'Mozilla/5.0 (Macintosh) xhs-test', ...headers },
    });
    this.store(res);
    const text = await res.text();
    const m = text.match(/data-csrf="([^"]+)"/);
    if (m) this.csrf = m[1];
    let json = null;
    try { json = JSON.parse(text); } catch { /* 非 JSON */ }
    return { status: res.status, headers: res.headers, text, json, location: res.headers.get('location') };
  }

  // 首次访问拿到访客 cookie 和 CSRF 令牌
  async init() {
    if (!this.csrf) await this.get('/login');
    return this;
  }

  get(url, opts) { return this.request('GET', url, opts); }

  async post(url, form = {}, opts = {}) {
    await this.init();
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries({ _csrf: this.csrf, ...form })) {
      if (Array.isArray(v)) v.forEach((x) => body.append(k, x)); else if (v !== undefined) body.append(k, String(v));
    }
    return this.request('POST', url, { ...opts, body, headers: { 'content-type': 'application/x-www-form-urlencoded', ...(opts.headers || {}) } });
  }

  async api(url, data = {}) {
    await this.init();
    return this.request('POST', url, {
      body: JSON.stringify(data),
      headers: { 'content-type': 'application/json', 'x-csrf-token': this.csrf, 'x-requested-with': 'fetch' },
    });
  }

  async upload(url, fields = {}, files = {}) {
    await this.init();
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
    for (const [k, { buffer, name = 'a.png', type = 'image/png' }] of Object.entries(files)) {
      fd.append(k, new Blob([buffer], { type }), name);
    }
    return this.request('POST', url, { body: fd, headers: { 'x-csrf-token': this.csrf, 'x-requested-with': 'fetch' } });
  }

  async login(username, password) {
    await this.init();
    const res = await this.post('/login', { username, password, captcha: CAPTCHA });
    if (!this.jar.has('sid')) throw new Error(`登录失败：${username} ${res.status} ${res.text.match(/✘ ([^<]+)/)?.[1] || ''}`);
    await this.get('/my');
    return res;
  }
}

// 1×1 PNG，用于上传测试
export const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
