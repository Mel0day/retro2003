// 开发用：从 Unsplash 下载演示宝贝的配图到 seed/images，并记录作者署名。
// 部署时不需要运行，图片已随仓库提供。用法：node scripts/fetch-seed-images.mjs
import fs from 'node:fs';
import path from 'node:path';
import { IMAGE_QUERIES } from './seed-data.js';

const OUT = path.resolve('seed/images');
fs.mkdirSync(OUT, { recursive: true });
const creditsFile = path.join(OUT, 'credits.json');
const credits = fs.existsSync(creditsFile) ? JSON.parse(fs.readFileSync(creditsFile, 'utf8')) : {};

async function download(key, url, meta) {
  const file = path.join(OUT, `${key}.jpg`);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${key}: HTTP ${r.status}`);
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  credits[key] = meta;
  console.log('saved', key, meta.photographer || '');
}

for (const [key, q] of Object.entries(IMAGE_QUERIES)) {
  if (fs.existsSync(path.join(OUT, `${key}.jpg`))) continue;
  try {
    const api = `https://unsplash.com/napi/search/photos?query=${encodeURIComponent(q)}&per_page=10&orientation=squarish`;
    const res = await fetch(api, { headers: { Accept: 'application/json' } });
    if (!res.ok) { console.warn('search failed', key, res.status); continue; }
    const data = await res.json();
    const photo = (data.results || []).find((p) => !p.premium && !p.plus && p.urls?.raw);
    if (!photo) { console.warn('no free photo for', key); continue; }
    await download(key, `${photo.urls.raw}&w=480&h=480&q=70&fm=jpg&fit=crop`, {
      source: photo.links?.html, photographer: photo.user?.name, license: 'Unsplash License', query: q,
    });
  } catch (e) {
    console.warn('failed', key, e.message);
  }
  await new Promise((r) => setTimeout(r, 400));
}
fs.writeFileSync(creditsFile, JSON.stringify(credits, null, 2));
console.log('done', Object.keys(credits).length);
