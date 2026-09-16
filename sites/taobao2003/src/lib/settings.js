// 站点设置：数据库 settings 表覆盖默认值，进程内缓存。
export const DEFAULT_SETTINGS = {
  announcement: '☆ 淘宝公告：支付宝担保交易正式上线，先收货后付款，安全无忧！新会员注册即送 1000 元支付宝体验金 ☆',
  ad_text: '[ 120×90\n广告位 ]',
  ad_url: '',
  hot_words: 'MP3 牛仔裤 哈利波特 摄像头 台灯',
  counter_base: '7738621',
  visitor_count: '0',
  register_open: '1',
  service_email: 'service@taobao2003.example',
  icp: '浙ICP证030001号',
};

export const SETTING_FIELDS = [
  { key: 'announcement', label: '公告跑马灯', type: 'text', max: 200 },
  { key: 'ad_text', label: '120×90 广告位文字（可换行）', type: 'textarea', max: 60 },
  { key: 'ad_url', label: '广告位链接（/ 开头的站内地址或 http(s) 地址，留空不可点）', type: 'url', max: 200 },
  { key: 'hot_words', label: '热门搜索词（空格分隔，最多 8 个）', type: 'text', max: 100 },
  { key: 'counter_base', label: '访问量计数器基数', type: 'number' },
  { key: 'register_open', label: '开放注册', type: 'bool' },
  { key: 'service_email', label: '客服信箱', type: 'text', max: 80 },
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
