// 演示数据：14 位卖家、10 位演示买家、48 位历史会员；原型里的 9 件宝贝全部收录（默认排序排在最前），共 35 件；
// 历史评价让卖家信用和原型里的星级一致；演示账号 demo 手上有各种状态的订单。
// 用法：服务启动时 SEED_DEMO=true 自动导入（只在空库导入一次），或 npm run seed。
import fs from 'node:fs';
import path from 'node:path';
import { hashPassword } from '../src/lib/password.js';
import { now } from '../src/lib/format.js';
import { createUser } from '../src/services/auth.js';
import { buildSearchText } from '../src/services/items.js';
import { insertRating } from '../src/services/credit.js';
import { alipay, orderLog } from '../src/services/orders.js';

export const DEMO_PASSWORD = 'demo1234';

export const SELLERS = [
  { name: '数码小铺', good: 197, total: 200, city: '广东 深圳', intro: '华强北实体店，主营 MP3、数码相机、U 盘，全部正品行货，支持支付宝担保交易。' },
  { name: '电脑城老陈', good: 36, total: 38, city: '北京', intro: '中关村海龙大厦三层，配件齐全，价格公道，欢迎来店自提。' },
  { name: '二手机王', good: 248, total: 250, city: '上海', intro: '专营二手手机，成色如实描述，无拆无修，七天包退。' },
  { name: '潮流前线', good: 118, total: 120, city: '浙江 杭州', intro: '专柜正品服饰鞋帽，支持七天退换。' },
  { name: '小乖服饰', good: 120, total: 124, city: '广东 广州', intro: '广州十三行批发档口直发，物美价廉。' },
  { name: '书香门第', good: 236, total: 240, city: '北京', intro: '正版新书，塑封未拆，满 50 元包平邮。' },
  { name: '影碟世界', good: 61, total: 66, city: '广东 深圳', intro: 'VCD/DVD 影碟批发零售，国粤双语，港版正货。' },
  { name: '温馨家居', good: 131, total: 135, city: '江苏 苏州', intro: '家居小百货，让生活更温馨。' },
  { name: '小熊数码', good: 117, total: 120, city: '上海', intro: '徐家汇太平洋数码广场，索尼、朗科授权经销。' },
  { name: '海淀书虫', good: 218, total: 220, city: '北京', intro: '海淀图书城旧书新书都有，考试用书最全。' },
  { name: '靓妹坊', good: 33, total: 36, city: '广东 广州', intro: '韩版女装，每周上新，拍下 24 小时内发货。' },
  { name: '好运家纺', good: 147, total: 150, city: '江苏 南通', intro: '南通家纺城厂家直销，全棉印花四件套。' },
  { name: '音像大王', good: 87, total: 90, city: '广东 广州', intro: '正版 CD/磁带，港台新碟同步上架。' },
  { name: '学生装备店', good: 42, total: 45, city: '浙江 温州', intro: '书包、钱包、文具，学生党最爱。' },
];

export const BUYERS = ['demo', 'tb_88', 'cool_boy', 'lucy', 'jeanslover', 'reader01', 'shopping_girl', 'oldwang', 'netbar2003', 'xiaoyu'];

const HISTORY_MEMBERS = [
  '网虫2002', 'bluesky', '小猫咪', 'java_boy', '阿飞', 'rainbow', '冰淇淋', 'hz_leo', '三月', 'maggie',
  '老顽童', 'sunny_day', '笨笨熊', 'kevin88', '大头', 'echo', '紫色风铃', 'tiger', '晓风', 'annie',
  '白开水', 'coolcat', '小丸子', 'dragon', '夏天', 'wind', '爱吃鱼', 'mike_sh', '豆豆', 'lily2003',
  '流浪者', 'peter', '柠檬草', 'jack', '石头', 'vivian', '胖胖', 'nick', '雨夜', 'candy',
  '木头人', 'tony', '蓝色海洋', 'grace', '阿强', 'simon', '小米', 'judy',
];

