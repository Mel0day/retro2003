// 站点设置：数据库 settings 表覆盖默认值，进程内缓存。
export const DEFAULT_SETTINGS = {
  site_name: '小红书',
  site_slogan: '标记我的生活',
  site_since: '2003',
  webmaster_email: 'webmaster@example.com',
  icp: '',
  copyright_year: '2003',
  webmaster_notice: '欢迎来到小红书社区！请文明发言，共同维护良好的社区氛围。',
  footer_hint: '本站建议使用 IE 5.0 以上浏览器、800×600 分辨率浏览',
  show_marquee: '1',
  show_counter: '1',
  counter_base: '0',
  visitor_count: '0',
  register_open: '1',
  captcha_login: '1',
  allow_guest_comment: '1',
  comment_review_guest: '1',
  comment_review_member: '0',
  upload_max_kb: '2048',
  album_quota_mb: '20',
  new_badge_hours: '24',
};

export const SETTING_FIELDS = [
  { key: 'site_name', label: '站点名称', type: 'text' },
  { key: 'site_slogan', label: '站点口号', type: 'text' },
  { key: 'site_since', label: '创站年份', type: 'text' },
  { key: 'copyright_year', label: '版权年份', type: 'text' },
  { key: 'webmaster_email', label: '站长信箱', type: 'text' },
  { key: 'icp', label: '备案号（留空不显示）', type: 'text' },
  { key: 'footer_hint', label: '页脚浏览建议', type: 'text' },
  { key: 'webmaster_notice', label: '站长公告', type: 'textarea' },
  { key: 'show_marquee', label: '显示跑马灯公告', type: 'bool' },
  { key: 'show_counter', label: '显示访客计数器', type: 'bool' },
  { key: 'counter_base', label: '计数器基数', type: 'number' },
  { key: 'register_open', label: '开放注册', type: 'bool' },
  { key: 'captcha_login', label: '登录需要验证码', type: 'bool' },
  { key: 'allow_guest_comment', label: '允许游客留言', type: 'bool' },
  { key: 'comment_review_guest', label: '游客留言需审核', type: 'bool' },
  { key: 'comment_review_member', label: '会员留言需审核', type: 'bool' },
  { key: 'upload_max_kb', label: '单张图片上限（KB）', type: 'number' },
  { key: 'album_quota_mb', label: '每人相册空间（MB）', type: 'number' },
  { key: 'new_badge_hours', label: 'NEW 标记时长（小时）', type: 'number' },
];

export function createSettings(db) {
  let cache = null;
  const load = () => {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    cache = { ...DEFAULT_SETTINGS };
    for (const r of rows) cache[r.key] = r.value;
    return cache;
  };
  const upsert = db.prepare(
    'INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );
  return {
    all: () => cache || load(),
    get: (key) => (cache || load())[key] ?? '',
    int: (key) => parseInt((cache || load())[key], 10) || 0,
    bool: (key) => (cache || load())[key] === '1',
    set(key, value) {
      upsert.run(key, String(value));
      cache = null;
    },
    setMany(obj) {
      db.transaction(() => {
        for (const [k, v] of Object.entries(obj)) upsert.run(k, String(v));
      })();
      cache = null;
    },
    incr(key, by = 1) {
      db.prepare(
        `INSERT INTO settings(key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + ? AS TEXT)`
      ).run(key, String(by), by);
      if (cache) cache[key] = String((parseInt(cache[key], 10) || 0) + by);
    },
  };
}
