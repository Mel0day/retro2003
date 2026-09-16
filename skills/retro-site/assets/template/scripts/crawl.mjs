// 自检：用指定身份爬遍站内所有 GET 链接，报告 404/500、模板残留和慢页面。
// 用法：node scripts/crawl.mjs http://127.0.0.1:__PORT__ [会员名 密码]
const base = process.argv[2] || 'http://127.0.0.1:__PORT__';
const [username, password] = process.argv.slice(3);

const jar = new Map();
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
function store(res) {
  for (const c of res.headers.getSetCookie?.() || []) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    const k = pair.slice(0, i).trim();
    const v = pair.slice(i + 1).trim();
    if (/Max-Age=0/i.test(c) || v === '') jar.delete(k); else jar.set(k, v);
  }
}
async function get(url) {
  const res = await fetch(url, { headers: { cookie: cookieHeader(), 'user-agent': '__SLUG__-crawler' }, redirect: 'manual' });
  store(res);
  const text = res.headers.get('content-type')?.includes('text/html') ? await res.text() : '';
  return { status: res.status, text, location: res.headers.get('location') };
}

if (username) {
  const page = await get(`${base}/login`);
  const csrf = page.text.match(/data-csrf="([^"]+)"/)[1];
  const body = new URLSearchParams({ _csrf: csrf, username, password });
  const res = await fetch(`${base}/login`, {
    method: 'POST', body, redirect: 'manual',
    headers: { cookie: cookieHeader(), 'content-type': 'application/x-www-form-urlencoded' },
  });
  store(res);
  if (!jar.has('sid')) { console.error(`登录失败：${username}`); process.exit(1); }
  console.log(`已登录：${username}`);
}

const seen = new Set(['/logout']);
const queue = ['/'];
const problems = [];
let count = 0;
const started = Date.now();

const MAX_PAGES = Number(process.env.CRAWL_MAX || 1500);
while (queue.length && count < MAX_PAGES) {
  const path = queue.shift();
  if (seen.has(path)) continue;
  seen.add(path);
  const t = Date.now();
  const { status, text } = await get(base + path);
  const ms = Date.now() - t;
  count++;
  if (status >= 400) problems.push(`${status} ${path}`);
  if (ms > 1000) problems.push(`慢 ${ms}ms ${path}`);
  for (const bad of ['undefined', 'NaN', '[object Object]', '{{']) {
    if (text.includes(bad)) problems.push(`模板残留「${bad}」 ${path}`);
  }
  for (const m of text.matchAll(/href="([^"#?][^"#]*)(?:[?#][^"]*)?"/g)) {
    const href = m[0].slice(6, -1);
    if (!href.startsWith('/') || href.startsWith('//') || href.startsWith('/static') || href.startsWith('/uploads')) continue;
    if (!seen.has(href) && queue.length < 3000) queue.push(href);
  }
}

console.log(`爬取 ${count} 个页面，用时 ${((Date.now() - started) / 1000).toFixed(1)}s${queue.length ? `（达到上限 ${MAX_PAGES}，还有 ${queue.length} 个链接没爬，可用 CRAWL_MAX 调整）` : ''}`);
if (problems.length) {
  console.log(`发现 ${problems.length} 个问题：`);
  for (const p of problems.slice(0, 50)) console.log(' -', p);
  process.exit(1);
}
console.log('没有 404/500，没有模板残留。');