// 前 9 件与原型顺序一致
export const PRODUCTS = [
  { cat: '数码', title: '爱国者 MP3 播放器 128M 带 FM 收音', descr: '支持 MP3/WMA，USB 1.1 即插即用，附耳机', tag: '担保交易', price: 399, orig: 499, sold: 128, stock: 15, seller: '数码小铺', detail: '全新正品，保修一年，送挂绳一条。\n128M 可以存 30 首左右 MP3，FM 收音可以听广播。' },
  { cat: '数码', title: '清华紫光 USB 摄像头 30 万像素', descr: '视频聊天必备，支持 Win98/2000/XP', tag: '', price: 128, orig: 168, sold: 56, stock: 40, seller: '电脑城老陈', detail: '附驱动光盘。QQ 视频、MSN 都能用。' },
  { cat: '数码', title: '诺基亚 3310 二手 9 成新', descr: '经典机型，贪吃蛇，超长待机', tag: '二手', price: 350, orig: 1200, sold: 9, stock: 2, seller: '二手机王', detail: '无拆无修，带原装电池和充电器。外壳有细微使用痕迹。' },
  { cat: '服饰', title: '李维斯 501 直筒牛仔裤 (专柜正品)', descr: '经典蓝，32 码', tag: '担保交易', price: 268, orig: 599, sold: 74, stock: 12, seller: '潮流前线', detail: '支持七天退换。尺码请参考：32 码腰围 2 尺 5。' },
  { cat: '服饰', title: '纯棉短袖 T 恤 印花 白色', descr: '夏日必备，多色可选', tag: '', price: 29, orig: 59, sold: 412, stock: 200, seller: '小乖服饰', detail: '100% 纯棉，M/L/XL 均有，拍下留言尺码。' },
  { cat: '图书', title: '哈利·波特与凤凰社 (中文版)', descr: '人民文学出版社，2003 年新书', tag: '新书上架', price: 45, orig: 59, sold: 233, stock: 60, seller: '书香门第', detail: '正版新书，塑封未拆。' },
  { cat: '图书', title: '大话西游 VCD 双碟装', descr: '周星驰经典，国粤双语', tag: '', price: 18, orig: 28, sold: 88, stock: 30, seller: '影碟世界', detail: '' },
  { cat: '家居', title: '护眼台灯 学生学习灯', descr: '可调光，节能灯管', tag: '', price: 58, orig: 88, sold: 67, stock: 25, seller: '温馨家居', detail: '附赠灯管一支。' },
  { cat: '家居', title: '不锈钢保温杯 500ml', descr: '24 小时保温', tag: '包邮', price: 35, orig: 49, sold: 150, stock: 80, seller: '温馨家居', detail: '' },
  { cat: '数码', title: '三星 YEPP MP3 播放器 64M 超薄', descr: '仅 28 克，支持歌词显示，韩国原装', tag: '担保交易', price: 299, orig: 399, sold: 41, stock: 8, seller: '数码小铺', detail: '原装耳机、数据线、光盘齐全，保修一年。' },
  { cat: '数码', title: '罗技 光电鼠标 USB/PS2 双接口', descr: '800dpi 光电，无需鼠标垫', tag: '', price: 85, orig: 120, sold: 203, stock: 55, seller: '电脑城老陈', detail: '三年质保，坏了直接换。' },
  { cat: '数码', title: '索尼 CD 随身听 D-EJ011 防震', descr: 'G-Protection 防震，续航 50 小时', tag: '', price: 420, orig: 580, sold: 33, stock: 6, seller: '小熊数码', detail: '日版机器，附充电电池两节。' },
  { cat: '数码', title: '朗科 U 盘 128M 优盘', descr: 'USB 2.0，免驱动，带写保护开关', tag: '担保交易', price: 199, orig: 260, sold: 156, stock: 30, seller: '小熊数码', detail: '朗科正品，终身保固。' },
  { cat: '数码', title: '柯达 EasyShare CX4230 数码相机', descr: '200 万像素，3 倍光变，简单易用', tag: '', price: 1580, orig: 1999, sold: 12, stock: 3, seller: '数码小铺', detail: '送 32M CF 卡和相机包。' },
  { cat: '数码', title: '索爱 T68i 彩屏手机 二手 8 成新', descr: '蓝牙、彩屏，可外接摄像头', tag: '二手', price: 680, orig: 2380, sold: 4, stock: 1, seller: '二手机王', detail: '边角有轻微磨损，功能全部正常。' },
  { cat: '数码', title: '飞利浦 USB 耳机麦克风 网络聊天', descr: 'QQ 语音、网络电话必备', tag: '', price: 45, orig: 68, sold: 98, stock: 70, seller: '电脑城老陈', detail: '' },
  { cat: '服饰', title: '耐克 Air 系列 运动鞋 42 码', descr: '气垫减震，白灰配色', tag: '担保交易', price: 399, orig: 799, sold: 37, stock: 9, seller: '潮流前线', detail: '专柜正品，带原盒。' },
  { cat: '服饰', title: '韩版 淑女连衣裙 碎花 M 码', descr: '2003 夏季新款，雪纺面料', tag: '新款', price: 88, orig: 138, sold: 210, stock: 45, seller: '靓妹坊', detail: '拍下 24 小时内发货。' },
  { cat: '服饰', title: '佐丹奴 POLO 衫 男款 藏青', descr: '经典款，透气排汗', tag: '', price: 69, orig: 129, sold: 156, stock: 80, seller: '小乖服饰', detail: 'M/L/XL 均有货，拍下留言尺码。' },
  { cat: '服饰', title: '阿迪达斯 三条纹 运动长裤', descr: '黑色，侧边三条白杠', tag: '', price: 168, orig: 299, sold: 52, stock: 15, seller: '潮流前线', detail: '' },
  { cat: '服饰', title: '真皮 男士短款钱包 头层牛皮', descr: '多卡位，送礼盒', tag: '', price: 48, orig: 98, sold: 133, stock: 60, seller: '学生装备店', detail: '温州皮具厂直销。' },
  { cat: '服饰', title: '帆布双肩背包 学生书包', descr: '加厚帆布，可放 A4 书本', tag: '包邮', price: 39, orig: 69, sold: 288, stock: 100, seller: '学生装备店', detail: '全国包平邮。' },
  { cat: '图书', title: '《大话西游》剧照画册 珍藏版', descr: '一百多幅剧照，附经典台词', tag: '', price: 25, orig: 38, sold: 41, stock: 12, seller: '影碟世界', detail: '' },
  { cat: '图书', title: '《Windows XP 从入门到精通》', descr: '清华大学出版社，附光盘', tag: '', price: 32, orig: 45, sold: 167, stock: 50, seller: '海淀书虫', detail: '' },
  { cat: '图书', title: '《魔戒》三部曲 中文版 套装', descr: '译林出版社，三册全', tag: '担保交易', price: 98, orig: 128, sold: 145, stock: 25, seller: '书香门第', detail: '正版新书，满 50 元包平邮。' },
  { cat: '图书', title: '《射雕英雄传》金庸 三联版 4 册', descr: '三联书店 94 年版，九成新', tag: '二手', price: 68, orig: 88, sold: 96, stock: 18, seller: '海淀书虫', detail: '书页干净无划线。' },
  { cat: '图书', title: '无间道 VCD 双碟装', descr: '刘德华 梁朝伟，港版国粤双语', tag: '', price: 18, orig: 28, sold: 122, stock: 40, seller: '影碟世界', detail: '' },
  { cat: '图书', title: '周杰伦《叶惠美》CD 专辑', descr: '2003 年 7 月新专辑，正版引进', tag: '新碟上架', price: 25, orig: 38, sold: 355, stock: 90, seller: '音像大王', detail: '附歌词本。' },
  { cat: '图书', title: '《星火英语四级词汇》', descr: '词根 + 联想记忆法', tag: '', price: 15, orig: 22, sold: 240, stock: 70, seller: '海淀书虫', detail: '' },
  { cat: '家居', title: '全棉印花 四件套 1.5 米床', descr: '南通家纺，活性印染不褪色', tag: '包邮', price: 128, orig: 198, sold: 78, stock: 30, seller: '好运家纺', detail: '被套 200×230，床单 230×250，枕套一对。' },
  { cat: '家居', title: '雅致 陶瓷茶具 一壶四杯', descr: '景德镇青花，送礼自用皆宜', tag: '', price: 66, orig: 99, sold: 43, stock: 22, seller: '温馨家居', detail: '泡沫箱加固包装。' },
  { cat: '家居', title: '电热水壶 1.8L 自动断电', descr: '不锈钢内胆，3 分钟烧开', tag: '', price: 79, orig: 119, sold: 112, stock: 35, seller: '温馨家居', detail: '' },
  { cat: '数码', title: '金士顿 256M DDR 内存条 PC2700', descr: '台产原装，终身质保', tag: '', price: 260, orig: 320, sold: 6, stock: 20, seller: '电脑城老陈', detail: '' },
  { cat: '服饰', title: '纯棉 情侣 T 恤 一对装', descr: '七夕特供，可印字', tag: '新款', price: 55, orig: 99, sold: 12, stock: 40, seller: '靓妹坊', detail: '拍下留言要印的字。' },
  { cat: '家居', title: '塑料收纳箱 三件套 大中小', descr: '透明加厚，可叠放', tag: '包邮', price: 45, orig: 68, sold: 3, stock: 60, seller: '好运家纺', detail: '' },
];

