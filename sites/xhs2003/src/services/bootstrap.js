import { hashPassword } from '../lib/password.js';

// 全新数据库需要的基础结构（频道、论坛版块、聊天室、单页），不含演示内容
export const BASE_CHANNELS = [
  ['outfit', '穿搭搭配', '每日穿搭、单品分享、搭配心得'],
  ['beauty', '美妆护肤', '护肤步骤、彩妆测评、平价好物'],
  ['food', '美食厨房', '家常菜谱、探店、零食测评'],
  ['travel', '旅游攻略', '路线、住宿、花费明细'],
  ['digital', '数码玩家', '手机、MP3、数码相机开箱与选购'],
  ['home', '家居装饰', '租房改造、收纳、小物件'],
  ['books', '读书笔记', '读后感、书单、摘抄'],
  ['fitness', '健身运动', '减肥、跑步、健身房新手'],
  ['pets', '宠物之家', '猫狗仓鼠、养宠经验'],
  ['campus', '校园生活', '考研、宿舍、社团与毕业'],
];

const BASE_FORUM = [
  ['社区事务', [
    ['站务公告', '站长发布的社区公告与活动'],
    ['意见建议', 'bug 反馈、功能建议，版主招募'],
  ]],
  ['生活休闲', [
    ['灌水乐园', '闲聊、签名、QQ 秀，想说啥说啥'],
    ['音乐影视', '好听的歌、好看的电影电视剧'],
    ['情感驿站', '心事、友情、爱情'],
  ]],
  ['兴趣交流', [
    ['穿搭美妆', '衣服、护肤、化妆讨论'],
    ['旅行摄影', '结伴出游、摄影器材与技巧'],
    ['数码天地', '电脑装机、手机、MP3'],
  ]],
];

const BASE_ROOMS = [
  ['lobby', '大厅', '欢迎来到小红书聊天室，文明聊天，快乐交友'],
  ['outfit', '穿搭', '聊聊今天穿什么'],
  ['travel', '旅游', '找驴友、问路线'],
  ['digital', '数码', '装机、换手机、MP3 选购'],
];

const BASE_PAGES = [
  ['about', '关于我们', `[h]关于我们[/h]\n小红书社区创立于 2003 年，是一个分享生活方式的网上社区。在这里，你可以记录穿搭、美食、旅行和好物，也可以在论坛、聊天室认识志同道合的朋友。\n\n我们相信：每个人的生活都值得被标记。`],
  ['ads', '广告服务', `[h]广告服务[/h]\n本站提供首页 468×60 横幅广告、内页 160×100 侧栏广告等多种广告形式。\n\n广告合作请发邮件至站长信箱，注明公司名称、联系人和投放需求。`],
  ['contact', '联系站长', `[h]联系站长[/h]\n如有任何问题、建议或合作意向，欢迎通过以下方式联系我们：\n\n[list][*]站长信箱：见页面底部\n[*]站内短消息：发送给站长账号\n[*]论坛「意见建议」版块发帖[/list]`],
  ['jobs', '诚聘版主', `[h]诚聘版主[/h]\n社区各频道、论坛各版块长期招募版主。\n\n[b]要求：[/b]\n[list=1][*]注册满 30 天，积分 300 以上（中级会员）\n[*]热爱社区，每天能上线 1 小时以上\n[*]公正、耐心，能处理举报和违规内容[/list]\n\n有意者请在论坛「意见建议」版块发帖申请。`],
  ['disclaimer', '免责声明', `[h]免责声明[/h]\n[list=1][*]本站所有笔记、帖子、图片均由网友发表，仅代表作者个人观点，与本站立场无关。\n[*]转载本站内容请注明出处和作者。\n[*]如本站内容侵犯了您的权益，请联系站长，我们将在核实后第一时间删除。\n[*]网友购物请自行核实商品信息，理性消费。[/list]`],
  ['terms', '服务条款', `[h]会员服务条款[/h]\n[list=1][*]遵守国家法律法规，不发布违法、色情、暴力、广告信息。\n[*]尊重他人，禁止人身攻击和恶意灌水。\n[*]请妥善保管账号密码，因个人原因造成的账号丢失本站不负责任。\n[*]违反规定者，站长有权删除内容、扣除积分直至封禁账号。[/list]`],
];

export function ensureBaseData(ctx) {
  const { db } = ctx;
  db.transaction(() => {
    if (!db.prepare('SELECT 1 FROM channels LIMIT 1').get()) {
      const ins = db.prepare('INSERT INTO channels (slug, name, description, sort) VALUES (?, ?, ?, ?)');
      BASE_CHANNELS.forEach(([slug, name, desc], i) => ins.run(slug, name, desc, i));
    }
    if (!db.prepare('SELECT 1 FROM forum_categories LIMIT 1').get()) {
      const insCat = db.prepare('INSERT INTO forum_categories (name, sort) VALUES (?, ?)');
      const insBoard = db.prepare('INSERT INTO forum_boards (category_id, name, description, sort) VALUES (?, ?, ?, ?)');
      BASE_FORUM.forEach(([cat, boards], i) => {
        const cid = insCat.run(cat, i).lastInsertRowid;
        boards.forEach(([name, desc], j) => insBoard.run(cid, name, desc, j));
      });
    }
    if (!db.prepare('SELECT 1 FROM chat_rooms LIMIT 1').get()) {
      const ins = db.prepare('INSERT INTO chat_rooms (slug, name, topic, sort) VALUES (?, ?, ?, ?)');
      BASE_ROOMS.forEach(([slug, name, topic], i) => ins.run(slug, name, topic, i));
    }
    const insPage = db.prepare('INSERT OR IGNORE INTO pages (slug, title, content, sort) VALUES (?, ?, ?, ?)');
    BASE_PAGES.forEach(([slug, title, content], i) => insPage.run(slug, title, content, i));
  })();
}

export function createUser(ctx, { username, password, role = 'user', location = '', question = '', answerHash = '', avatarColor }) {
  const colors = ['#69c', '#c96', '#9c6', '#5a7', '#c69', '#96c', '#c66', '#6ac', '#a85', '#7a9'];
  const color = avatarColor || colors[Math.floor(Math.random() * colors.length)];
  const info = ctx.db.prepare(`INSERT INTO users (username, password_hash, role, location, question, answer_hash, avatar_color)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(username, hashPassword(password), role, location, question, answerHash, color);
  return Number(info.lastInsertRowid);
}

export function ensureAdmin(ctx) {
  ensureBaseData(ctx);
  const { adminUsername, adminPassword } = ctx.config;
  if (adminUsername && adminPassword) {
    const existing = ctx.db.prepare('SELECT id, role FROM users WHERE username = ?').get(adminUsername);
    if (!existing) {
      createUser(ctx, { username: adminUsername, password: adminPassword, role: 'admin', avatarColor: '#c00' });
      console.log(`[xhs2003] 已创建站长账号：${adminUsername}`);
    } else if (existing.role !== 'admin') {
      ctx.db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(existing.id);
    }
  } else if (!ctx.config.isTest && !ctx.db.prepare("SELECT 1 FROM users WHERE role = 'admin'").get()) {
    console.warn('[xhs2003] 尚无站长账号：请设置 ADMIN_USERNAME / ADMIN_PASSWORD 环境变量，或运行 npm run create-admin');
  }
}
