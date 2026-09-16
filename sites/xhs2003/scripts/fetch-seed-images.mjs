// 开发用：从 Unsplash 下载演示数据配图到 seed/images，并记录作者署名。
// 部署时不需要运行，图片已随仓库提供。
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('seed/images');
fs.mkdirSync(OUT, { recursive: true });

const FIXED = {
  outfit: '1483985988355-763728e1935b',
  bubbletea: '1558857563-b371033873b8',
  terraces: '1537531383496-f4749b8032cf',
  cleanser: '1556228720-195a672e8a03',
  room: '1522708323590-d24dbb6b0267',
  headphones: '1484704849700-f032a568e944',
};

const QUERIES = {
  xitang1: ['chinese water town canal', 'landscape'],
  xitang2: ['chinese old town river window', 'landscape'],
  xitang3: ['chinese lantern alley night', 'landscape'],
  xitang4: ['chinese soup dumplings table', 'landscape'],
  scarf: ['wool scarf', 'landscape'],
  cake: ['homemade sponge cake', 'landscape'],
  street: ['shanghai nanjing road', 'landscape'],
  oldphone: ['nokia phone', 'landscape'],
  ginkgo: ['ginkgo yellow leaves', 'landscape'],
  hamster: ['hamster', 'landscape'],
  totebag: ['canvas tote bag', 'landscape'],
  film: ['film camera', 'landscape'],
  books: ['books reading coffee', 'landscape'],
  lijiang: ['lijiang old town', 'landscape'],
  zhouzhuang: ['zhouzhuang', 'landscape'],
  huangshan: ['huangshan mountain', 'landscape'],
  westlake: ['west lake hangzhou', 'landscape'],
  gym: ['gym dumbbells', 'landscape'],
  lipstick: ['lipstick makeup', 'landscape'],
  noodles: ['chinese noodles bowl', 'landscape'],
  desk: ['study desk notebook', 'landscape'],
  cat: ['cat sleeping', 'landscape'],
  sweater: ['knit sweater outfit', 'landscape'],
  perfume: ['perfume bottle', 'squarish'],
  notebook: ['paper notebook', 'squarish'],
  shampoo: ['shampoo bottle', 'squarish'],
  discman: ['portable cd player', 'squarish'],
  undershirt: ['folded cotton shirt', 'squarish'],
  mp3: ['ipod', 'squarish'],
  camera: ['compact digital camera', 'squarish'],
  album1: ['autumn park', 'landscape'],
  album2: ['sunset sea', 'landscape'],
  album3: ['snow mountain', 'landscape'],
  album4: ['old street bicycle', 'landscape'],
  album5: ['flower field', 'landscape'],
  album6: ['city night lights', 'landscape'],
};

const credits = fs.existsSync(path.join(OUT, 'credits.json')) ? JSON.parse(fs.readFileSync(path.join(OUT, 'credits.json'), 'utf8')) : {};

async function download(key, url, meta) {
  const file = path.join(OUT, `${key}.jpg`);
  if (fs.existsSync(file)) return;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${key}: HTTP ${r.status}`);
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  credits[key] = meta;
  console.log('saved', key, meta.photographer || '');
}

for (const [key, id] of Object.entries(FIXED)) {
  await download(key, `https://images.unsplash.com/photo-${id}?w=640&q=70&fm=jpg&fit=max`, { source: `https://unsplash.com/photos/${id}`, license: 'Unsplash License' });
}

for (const [key, [q, orientation]] of Object.entries(QUERIES)) {
  if (fs.existsSync(path.join(OUT, `${key}.jpg`))) continue;
  const api = `https://unsplash.com/napi/search/photos?query=${encodeURIComponent(q)}&per_page=10&orientation=${orientation}`;
  const res = await fetch(api, { headers: { Accept: 'application/json' } });
  if (!res.ok) { console.warn('search failed', key, res.status); continue; }
  const data = await res.json();
  const photo = (data.results || []).find((p) => !p.premium && !p.plus && p.urls?.raw);
  if (!photo) { console.warn('no free photo for', key); continue; }
  await download(key, `${photo.urls.raw}&w=640&q=70&fm=jpg&fit=max`, {
    source: photo.links?.html, photographer: photo.user?.name, license: 'Unsplash License', query: q,
  });
  await new Promise((r) => setTimeout(r, 300));
}
fs.writeFileSync(path.join(OUT, 'credits.json'), JSON.stringify(credits, null, 2));
console.log('done', Object.keys(credits).length);