// 配图搜索词（scripts/fetch-seed-images.mjs 使用），键为 p01…p35
export const IMAGE_QUERIES = Object.fromEntries([
  'mp3 player', 'webcam', 'old nokia phone', 'blue jeans folded', 'white t-shirt', 'thick book', 'compact disc case', 'desk lamp',
  'thermos bottle', 'portable music player', 'computer mouse', 'portable cd player', 'usb flash drive', 'compact digital camera',
  'old mobile phone', 'headset microphone', 'white sneakers', 'floral dress', 'navy polo shirt', 'black track pants', 'leather wallet',
  'canvas backpack', 'photo book', 'computer book', 'books stack', 'old books', 'dvd case', 'cd album', 'study book', 'bedding',
  'chinese tea set', 'electric kettle', 'ram memory', 't-shirts', 'plastic storage box',
].map((q, i) => [`p${String(i + 1).padStart(2, '0')}`, q]));

// 原型里的评价（pid 为上表序号，从 1 起）
const PROTO_REVIEWS = [
  { pid: 1, who: 'tb_88', text: '音质不错，就是充电有点慢', days: 6 },
  { pid: 1, who: 'cool_boy', text: '很小巧，好评！', days: 10 },
  { pid: 2, who: 'lucy', text: '画面还行，够用', days: 19 },
  { pid: 4, who: 'jeanslover', text: '版型很正，值', days: 8 },
  { pid: 6, who: 'reader01', text: '第一时间拿到了，很厚一本', days: 4 },
  { pid: 2, who: 'netbar2003', text: '驱动装了半天，后来发现是我的 98 系统问题，东西没问题', grade: 0 },
  { pid: 3, who: 'oldwang', text: '成色确实九成新，贪吃蛇玩了一晚上' },
  { pid: 5, who: 'shopping_girl', text: '29 块钱能买到这样的质量很不错了，买了三件' },
  { pid: 5, who: 'xiaoyu', text: '洗了一次有点缩水', grade: 0 },
  { pid: 6, who: 'xiaoyu', text: '塑封完好，正版无疑' },
  { pid: 7, who: 'cool_boy', text: '画质一般，毕竟是 VCD，胜在便宜' },
  { pid: 8, who: 'reader01', text: '灯光柔和，晚上看书眼睛不累' },
  { pid: 9, who: 'oldwang', text: '保温效果好，早上灌的水下午还烫' },
  { pid: 9, who: 'netbar2003', text: '杯盖有点漏水，卖家补发了一个盖子', grade: 0 },
  { pid: 10, who: 'tb_88', text: '比爱国者的薄多了，歌词显示很酷' },
  { pid: 11, who: 'netbar2003', text: '网吧一口气买了 20 个，耐用' },
  { pid: 12, who: 'xiaoyu', text: '索尼的做工没得说，跑步也不跳碟' },
  { pid: 13, who: 'reader01', text: '128M 存论文绰绰有余，免驱动方便' },
  { pid: 14, who: 'shopping_girl', text: '第一台数码相机，200 万像素洗 5 寸照片够了' },
  { pid: 17, who: 'jeanslover', text: '正品无疑，鞋盒都在，气垫很软' },
  { pid: 18, who: 'shopping_girl', text: '裙子很仙，同事都问在哪买的' },
  { pid: 18, who: 'xiaoyu', text: '雪纺有点透，要穿打底', grade: 0 },
  { pid: 21, who: 'netbar2003', text: '皮子软，礼盒也精致，送爸爸的' },
  { pid: 22, who: 'reader01', text: '装了七八本书也没问题，包邮太划算了' },
  { pid: 25, who: 'reader01', text: '译林版翻译流畅，收藏了' },
  { pid: 26, who: 'oldwang', text: '三联版的经典，九成新很满意' },
  { pid: 28, who: 'shopping_girl', text: '以父之名太好听了，正版歌词本也有' },
  { pid: 30, who: 'shopping_girl', text: '布料厚实，洗了不褪色' },
  { pid: 31, who: 'xiaoyu', text: '茶壶有个小瑕疵，卖家退了 10 块', grade: 0 },
  { pid: 32, who: 'oldwang', text: '烧水快，自动断电放心' },
  { pid: 8, who: 'tb_88', text: '开关有点松，用了两个月坏了，联系卖家说过了保修期', grade: -1 },
];

