import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { startApp, ADMIN, PASSWORD } from '../helpers.js';
import { seedDemo, DEMO_PASSWORD } from '../../scripts/seed-data.js';

export { ADMIN, PASSWORD, DEMO_PASSWORD };
export const OUT = path.resolve('test-results');
fs.mkdirSync(OUT, { recursive: true });

// 本机没有下载 playwright 自带的浏览器时，用 PW_CHROMIUM 指向缓存里的 chrome-headless-shell
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
  const newPage = async (opts = {}, { autoDialog = true } = {}) => {
    const context = await browser.newContext({ viewport: { width: 1000, height: 900 }, ...opts });
    const page = await context.newPage();
    page.on('pageerror', (e) => problems.push(`pageerror ${page.url()}: ${e.message}`));
    // 接口按设计返回 400/401/403/404/409/429 时浏览器会记一条资源加载失败，不算问题
    page.on('console', (m) => {
      if (m.type() === 'error' && !/status of (400|401|403|404|409|413|429)/.test(m.text())) problems.push(`console ${page.url()}: ${m.text()}`);
    });
    if (autoDialog) page.on('dialog', (d) => d.accept().catch(() => {}));
    return page;
  };
  return {
    ...app, browser, newPage, problems,
    shot: (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true }),
    async close() { await browser.close(); await app.stop(); },
  };
}

export async function login(page, base, username, password) {
  await page.goto(`${base}/login`);
  await page.fill('input[name=username]', username);
  await page.fill('input[name=password]', password);
  await Promise.all([page.waitForNavigation(), page.click('button.btn-login')]);
}
