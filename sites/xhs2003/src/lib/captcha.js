import crypto from 'node:crypto';

// 图形验证码：进程内存储，按访客 ID 区分用途，一次性使用，5 分钟过期。
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 50000;

export function createCaptchaStore({ testCode = '' } = {}) {
  const store = new Map();

  function sweep() {
    const now = Date.now();
    for (const [k, v] of store) if (v.exp < now) store.delete(k);
    if (store.size > MAX_ENTRIES) {
      const drop = store.size - MAX_ENTRIES;
      let i = 0;
      for (const k of store.keys()) { if (i++ >= drop) break; store.delete(k); }
    }
  }
  const timer = setInterval(sweep, 60_000);
  timer.unref();

  return {
    issue(vid, scope) {
      let code = '';
      for (let i = 0; i < 4; i++) code += CHARS[crypto.randomInt(CHARS.length)];
      store.set(`${vid}:${scope}`, { code, exp: Date.now() + TTL_MS });
      return code;
    },
    verify(vid, scope, input) {
      const answer = String(input || '').trim().toUpperCase();
      if (testCode && answer === testCode.toUpperCase()) return true;
      const key = `${vid}:${scope}`;
      const entry = store.get(key);
      store.delete(key);
      return !!entry && entry.exp >= Date.now() && entry.code === answer;
    },
  };
}

// 仿原型样式：Courier New 斜体粗体、#dde 底色，加少量干扰线
export function renderCaptchaSvg(code) {
  const w = 52, h = 18;
  let glyphs = '';
  [...code].forEach((ch, i) => {
    const x = 4 + i * 12 + crypto.randomInt(-1, 2);
    const y = 14 + crypto.randomInt(-1, 1);
    const rot = crypto.randomInt(-18, 19);
    glyphs += `<text x="${x}" y="${y}" transform="rotate(${rot} ${x} ${y - 5})">${ch}</text>`;
  });
  let noise = '';
  for (let i = 0; i < 3; i++) {
    noise += `<line x1="${crypto.randomInt(0, w)}" y1="${crypto.randomInt(0, h)}" x2="${crypto.randomInt(0, w)}" y2="${crypto.randomInt(0, h)}" stroke="#99a" stroke-width="0.6"/>`;
  }
  for (let i = 0; i < 12; i++) {
    noise += `<circle cx="${crypto.randomInt(0, w)}" cy="${crypto.randomInt(0, h)}" r="0.7" fill="#88a"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
    + `<rect width="${w}" height="${h}" fill="#dde"/>${noise}`
    + `<g font-family="'Courier New',Courier,monospace" font-size="13" font-weight="bold" font-style="italic" fill="#336">${glyphs}</g></svg>`;
}
