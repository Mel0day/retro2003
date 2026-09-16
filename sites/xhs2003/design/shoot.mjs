import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const files = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const page = await browser.newPage({ viewport: { width: 1000, height: 900 }, deviceScaleFactor: 1 });
for (const f of files) {
  await page.goto(pathToFileURL(path.resolve(f)).href);
  await page.waitForTimeout(4000);
  const out = 'design/shots/' + path.basename(f).replace(/\.html$/, '.png');
  await page.screenshot({ path: out, fullPage: true });
  console.log(out);
}
await browser.close();
