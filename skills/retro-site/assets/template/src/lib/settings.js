// 站点设置：数据库 settings 表覆盖默认值，进程内缓存。加字段时同时改 DEFAULT_SETTINGS 和 SETTING_FIELDS。
export const DEFAULT_SETTINGS = {
  announcement: '☆ 本站公告：欢迎光临 __NAME__，请文明发言、友善交流 ☆',
  notice: '站长有话说：本站是 2003 年风格的复刻演示站点，数据均为虚构。',
  counter_base: '138726',
  visitor_count: '0',
  register_open: '1',
  webmaster_email: 'webmaster@example.com',
  icp: '',
};

export const SETTING_FIELDS = [
  { key: 'announcement', label: '跑马灯公告', type: 'text', max: 200 },
  { key: 'notice', label: '站长公告', type: 'textarea', max: 500 },
  { key: 'counter_base', label: '访问量计数器基数', type: 'number' },
  { key: 'register_open', label: '开放注册', type: 'bool' },
  { key: 'webmaster_email', label: '站长信箱', type: 'text', max: 80 },
  { key: 'icp', label: '页脚备案号（留空不显示）', type: 'text', max: 40 },
];

export function createSettings(db) {
  let cache = null;
  const load = () => {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    cache = { ...DEFAULT_SETTINGS };
    for (const r of rows) cache[r.key] = r.value;
    return cache;
  };
  const upsert = db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  const incr = db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + ? AS TEXT)');
  return {
    all: () => cache || load(),
    get: (key) => (cache || load())[key] ?? '',
    int: (key) => parseInt((cache || load())[key], 10) || 0,
    bool: (key) => (cache || load())[key] === '1',
    set(key, value) { upsert.run(key, String(value)); cache = null; },
    setMany(obj) {
      db.transaction(() => { for (const [k, v] of Object.entries(obj)) upsert.run(k, String(v)); })();
      cache = null;
    },
    incr(key, by = 1) {
      const base = parseInt(DEFAULT_SETTINGS[key] ?? '0', 10) || 0;
      incr.run(key, String(base + by), by);
      cache = null;
    },
  };
}
