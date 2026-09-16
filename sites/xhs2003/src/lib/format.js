// 日期与数字格式化，统一按站点时区（默认北京时间）显示
export const TZ = process.env.SITE_TZ || 'Asia/Shanghai';

const partsFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, weekday: 'short',
});

function parts(ts) {
  const d = new Date((typeof ts === 'number' ? ts : Number(ts)) * 1000);
  const o = {};
  for (const p of partsFmt.formatToParts(d)) o[p.type] = p.value;
  if (o.hour === '24') o.hour = '00';
  return o;
}

const WEEK = { Sun: '日', Mon: '一', Tue: '二', Wed: '三', Thu: '四', Fri: '五', Sat: '六' };

export const now = () => Math.floor(Date.now() / 1000);

export function dateTime(ts) {
  if (!ts) return '';
  const p = parts(ts);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}
export function dateOnly(ts) {
  if (!ts) return '';
  const p = parts(ts);
  return `${p.year}-${p.month}-${p.day}`;
}
export function monthDay(ts) {
  if (!ts) return '';
  const p = parts(ts);
  return `${p.month}-${p.day}`;
}
export function chineseToday(ts = now()) {
  const p = parts(ts);
  return `${Number(p.year)}年${Number(p.month)}月${Number(p.day)}日 星期${WEEK[p.weekday]}`;
}
export function dayKey(ts = now()) {
  return dateOnly(ts);
}
export function clock(ts = now()) {
  const p = parts(ts);
  return `${p.hour}:${p.minute}`;
}
export function timeOnly(ts) {
  const p = parts(ts);
  return `${p.hour}:${p.minute}:${p.second}`;
}

// 1,247 形式
export const thousands = (n) => Number(n || 0).toLocaleString('en-US');

export function yuan(cents) {
  const v = Number(cents || 0) / 100;
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0$/, '');
}

export function fileSize(bytes) {
  const b = Number(bytes || 0);
  if (b < 1024) return `${b}B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)}KB`;
  return `${(b / 1024 / 1024).toFixed(1)}MB`;
}

export function ago(ts) {
  const diff = now() - ts;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} 天前`;
  return dateOnly(ts);
}

export function truncate(s, n) {
  const str = String(s ?? '');
  return [...str].length > n ? [...str].slice(0, n).join('') + '…' : str;
}
