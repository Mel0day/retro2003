import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { startApp, ADMIN, CAPTCHA } from '../helpers.js';
import { seedDemo } from '../../scripts/seed-data.js';

export { ADMIN, CAPTCHA };
export const OUT = path.resolve('test-results');
fs.mkdirSync(OUT, { recursive: true });

// 本机没有下载 playwright 自带浏览器时，用 PW_CHROMIUM 指向缓存里的 chrome-headless-shell；
// 不设也会自动到 ~/Library/Caches/ms-playwright 里找一个能用的。
function executablePath() {
  if (process.env.PW_CHROMIUM) return process.env.PW_CHROMIUM;
  const root = path.join(process.env.HOME || '', 'Library/Caches/ms-playwright');
  if (!fs.existsSync(root)) return undefined;
  for (const dir of fs.readdirSync(root).filter((d) => d.startsWith('chromium')).sort().reverse()) {
    for (const rel of ['chrome-headless-shell-mac-arm64/chrome-headless-shell', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-headless-shell-mac-x64/chrome-headless-shell']) {
      const p = path.join(root, dir, rel);
      if (fs.existsSync(p)) return p;
    }
  }
  return undefined;
}

export async function startE2E({ seed = true } = {}) {
  const app = await startApp();
  if (seed) seedDemo(app.ctx, { onlyIfEmpty: false });
  const browser = await chromium.launch({ executablePath: executablePath() });
  const problems = [];
  const newPage = async (opts = {}) => {
    const context = await browser.newContext({ viewport: { width: 1000, height: 900 }, ...opts });
    const page = await context.newPage();
    page.on('pageerror', (e) => problems.push(`pageerror ${page.url()}: ${e.message}`));
    page.on('console', (m) => {
      // 接口按设计返回 401/403/429 时浏览器会记一条资源加载失败，不算问题
      if (m.type() === 'error' && !/status of (401|403|429)/.test(m.text())) problems.push(`console ${page.url()}: ${m.text()}`);
    });
    page.on('dialog', (d) => d.accept());
    return page;
  };
  return {
    ...app, browser, newPage, problems,
    async close() { await browser.close(); await app.stop(); },
  };
}

export async function loginVia(page, base, username, password) {
  await page.goto(`${base}/login`);
  await page.fill('input[name=username]', username);
  await page.fill('input[name=password]', password);
  await page.fill('input[name=captcha]', CAPTCHA);
  await Promise.all([page.waitForURL(/.*/), page.click('button[type=submit]')]);
  await page.waitForSelector('text=登录成功');
}