const GOOD_TEXTS = ['东西不错，和描述的一样', '发货很快，包装仔细', '好评！下次还来', '卖家很热情，推荐', '质量很好，价格实惠', '第二次在这家买了，放心', '收到了，很满意', '物超所值', '回答问题很耐心，好卖家', '正品，放心'];
const MID_TEXTS = ['东西一般，凑合用', '发货有点慢，等了一个星期', '和图片有点差别', '包装简陋了点'];
const BAD_TEXTS = ['收到就是坏的，联系卖家很久才回', '和描述严重不符', '拍下三天才发货'];
const BUYER_TEXTS = ['爽快的买家，欢迎再来', '付款及时，好买家', '沟通愉快', '好买家，谢谢惠顾'];

const ADDR = {
  demo: ['王小明', '浙江省杭州市文二路 88 号 3 幢 201 室', '0571-88881234'],
  tb_88: ['陈大伟', '广东省广州市天河区体育西路 103 号', '020-38881234'],
  cool_boy: ['刘晓东', '上海市徐汇区漕溪北路 399 号 1202 室', '021-64871234'],
  lucy: ['林小慧', '福建省厦门市思明区厦大学生公寓 7 号楼', '0592-2181234'],
  jeanslover: ['张强', '北京市朝阳区三里屯北小街 5 号', '010-65321234'],
  reader01: ['赵书林', '湖北省武汉市武昌区珞珈山 16 号', '027-68751234'],
  shopping_girl: ['孙丽', '四川省成都市锦江区春熙路 21 号', '028-86661234'],
  oldwang: ['王建国', '黑龙江省哈尔滨市道里区中央大街 88 号', '0451-84681234'],
  netbar2003: ['周海', '江苏省南京市鼓楼区湖南路 12 号 飞翔网吧', '025-83301234'],
  xiaoyu: ['吴小雨', '重庆市渝中区解放碑民族路 166 号', '023-63831234'],
};

