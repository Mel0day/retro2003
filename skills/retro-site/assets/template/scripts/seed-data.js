// 演示数据：几十个会员 + 上百条内容 + 留言，让站点一打开就像运营了一两年。
// 用法：启动时 SEED_DEMO=true 自动导入（只在空库导入一次），或 npm run seed。
// 把下面的 MEMBERS / ENTRIES 换成你的产品的真实感数据，数量建议：会员 20+、内容 60+、留言 100+。
import { hashPassword } from '../src/lib/password.js';
import { now } from '../src/lib/format.js';
import { searchNorm } from '../src/lib/text.js';
import { createUser } from '../src/services/auth.js';

export const DEMO_PASSWORD = 'demo1234';

const MEMBERS = [
  ['demo', '浙江 杭州', '这是演示账号，用来体验站点功能。'],
  ['小鹿乱撞', '上海', '爱逛街爱拍照'],
  ['阿May', '广东 广州', '奶茶爱好者'],
  ['背包客小张', '北京', '一年出去八次'],
  ['vivian', '江苏 南京', ''],
  ['Lemon树', '四川 成都', '租房改造中'],
  ['数码迷', '广东 深圳', 'MP3 收藏家'],
  ['书虫', '湖北 武汉', '每周一本'],
  ['小厨娘', '山东 青岛', '家常菜'],
  ['胶片少年', '福建 厦门', ''],
];

const ENTRIES = [
  ['分享', '秋季通勤穿搭 5 套', '天气转凉，整理了这个秋天最常穿的 5 套通勤搭配。\n第一套：米色风衣 + 直筒牛仔裤 + 乐福鞋，最不会出错。\n第二套：针织开衫 + 百褶裙，配一双玛丽珍鞋。'],
  ['分享', '自制珍珠奶茶全过程', '木薯粉加开水揉成团，搓成小球煮 20 分钟，焖 20 分钟。\n红茶用大吉岭，加牛奶和黑糖，最后放珍珠。'],
  ['闲聊', '大家都在用什么 QQ 秀', '最近换了一套新的 QQ 秀，感觉还不错。大家都用什么风格的？'],
  ['求助', '第一次买 MP3 求推荐', '预算 400 左右，主要听歌和录音，纠结爱国者和三星，求过来人指点。'],
  ['分享', '西塘两日游攻略（附花费）', '周五晚上出发，住在河边的客栈，一晚 80。\n第二天早起看烟雨长廊，人少的时候最好看。\n两天总花费 230，含来回车票。'],
  ['闲聊', '晒晒你的 MSN 签名', '我的是「生活就像一盒巧克力」，你们的呢？'],
  ['求助', '宿舍能做的电饭锅蛋糕', '只有一个电饭锅，想给室友做生日蛋糕，有没有简单的做法？'],
  ['分享', '平价好用洗面奶测评', '买了六支平价洗面奶挨个用了两周，按洗后感受排个序。'],
  ['公告', '本站开放注册啦', '欢迎大家注册发帖，请文明发言，广告一律删除并封号。'],
  ['分享', '我的 20 平出租屋改造', '花了 600 块，换了窗帘、贴纸和一盏落地灯，房间完全变了个样。'],
];

const COMMENTS = ['写得真好，收藏了', '楼主继续更新啊', '同问，我也想知道', '已经照着做了，成功！', '沙发', '路过学习', '感谢分享，正好需要', '图片能多发几张吗', '太实用了', '支持楼主'];

export function seedDemo(ctx, { onlyIfEmpty = true } = {}) {
  const { db, settings } = ctx;
  if (onlyIfEmpty && (settings.get('demo_seeded') || db.prepare("SELECT 1 FROM users WHERE role <> 'admin' LIMIT 1").get())) return false;

  // 固定种子的随机数，保证每次导入结果一致
  let seed = 20030510;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return Math.floor((seed / 2147483648) * n); };
  const t0 = now();
  const day = (d) => Math.round(t0 - d * 86400 - rnd(40000));
  const hash = hashPassword(DEMO_PASSWORD);

  db.transaction(() => {
    const ids = {};
    for (const [name, city, intro] of MEMBERS) {
      const id = createUser(ctx, { username: name, passwordHash: hash, city, createdAt: day(200 + rnd(300)) });
      if (intro) db.prepare('UPDATE users SET intro = ? WHERE id = ?').run(intro, id);
      ids[name] = id;
    }
    const names = MEMBERS.map((m) => m[0]);
    const insEntry = db.prepare(`INSERT INTO entries (author_id, channel, title, body, views, likes, status, search_text, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'public', ?, ?, ?)`);
    const insComment = db.prepare('INSERT INTO comments (entry_id, user_id, body, created_at) VALUES (?, ?, ?, ?)');
    // 内容散布在过去半年，最近几天也有，首页第一屏才不会全是旧帖
    ENTRIES.forEach((e, i) => {
      const at = i < 4 ? day(i * 1.5 + 0.5) : day(6 + (i - 4) * 12 + rnd(9));
      const author = ids[names[(i * 3 + 1) % names.length]];
      const id = insEntry.run(author, e[0], e[1], e[2], 200 + rnd(6000), rnd(60), searchNorm(`${e[1]} ${e[2]}`), at, at).lastInsertRowid;
      for (let k = 0, n = rnd(6); k <= n; k++) {
        insComment.run(id, ids[names[(i + k * 2 + 3) % names.length]], COMMENTS[(i + k) % COMMENTS.length], at + 3600 * (1 + rnd(40)));
      }
    });
    settings.set('demo_seeded', String(t0));
  })();
  return true;
}