export function seedDemo(ctx, { onlyIfEmpty = true } = {}) {
  const { db, settings, config } = ctx;
  if (onlyIfEmpty && (settings.get('demo_seeded') || db.prepare("SELECT 1 FROM users WHERE role <> 'admin' LIMIT 1").get())) return false;

  // 固定种子的线性同余随机数，保证每次导入结果一致
  let seed = 20030510;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return Math.floor((seed / 2147483648) * n); };
  const t0 = now();
  const day = (d) => Math.round(t0 - d * 86400 - rnd(20000));
  const demoHash = hashPassword(DEMO_PASSWORD);
  const imgDir = path.join(config.root, 'seed/images');

  db.transaction(() => {
    const setHash = db.prepare('UPDATE users SET password_hash = ?, shop_intro = ? WHERE id = ?');
    const users = {};
    const sellerIds = {};
    for (const s of SELLERS) {
      const id = createUser(ctx, { username: s.name, passwordHash: demoHash, city: s.city, balanceCents: 100000, createdAt: day(700 + rnd(40)) });
      setHash.run(demoHash, s.intro, id);
      users[s.name] = id;
      sellerIds[s.name] = id;
    }
    for (const b of BUYERS) {
      const created = day(560 + rnd(100));
      const id = createUser(ctx, { username: b, passwordHash: demoHash, city: ADDR[b][1].slice(0, 2), balanceCents: 100000, createdAt: created });
      setHash.run(demoHash, '', id);
      alipay(db, id, 400000, '老会员回馈金（演示用虚拟资金）', '', created + 86400);
      users[b] = id;
    }
    const history = HISTORY_MEMBERS.map((name) => {
      // 历史会员不能登录（密码散列是无效值）
      const id = createUser(ctx, { username: name, passwordHash: '!', balanceCents: 0, createdAt: day(690 + rnd(30)) });
      return id;
    });

    // 宝贝：原型 9 件最近上架（默认排序在最前），其余散布在过去一年多
    const insItem = db.prepare(`INSERT INTO items (id, seller_id, cat, title, descr, tag, price_cents, orig_cents, stock, sold, city, detail, images, status, search_text, listed_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'onsale', ?, ?, ?, ?)`);
    const itemIds = [];
    PRODUCTS.forEach((p, i) => {
      const listed = i < 9 ? Math.round(t0 - (8 + i) * 86400) : day(40 + rnd(500));
      const key = `p${String(i + 1).padStart(2, '0')}`;
      const images = fs.existsSync(path.join(imgDir, `${key}.jpg`)) ? [`/uploads/seed/${key}.jpg`] : [];
      const seller = SELLERS.find((s) => s.name === p.seller);
      insItem.run(i + 1, sellerIds[p.seller], p.cat, p.title, p.descr, p.tag, Math.round(p.price * 100), Math.round(p.orig * 100), p.stock, p.sold, seller.city, p.detail,
        JSON.stringify(images), buildSearchText({ ...p, sellerName: p.seller }), listed, listed - 86400 * rnd(30), listed);
      itemIds.push(i + 1);
    });
    const itemsOf = (sellerName) => PRODUCTS.map((p, i) => ({ ...p, id: i + 1 })).filter((p) => p.seller === sellerName);

    // 历史评价：让每位卖家的好评数、评价总数接近设定值
    for (const s of SELLERS) {
      const mine = itemsOf(s.name);
      const protoCount = PROTO_REVIEWS.filter((r) => PRODUCTS[r.pid - 1].seller === s.name).length;
      const n = Math.max(0, s.total - protoCount - 3);
      const badN = Math.floor((s.total - s.good) / 3);
      const midN = Math.max(0, s.total - s.good - badN);
      const span = 640 * 86400;
      const start = t0 - 700 * 86400;
      for (let k = 0; k < n; k++) {
        const grade = k % 37 === 5 && k / 37 < badN ? -1 : k % 23 === 11 && k / 23 < midN ? 0 : 1;
        const it = mine[k % mine.length];
        const texts = grade === 1 ? GOOD_TEXTS : grade === 0 ? MID_TEXTS : BAD_TEXTS;
        insertRating(db, {
          itemId: it.id, itemTitle: it.title, role: 'seller', fromId: history[(k * 7 + s.name.length) % history.length], toId: sellerIds[s.name],
          grade, text: texts[rnd(texts.length)], createdAt: Math.round(start + ((k + 1) * span) / (n + 1)) + rnd(20000),
        });
      }
    }
    for (const r of PROTO_REVIEWS) {
      const p = PRODUCTS[r.pid - 1];
      insertRating(db, {
        itemId: r.pid, itemTitle: p.title, role: 'seller', fromId: users[r.who], toId: sellerIds[p.seller],
        grade: r.grade ?? 1, text: r.text, createdAt: r.days ? day(r.days) : day(30 + rnd(300)),
      });
    }

    // 订单
    const insOrder = db.prepare(`INSERT INTO orders (no, buyer_id, seller_id, goods_cents, ship, ship_fee_cents, total_cents, receiver, address, tel, note, status, logistics_company, logistics_no, close_reason, closed_by, created_at, shipped_at, auto_confirm_at, done_at, closed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insOI = db.prepare('INSERT INTO order_items (order_id, item_id, title, cat, image, price_cents, qty) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const usedNo = new Set();
    const NOTES = ['', '', '请用报纸包好，谢谢', '尽快发货', '', '周末送货，工作日家里没人', ''];
    const mkOrder = (buyer, lines, status, createdAt, { ship = 'post', no = null, buyerRate = null, sellerRate = null } = {}) => {
      if (!no) { do { no = `TB${10000000 + rnd(89999999)}`; } while (usedNo.has(no)); }
      usedNo.add(no);
      const sellerName = PRODUCTS[lines[0][0] - 1].seller;
      const sellerId = sellerIds[sellerName];
      const goods = lines.reduce((a, [pid, qty]) => a + Math.round(PRODUCTS[pid - 1].price * 100) * qty, 0);
      const fee = ship === 'ems' ? 2000 : 0;
      const [receiver, address, tel] = ADDR[buyer];
      const shipped = status === 'paid' || (status === 'closed') ? null : createdAt + 3600 * (3 + rnd(20));
      const done = status === 'done' ? shipped + 86400 * (2 + rnd(5)) : null;
      const closed = status === 'closed' ? createdAt + 3600 * (1 + rnd(10)) : null;
      const autoAt = shipped ? shipped + config.autoConfirmDays * 86400 : null;
      const company = shipped ? (ship === 'ems' ? 'EMS' : '中国邮政平邮') : '';
      const trackNo = shipped ? `${ship === 'ems' ? 'EE' : 'PA'}${100000000 + rnd(899999999)}CN` : '';
      const oid = insOrder.run(no, users[buyer], sellerId, goods, ship, fee, goods + fee, receiver, address, tel, NOTES[rnd(NOTES.length)], status,
        company, trackNo, closed ? '我不想买了' : '', closed ? 'buyer' : '', createdAt, shipped, autoAt, done, closed).lastInsertRowid;
      for (const [pid, qty] of lines) {
        const p = PRODUCTS[pid - 1];
        const key = `p${String(pid).padStart(2, '0')}`;
        insOI.run(oid, pid, p.title, p.cat, fs.existsSync(path.join(imgDir, `${key}.jpg`)) ? `/uploads/seed/${key}.jpg` : '', Math.round(p.price * 100), qty);
        if (status === 'paid' || status === 'shipped') db.prepare('UPDATE items SET stock = MAX(0, stock - ?) WHERE id = ?').run(qty, pid);
      }
      alipay(db, users[buyer], -(goods + fee), `付款给卖家 ${sellerName}（担保交易，确认收货后打给卖家）`, no, createdAt);
      orderLog(db, oid, buyer, `买家拍下宝贝并通过支付宝付款 ￥${((goods + fee) / 100).toFixed(2)}`, createdAt);
      if (closed) {
        alipay(db, users[buyer], goods + fee, '交易关闭，货款退回（我不想买了）', no, closed);
        orderLog(db, oid, buyer, '买家取消了交易：我不想买了。货款已退回买家支付宝，库存已退回', closed);
      }
      if (shipped) orderLog(db, oid, sellerName, `卖家已发货：${company} 运单号 ${trackNo}`, shipped);
      if (done) {
        alipay(db, sellerId, goods + fee, '交易成功，买家确认收货，货款到账', no, done);
        orderLog(db, oid, buyer, '买家确认收货，支付宝已把货款打给卖家', done);
        const first = PRODUCTS[lines[0][0] - 1];
        if (buyerRate) insertRating(db, { orderId: oid, itemId: lines[0][0], itemTitle: first.title, role: 'seller', fromId: users[buyer], toId: sellerId, grade: buyerRate.grade ?? 1, text: buyerRate.text, createdAt: done + 3600 * (1 + rnd(30)) });
        if (sellerRate) insertRating(db, { orderId: oid, itemId: lines[0][0], itemTitle: first.title, role: 'buyer', fromId: sellerId, toId: users[buyer], grade: 1, text: sellerRate, createdAt: done + 3600 * (2 + rnd(40)) });
      }
      return no;
    };

    // 演示账号 demo：各种状态的订单都有一张
    mkOrder('demo', [[1, 1]], 'done', day(40), { no: 'TB20030512', buyerRate: { text: '第二次买了，送给弟弟的，卖家发货很快' }, sellerRate: '爽快的买家，欢迎再来' });
    mkOrder('demo', [[6, 1]], 'done', day(12), { no: 'TB20030601' });
    mkOrder('demo', [[4, 1]], 'shipped', day(1.2), { no: 'TB20030614', ship: 'ems' });
    mkOrder('demo', [[13, 1]], 'paid', day(0.2), { no: 'TB20030618' });
    // 卖家演示：数码小铺有一张待发货、一张已发货
    mkOrder('tb_88', [[10, 1]], 'paid', day(0.5), { no: 'TB20030619' });
    mkOrder('cool_boy', [[14, 1]], 'shipped', day(3), { no: 'TB20030616', ship: 'ems' });

    // 其他会员的历史订单
    const others = BUYERS.slice(1);
    for (let k = 0; k < 40; k++) {
      const ago = k < 8 ? 0.6 + k * 0.8 : 8 + (k - 8) * 11 + rnd(9);
      const at = day(ago);
      const pid = 1 + rnd(PRODUCTS.length);
      const lines = [[pid, 1 + (rnd(5) === 0 ? 1 : 0)]];
      const siblings = itemsOf(PRODUCTS[pid - 1].seller).filter((x) => x.id !== pid);
      if (siblings.length && rnd(4) === 0) lines.push([siblings[rnd(siblings.length)].id, 1]);
      const status = k < 2 ? 'paid' : k < 5 ? 'shipped' : k === 13 || k === 27 ? 'closed' : 'done';
      const rated = status === 'done' && rnd(5) !== 0;
      mkOrder(others[rnd(others.length)], lines, status, at, {
        ship: rnd(4) === 0 ? 'ems' : 'post',
        buyerRate: rated ? { text: GOOD_TEXTS[rnd(GOOD_TEXTS.length)] } : null,
        sellerRate: rated && rnd(3) !== 0 ? BUYER_TEXTS[rnd(BUYER_TEXTS.length)] : null,
      });
    }

    // 宝贝留言
    const insQ = db.prepare('INSERT INTO questions (item_id, asker_id, seller_id, text, reply, created_at, replied_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const q = (who, pid, text, reply, ago) => insQ.run(pid, users[who], sellerIds[PRODUCTS[pid - 1].seller], text, reply, day(ago), reply ? day(ago - 0.3) : null);
    q('demo', 1, '请问 MP3 还有货吗？能便宜点吗？', '有货的，价格已经是最低了，多买两件送挂绳～', 45);
    q('cool_boy', 3, '3310 的电池现在还能待机几天？', '正常用 4-5 天没问题，电池是新换的。', 30);
    q('oldwang', 31, '茶具寄到哈尔滨会不会碎？', '泡沫箱加固包装，路上碎了包赔。', 16);
    q('jeanslover', 4, '32 码适合多高的人穿？', '175 左右、130 斤上下穿 32 码正好。', 9);
    q('lucy', 18, '连衣裙有 S 码吗？我 160 的个子', '', 2);
    q('netbar2003', 11, '网吧要 30 个光电鼠标，能再便宜点吗？', '', 0.5);
    q('tb_88', 10, '64M 能放多少首歌？', '', 0.8);

    // 收藏夹与地址簿
    for (const pid of [12, 17, 25]) db.prepare('INSERT INTO favorites (user_id, item_id, created_at) VALUES (?, ?, ?)').run(users.demo, pid, day(5 + rnd(10)));
    for (const b of BUYERS) db.prepare('INSERT INTO addresses (user_id, receiver, address, tel, updated_at) VALUES (?, ?, ?, ?, ?)').run(users[b], ...ADDR[b], day(5 + rnd(30)));

    settings.set('demo_seeded', String(t0));
  })();
  return true;
}
