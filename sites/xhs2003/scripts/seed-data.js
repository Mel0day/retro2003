// 演示数据：还原设计稿里的内容，并补充足够的笔记、留言、帖子、商品和相册。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createUser } from '../src/services/bootstrap.js';
import { createNote, addComment, recountNoteOwners, recountTags } from '../src/services/notes.js';
import { now } from '../src/lib/format.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IMG_SRC = path.join(ROOT, 'seed/images');

// 可复现的伪随机数
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

const USERS = [
  ['小鹿乱撞', '北京 海淀', 1250, '', '#c69', 'female'],
  ['阿May', '广州 天河', 980, '', '#c96', 'female'],
  ['背包客小张', '上海 徐汇', 3820, '资深驴友', '#5a7', 'male'],
  ['vivian', '杭州 西湖', 760, '', '#96c', 'female'],
  ['Lemon树', '成都 武侯', 540, '', '#9c6', 'female'],
  ['数码迷', '深圳 南山', 1520, '', '#6ac', 'male'],
  ['毛线球', '哈尔滨 南岗', 320, '', '#a85', 'female'],
  ['小厨娘', '武汉 洪山', 410, '', '#c66', 'female'],
  ['胶片少年', '南京 鼓楼', 690, '', '#c69', 'male'],
  ['淘淘', '上海 黄浦', 260, '', '#69c', 'female'],
  ['Sunny', '西安 雁塔', 180, '', '#e90', 'female'],
  ['摄影小白', '苏州 姑苏', 150, '', '#7a9', 'male'],
  ['书虫', '长沙 岳麓', 330, '', '#963', 'female'],
  ['仓鼠妈妈', '天津 南开', 220, '', '#c96', 'female'],
  ['阿力', '重庆 渝中', 90, '', '#58a', 'male'],
  ['手作猫', '厦门 思明', 140, '', '#a7a', 'female'],
  ['水木年华', '北京 海淀', 120, '', '#69c', 'male'],
  ['吃货一枚', '绍兴 越城', 420, '', '#c96', 'female'],
  ['小雨', '宁波 鄞州', 60, '', '#9c6', 'female'],
];

const XITANG = `上周末终于去了念了很久的西塘。从上海出发，人民广场坐旅游专线大巴，两个半小时到镇口，票价 22 元。两天一夜，人均花费 [color=#c00][b]186 元[/b][/color]，下面把行程、住宿和注意事项都记一下，方便大家参考。

[fimg=图1：早晨的西街，人还很少（点击看大图）]{xitang1}[/fimg]
进镇门票 30 元（含 11 个景点），如果不打算进景点，晚上 5 点后从西街小巷进去是不收票的，当地人都这么走。

镇子不大，两条主街沿河，一边是烟雨长廊，一边是酒吧一条街。白天走长廊，晚上去石皮弄看灯。

[h]一、行程安排[/h]
[table]
[tr][th]时间[th]安排[th]费用[/tr]
[tr][td]D1 08:00[td]人民广场旅游专线出发[td]22[/tr]
[tr][td]D1 10:30[td]到镇口，步行进镇，放行李[td]0[/tr]
[tr][td]D1 11:30[td]西街午饭：荠菜馄饨 + 芡实糕[td]12[/tr]
[tr][td]D1 13:00[td]烟雨长廊、石皮弄、送子来凤桥[td]30 门票[/tr]
[tr][td]D1 18:30[td]长廊边老鸭汤，夜游看灯[td]25[/tr]
[tr][td]D2 06:30[td]早起拍空镜，环秀桥看晨雾[td]0[/tr]
[tr][td]D2 14:30[td]镇口乘末班大巴回上海[td]22[/tr]
[/table]
[h]二、住宿[/h]
住的是塔湾街一家临河的民居客栈，标间 60 元/晚，老板娘很热情，早上还送了粥。房间有点旧，但推开窗就是河，值了。想住好点的可以去镇口的西塘宾馆，160 左右。旺季（五一、十一）一定要提前电话订。

[gallery][img=图2：临河客栈的窗景]{xitang2}[/img][img=图3：夜晚的石皮弄]{xitang3}[/img][img=图4：老鸭汤和芡实糕]{xitang4}[/img][/gallery]
[h]三、吃什么[/h]
必吃：[b]芡实糕[/b]（3 元一条，桂花味最好）、[b]荠菜馄饨[/b]（5 元一碗）、[b]送子龙蹄[/b]（15 元，两个人吃够了）、[b]臭豆腐[/b]。晚上在长廊边吃老鸭汤，一锅 25 元。酒吧街一瓶啤酒 10-15 元，比外面贵不少，坐河边听歌可以，别多喝。

[h]四、注意事项[/h]
[list=1]
[*]石板路很滑，下雨天别穿新鞋。
[*]拍照请带足胶卷，镇上一卷富士 100 要 28 元。
[*]回程末班大巴下午 4 点半，别赶不上。
[*]周末人多，想拍空镜要 7 点前起床。
[/list]
[color=#666]以上就是全部内容，有问题在下面留言，我会尽量回复。祝大家玩得开心 :-)[/color]`;

const XITANG_COMMENTS = [
  ['水木年华', '沙发！小张写得太详细了，正好下周末打算去，收藏了。'],
  ['吃货一枚', '芡实糕真的好吃，我上次买了 10 条带回来。臭豆腐一般，还是绍兴的好。'],
  ['小雨', '请问客栈电话有吗？想十二月去，怕订不到。'],
  ['背包客小张', '回楼上：0573-8456xxxx，找王老板娘，说是小张介绍的。'],
  ['胶片少年', '照片拍得真好，什么相机？我用凤凰 205 拍出来总是发灰……'],
];

const COMMENT_POOL = [
  '顶一个！写得真用心', '收藏了，谢谢分享 ^_^', '楼主好人，一生平安', '学习了，mark 一下',
  '图片好漂亮，求原图', '看完好想去啊 T_T', '支持楼主，期待下一篇', '我也有同感！',
  '这个价格好实在', '周末就去试试', '沙发没抢到，板凳也行 :-P', '已推荐给室友',
  '请问楼主是哪里人？', '写得太好了，比杂志上的还实用', '路过，顶一下', '同城的可以一起啊',
  '我去年去过，确实不错', '好详细，打印出来带着', '有没有更省钱的办法？', '哈哈，最后一张好可爱',
  '楼主的文笔真好', '已经加入收藏夹', '十一去人太多了，建议错峰', '我也想试试，就是懒 -_-!',
  '感谢分享，受益匪浅', '坐等更新', '这个我知道，超好用', '留个脚印 ;-)',
];

const NOTES = [
  // 频道, 作者, 标题, 标签, 点击, 顶, 花, 推荐, 多少小时前, 正文
  ['travel', '背包客小张', '丽江古城穷游七天', '旅行 穷游 丽江', 2412, 58, 12, 0, 400,
    `毕业前给自己的礼物：一个人去丽江，七天只花了 900 块（不含火车票）。

[fimg=图1：从木府往下看古城]{lijiang}[/fimg]
住在四方街附近的青年旅社，床位 15 元一晚，认识了好几个天南海北的朋友。白天在古城里瞎逛，晚上听纳西古乐。

[h]花费明细[/h]
[table][tr][th]项目[th]花费[/tr][tr][td]住宿 6 晚[td]90[/tr][tr][td]吃饭[td]280[/tr][tr][td]玉龙雪山[td]180[/tr][tr][td]泸沽湖包车拼车[td]150[/tr][tr][td]杂项[td]200[/tr][/table]
建议避开五一十一，淡季的丽江才是真的丽江。`],
  ['travel', '背包客小张', '西塘两日游攻略（附路线图、住宿、花费明细）', '西塘 江南 水乡 周末游 穷游 攻略 上海周边', 5107, 126, 43, 1, 290, XITANG],
  ['outfit', '小鹿乱撞', '秋季通勤穿搭 5 套', '穿搭 通勤 秋天 彩妆', 8213, 312, 88, 1, 260,
    `天气转凉，上班穿什么成了每天早上最纠结的事。整理了自己这个月最常穿的 5 套，都是平价单品，适合刚工作的姐妹。

[img=Look 1：驼色大衣 + 深色直筒裤]{outfit}[/img]
[h]Look 1 驼色大衣[/h]
大衣是去年在动物园批发市场淘的，180 元。里面搭高领毛衣，下面深色直筒裤，显高又不挑身材。

[h]Look 2 针织开衫[/h]
[img=Look 2：米色开衫 + 牛仔裤]{sweater}[/img]
开衫一定要选稍微长一点的，遮住胯部。配牛仔裤和帆布鞋，周五穿刚刚好。

[h]小贴士[/h]
[list][*]全身颜色不要超过三种
[*]包包和鞋子同色系更显精致
[*]口红选豆沙色，上班不会太夸张[/list]`],
  ['food', '阿May', '自制珍珠奶茶全过程', '美食 奶茶 甜品', 6520, 201, 61, 1, 250,
    `学校门口的珍珠奶茶涨到 4 块了！于是决定自己做，材料在超市都能买到，一杯成本不到 1 块钱。

[img=成品：满满一杯珍珠]{bubbletea}[/img]
[h]材料[/h]
[list][*]木薯粉 100 克
[*]红糖 30 克
[*]红茶包 2 个
[*]纯牛奶 250 毫升[/list]
[h]步骤[/h]
[list=1][*]红糖加水煮开，趁热倒入木薯粉，揉成团。
[*]搓成黄豆大的小丸子，裹一层干粉防粘。
[*]水开后下锅煮 20 分钟，关火焖 10 分钟。
[*]红茶泡浓，加牛奶和糖，放入珍珠就好啦。[/list]
[b]注意：[/b]珍珠一定要现煮现吃，放久了会变硬。`],
  ['beauty', 'vivian', '平价好用洗面奶测评', '护肤 测评 平价 彩妆', 4933, 150, 37, 1, 230,
    `作为混油皮，这两年洗面奶用了不下十支，挑出 4 支性价比最高的给大家参考。

[img=这支是我的年度最爱]{cleanser}[/img]
[table][tr][th]名称[th]价格[th]清洁力[th]推荐指数[/tr]
[tr][td]洗面奶 A[td]12 元[td]★★★★[td]★★★★★[/tr]
[tr][td]洗面奶 B[td]25 元[td]★★★[td]★★★★[/tr]
[tr][td]洗面奶 C[td]38 元[td]★★★★★[td]★★★[/tr]
[tr][td]洗面奶 D[td]9.9 元[td]★★[td]★★★[/tr][/table]
总结：夏天用清洁力强的，冬天换温和一点的，不用迷信贵的。`],
  ['home', 'Lemon树', '我的 20 平出租屋改造', '家居 租房 改造', 4470, 133, 29, 1, 210,
    `刚毕业租的房子只有 20 平，房东给的家具又旧又丑。花了 600 块和两个周末，改造成了自己喜欢的样子。

[img=改造后的房间]{room}[/img]
[h]花钱清单[/h]
[list][*]浅色墙纸 2 卷：80 元
[*]宜家书架：199 元
[*]床单窗帘一套：150 元
[*]绿植和小摆件：100 元
[*]灯串：30 元[/list]
租房也要好好生活，大家有什么小妙招欢迎留言交流～`],
  ['digital', '数码迷', 'MP3 选购指南（附对比）', '数码 MP3 选购', 3892, 98, 21, 1, 190,
    `最近好多同学问我买哪款 MP3，统一回复一下。预算 300-800 元，主要看这几点：

[img=听歌还是得配个好耳机]{headphones}[/img]
[list=1][*][b]容量：[/b]128MB 能装 30 首左右，256MB 基本够用。
[*][b]电池：[/b]五号电池款出门方便，锂电款更轻薄。
[*][b]音质：[/b]一定要带耳机去店里试听。
[*][b]功能：[/b]收音机和录音很实用，能当 U 盘的更好。[/list]
[img=我现在用的这台]{mp3}[/img]
预算充足的直接上硬盘式的，几千首歌随便装。`],
  ['travel', '背包客小张', '周庄一日 半天足够', '江南 周末游 古镇 美食', 1840, 41, 8, 0, 180,
    `周庄比西塘商业化一些，但双桥真的很美。建议早上 8 点前进镇，半天就能逛完。

[img=清晨的周庄]{zhouzhuang}[/img]
门票 60 元有点贵，万三蹄一定要尝尝。下午可以接着去同里，两个镇离得很近。`],
  ['travel', '摄影小白', '乌镇 vs 西塘 到底去哪个', '水乡 摄影 古镇', 1620, 35, 6, 0, 170,
    `两个地方都去过了，简单对比一下：

[table][tr][th]对比[th]乌镇[th]西塘[/tr][tr][td]商业化[td]东栅较重[td]适中[/tr][tr][td]门票[td]100[td]30[/tr][tr][td]夜景[td]一般[td]很美[/tr][tr][td]推荐人群[td]第一次去江南[td]喜欢拍照的[/tr][/table]
个人更喜欢西塘，有生活气息。`],
  ['travel', '背包客小张', '上海周边周末游 10 个去处', '旅行 上海周边', 1502, 44, 9, 0, 160,
    `上班族周末出行，当天往返或住一晚的 10 个地方：

[list=1][*]朱家角：地铁可达，适合半天
[*]西塘：住一晚看夜景
[*]周庄 + 同里：一天两个镇
[*]苏州园林：拙政园、狮子林
[*]杭州西湖：骑车环湖
[*]南浔古镇：人少安静
[*]崇明岛：骑车吃农家菜
[*]舟山普陀山：拜佛看海
[*]千岛湖：夏天避暑
[*]黄山：需要两天[/list]`],
  ['travel', '背包客小张', '黄山三日 详细路线', '旅行 黄山 登山 攻略', 2105, 66, 14, 0, 150,
    `从后山云谷寺上，前山慈光阁下，这条路线最省力，风景也最全。

[img=西海大峡谷的云海]{huangshan}[/img]
[h]路线[/h]
D1：汤口镇住宿 → D2：云谷寺缆车 → 始信峰 → 北海 → 西海大峡谷 → 光明顶住宿 → D3：看日出 → 莲花峰 → 迎客松 → 慈光阁下山。
山上东西很贵，一瓶水 5 块，建议自带干粮。`],
  ['travel', '单车少年', '杭州西湖骑车环湖', '杭州 骑车 西湖', 1880, 52, 11, 0, 140,
    `租车 10 元一小时，押金 200。从断桥出发，白堤 → 孤山 → 西泠桥 → 苏堤 → 雷峰塔 → 柳浪闻莺，一圈大概 3 小时。

[img=傍晚的西湖]{westlake}[/img]
苏堤上是不让骑车的，要推着走，别被罚款哦。`],
  ['travel', '吃货一枚', '青岛看海吃蛤蜊', '美食 青岛 海边', 1760, 47, 10, 0, 130,
    `青岛的夏天真的太舒服了！每天的日常就是：早上去栈桥看海，中午去营口路市场买海鲜找小饭馆加工，晚上喝一袋散装啤酒。

[b]必吃：[/b]辣炒蛤蜊（10 元一盘）、烤鱿鱼、海菜凉粉。
[b]必去：[/b]八大关、小鱼山、第一海水浴场。`],
  ['travel', '胶片少年', '北京胡同游 自制地图', '北京 胡同 摄影 数码', 1690, 39, 7, 0, 120,
    `花了三个周末走完了南锣鼓巷到后海一带的胡同，画了一张手绘地图，扫描后发上来给大家。

[img=胡同里的老自行车]{album4}[/img]
建议租辆自行车，从鼓楼出发，烟袋斜街 → 银锭桥 → 后海 → 恭王府。`],
  ['travel', '背包客小张', '厦门鼓浪屿两日', '旅行 厦门 海岛', 1580, 36, 5, 0, 110,
    `轮渡 8 元往返，岛上没有汽车，走哪都是风景。

住在岛上的家庭旅馆，推开窗能听到钢琴声。日光岩人太多了，建议早上去；菽庄花园看海最舒服。馅饼和鱼丸一定要买！`],
  ['travel', '摄影小白', '九寨沟十月最美', '九寨沟 摄影 秋天', 1550, 42, 9, 0, 100,
    `十月的九寨沟是一年中颜色最丰富的时候，彩林和海子交相辉映。

[img=九寨沟的秋色]{album1}[/img]
门票加观光车 310 元，建议两天，第一天日则沟，第二天树正沟和则查洼沟。`],
  ['travel', '摄影小白', '龙脊梯田看秋收', '桂林 摄影 梯田 数码', 1320, 30, 6, 0, 96,
    `从桂林坐车 3 小时到龙胜，再换车上山。九月底稻子金黄，漫山遍野都是梯田。

[img=金坑大寨的梯田]{terraces}[/img]
住在山上的瑶族人家里，晚上吃竹筒饭，看满天星星。`],
  ['beauty', 'vivian', '学生党护肤 每月不到 50 元', '护肤 学生 平价', 2210, 70, 13, 0, 53,
    `学生党预算有限，但皮肤也要好好照顾。分享一下我每月不到 50 元的护肤方案：

[list=1][*]洁面：超市 12 元的洗面奶
[*]爽肤水：大宝 10 元
[*]乳液：郁美净 8 元
[*]防晒：15 元的防晒霜，出门必涂
[*]每周一次：黄瓜片 / 蜂蜜面膜，几乎不花钱[/list]
最重要的是早睡，熬夜什么都白搭！`],
  ['beauty', '小鹿乱撞', '5 支平价口红试色', '彩妆 口红 穿搭', 2680, 90, 19, 0, 70,
    `最近入手了 5 支平价口红，价格都在 30 元以内，试色给大家看看。

[img=最喜欢的豆沙色]{lipstick}[/img]
[list][*]1 号正红：显白但比较挑场合
[*]2 号豆沙：上班必备
[*]3 号珊瑚：夏天很清爽
[*]4 号梅子：秋冬气场全开
[*]5 号裸色：适合淡妆[/list]`],
  ['beauty', 'vivian', '雅芳小黑裙香水使用感', '彩妆 香水 穿搭', 1360, 33, 4, 0, 88,
    `朋友送的生日礼物，用了一个月说说感受：前调偏甜，中调是花香，留香大概 4 小时。

[img=瓶子很好看]{perfume}[/img]
68 元的价格很值，适合学生和刚工作的女孩子。`],
  ['food', '小厨娘', '宿舍也能做的电饭锅蛋糕', '美食 甜品 宿舍', 3180, 85, 17, 0, 5,
    `宿舍没有烤箱？电饭锅也能做出松软的蛋糕！

[img=刚出锅的蛋糕]{cake}[/img]
[h]材料[/h]
鸡蛋 4 个、面粉 80 克、白糖 60 克、牛奶 40 毫升、色拉油 30 毫升。
[h]步骤[/h]
[list=1][*]蛋黄蛋白分开，蛋白加糖打到能拉出小尖角。
[*]蛋黄加牛奶、油、面粉拌匀。
[*]把蛋白分三次和蛋黄糊翻拌均匀。
[*]电饭锅刷油，倒入面糊，按煮饭键，跳起后焖 20 分钟，重复两次。[/list]
[color=#c00]注意宿舍用电安全，别被宿管阿姨抓到哦 :-P[/color]`],
  ['food', '吃货一枚', '在家做兰州拉面', '美食 面食 家常菜', 1290, 28, 3, 0, 75,
    `拉面馆的面 5 块一碗，自己做成本 1 块钱。关键在于和面：面粉加盐和蓬灰（可以用小苏打代替），醒面 30 分钟。

[img=浇头随意发挥]{noodles}[/img]
拉不好也没关系，用擀面杖切成宽面，一样好吃！`],
  ['outfit', '毛线球', '冬天到了 分享我的三件羊毛围巾', '穿搭 围巾 冬天', 3510, 92, 20, 0, 2,
    `哈尔滨已经零下了，每天出门必须全副武装。分享三条陪了我好几个冬天的围巾：

[img=最常戴的米白色]{scarf}[/img]
[list=1][*]米白色粗针织：百搭，配什么大衣都好看
[*]红黑格子：圣诞节必戴，喜庆
[*]灰色长款：可以绕两圈，特别暖和[/list]
围巾洗的时候要用冷水手洗，平铺晾干，不然会缩水变形。`],
  ['outfit', '淘淘', '上海南京路小店淘货记', '穿搭 购物 上海', 2600, 61, 9, 0, 28,
    `周末和同学去南京路扫货，发现几家宝藏小店，价格比商场便宜一半。

[img=步行街上人山人海]{street}[/img]
[list][*]毛衣 45 元，砍到 35
[*]牛仔裤 60 元
[*]帆布鞋 29 元
[*]发卡一堆 10 元[/list]
砍价秘诀：先问价，说「我再看看」，老板就会主动降价 ^_^`],
  ['outfit', '小鹿乱撞', '毛衣怎么搭不显胖', '穿搭 毛衣 冬天 彩妆', 2020, 58, 11, 0, 45,
    `冬天穿毛衣总觉得自己胖了一圈？几个小技巧：

[img=V 领毛衣更显瘦]{sweater}[/img]
[list=1][*]选 V 领或者小高领，拉长脖子线条
[*]毛衣前面塞进裤腰一点点
[*]下装选深色、修身的
[*]系一条细腰带[/list]`],
  ['digital', '胶片少年', '第一次用胶片机 感受和心得', '摄影 胶片 数码', 2930, 77, 15, 0, 8,
    `从旧货市场花 120 块淘了一台凤凰 205，第一卷胶卷冲出来，36 张只有 20 张能看，但每一张都很珍贵。

和数码相机最大的不同是，你不知道拍出来是什么样子。按快门之前会想很多：光线够不够？构图好不好？这种等待的感觉让人很上瘾。

[b]新手建议：[/b]
[list=1][*]先买便宜的富士 200 练手
[*]阴天光圈开大，快门别低于 1/60
[*]冲扫一卷大概 25 元，找靠谱的冲印店[/list]`],
  ['digital', '数码迷', '新买的 Nokia 3310 开箱', '数码 手机 开箱', 2380, 64, 12, 0, 38,
    `攒了三个月的工资，终于换掉了用了四年的老爸淘汰下来的砖头机！

[img=经典的造型]{oldphone}[/img]
[list][*]待机时间：官方说 260 小时，实测 5 天一充
[*]贪吃蛇：已经玩到 2000 分
[*]可以自己编铃声，已经编了《两只蝴蝶》
[*]彩壳：另外买了一个红色的，15 块[/list]
唯一的缺点是短信只能存 150 条，要经常删。`],
  ['digital', '数码迷', '数码相机 300 万像素够不够用', '数码 相机 选购', 1750, 40, 8, 0, 90,
    `结论先说：冲洗 6 寸照片，200 万像素就够了；想放大到 10 寸，建议 300 万以上。

[img=小巧的卡片机]{camera}[/img]
比像素更重要的是镜头和光学变焦，数码变焦基本没用。另外一定要多买一张存储卡，16MB 根本不够拍。`],
  ['home', '手作猫', '自己缝的帆布包 有点丑', '家居 手工 穿搭', 1880, 55, 14, 0, 100,
    `第一次用缝纫机，歪歪扭扭做了一个帆布包，虽然线走得不直，但装书刚刚好！

[img=成品，请忽略歪掉的线]{totebag}[/img]
材料：帆布半米 8 元、棉线 2 元、布艺颜料 5 元。下次准备在上面画只猫。`],
  ['home', '书虫', '学生宿舍书桌改造', '家居 学习 宿舍', 1210, 33, 5, 0, 64,
    `宿舍书桌又小又乱？花 50 块改造一下：

[img=改造后的书桌]{desk}[/img]
桌面铺一张墙纸、加一个两层小书架、夹一盏台灯，再放一盆绿萝，心情都好了。`],
  ['books', '书虫', '读《挪威的森林》有感', '读书 村上春树', 1440, 46, 10, 0, 73,
    `第三遍读《挪威的森林》，每次的感受都不一样。

十八岁读的时候，只觉得是一个伤感的爱情故事；现在再读，更多的是对成长和失去的理解。「不要同情自己，同情自己是卑劣懦夫干的勾当。」这句话一直抄在我的笔记本扉页上。

直子和绿子，其实是渡边内心的两面：一个拉着他回到过去，一个推着他走向未来。`],
  ['books', '书虫', '今年读过的 12 本书', '读书 书单 学习', 1100, 30, 6, 0, 120,
    `[img=冬天最适合窝着看书]{books}[/img]
[list=1][*]《平凡的世界》★★★★★
[*]《围城》★★★★
[*]《活着》★★★★★
[*]《百年孤独》★★★
[*]《小王子》★★★★★
[*]《撒哈拉的故事》★★★★
[*]《文化苦旅》★★★
[*]《哈利·波特与凤凰社》★★★★
[*]《傲慢与偏见》★★★★
[*]《三重门》★★★
[*]《边城》★★★★
[*]《追风筝的人》★★★★★[/list]
大家有什么推荐的吗？`],
  ['fitness', '阿力', '健身房新手 求指点', '健身 新手', 980, 12, 1, 0, 96,
    `刚办了健身卡，一年 1200 元。第一次去完全不知道该练什么，跑步机上走了半小时就回来了……

身高 175，体重 80 公斤，想减到 70。请问各位大侠：
[list=1][*]先练有氧还是先练器械？
[*]每周去几次合适？
[*]需不需要请私教？（一节课 150 太贵了）[/list]
先谢谢大家了！`],
  ['fitness', 'Sunny', '跑步一个月瘦了 6 斤', '健身 跑步 减肥', 1380, 35, 7, 0, 140,
    `每天晚上 9 点去操场跑 5 圈（2 公里），坚持了 30 天，体重从 116 斤降到 110 斤。

[img=健身房里的哑铃区]{gym}[/img]
心得：不要一开始就跑很快，慢慢跑，能边跑边说话的速度最好；跑完一定要拉伸。`],
  ['pets', '仓鼠妈妈', '养了两个月的小仓鼠', '宠物 仓鼠', 1720, 68, 16, 0, 78,
    `在花鸟市场 10 块钱买的小仓鼠，取名叫豆豆，现在已经会自己爬到手心里吃瓜子了！

[img=豆豆在啃瓜子]{hamster}[/img]
[b]养仓鼠注意：[/b]
[list][*]笼子里要铺木屑，每周换一次
[*]不能喂巧克力和葱蒜
[*]一定要放跑轮，不然会抑郁
[*]夏天别放在阳台上晒[/list]`],
  ['pets', '手作猫', '家里的猫主子日常', '宠物 猫', 1490, 57, 13, 0, 200,
    `我家的橘猫叫大黄，每天的日常就是：吃、睡、踩奶、把我桌上的笔推到地上。

[img=又钻进被子里了]{cat}[/img]
冬天最喜欢钻被窝，叫都叫不出来。`],
  ['campus', 'Sunny', '考研倒计时 30 天 我的作息表', '学习 考研 校园', 2540, 80, 18, 0, 34,
    `离考研还有 30 天，贴出我的作息表，和研友们互相监督！

[table]
[tr][th]时间[th]安排[/tr]
[tr][td]06:30[td]起床，背单词 30 分钟[/tr]
[tr][td]07:30-11:30[td]数学：真题 + 错题整理[/tr]
[tr][td]14:00-17:00[td]专业课[/tr]
[tr][td]18:30-20:00[td]政治：选择题[/tr]
[tr][td]20:00-22:30[td]英语阅读 + 作文[/tr]
[tr][td]23:00[td]睡觉[/tr]
[/table]
最后一个月，调整好心态最重要。加油！`],
  ['campus', '水木年华', '毕业前想做的 10 件事', '学习 校园 毕业', 1160, 38, 7, 0, 220,
    `[list=1][*]在图书馆通宵一次
[*]去食堂把所有窗口吃一遍
[*]和室友拍一张合照
[*]翘一节课去看海
[*]学会弹吉他
[*]给喜欢的人写一封信
[*]在 BBS 上发一篇长文
[*]参加一次社团演出
[*]考过六级
[*]骑车绕学校一圈[/list]
已完成 6 件，还剩最难的第 6 件……`],
];

const FORUM = [
  // 版块, 作者, 标题, 回复数, 主题类型, 正文, 置顶, 精华
  ['站务公告', '__admin__', '【公告】社区规则 & 新手必读', 12, 'normal',
    `欢迎来到小红书论坛！发帖前请先阅读以下规则：\n\n[list=1][*]禁止发布广告、色情、反动内容\n[*]禁止人身攻击和恶意灌水\n[*]标题要能说明内容，不要用「求助」「急」这种标题\n[*]图片请先上传到相册，再用 [img] 代码插入[/list]\n\n违规者视情节扣分或封号。祝大家玩得开心！`, 1, 1],
  ['灌水乐园', '淘淘', '大家都在用什么 QQ 秀？', 58, 'qqshow', '最近 Q 币充了 10 块，给 QQ 秀换了一身行头，大家都用的什么造型？晒出来看看呀～', 0, 0],
  ['灌水乐园', '水木年华', '晒晒你的 MSN 签名', 43, 'msn', '我的 MSN 签名是：「生活不止眼前的苟且」，大家的呢？', 0, 1],
  ['音乐影视', '胶片少年', '求推荐好听的英文歌', 37, 'music', '最近单曲循环 Westlife 的 My Love，求推荐类似的好听的英文歌，谢谢！', 0, 0],
  ['旅行摄影', '背包客小张', '最想去的旅行地', 31, 'poll', '十一长假快到了，大家最想去哪里？投个票吧！', 0, 0],
  ['意见建议', '__admin__', '征集 版主 各频道', 19, 'mod', '社区发展很快，现招募各版块版主，要求：中级会员以上，每天上线 1 小时，热心公正。有意者直接回帖报名，写上想管理的版块。', 1, 0],
  ['数码天地', '数码迷', '装机配置单 3000 元够不够', 14, 'pc', 'CPU 选赛扬还是速龙？内存 256MB 够用吗？预算 3000 元，主要用来上网、听歌、玩 CS。', 0, 0],
  ['穿搭美妆', '小鹿乱撞', '冬天大衣选什么颜色', 11, 'coat', '准备买今年第一件大衣，驼色、黑色、灰色纠结中……', 0, 0],
  ['情感驿站', '小雨', '毕业了，要不要和他去同一个城市', 9, 'love', '在一起两年了，他去北京工作，我在家乡找到了稳定的工作。好纠结……', 0, 0],
  ['灌水乐园', '阿力', '今天食堂的红烧肉涨价了', 6, 'food', '从 3 块涨到 3 块 5，还让不让人活了！', 0, 0],
];

const REPLY_POOLS = {
  qqshow: ['我的是{a}，花了 {n} 个 Q 币', '{a}！红钻用户路过', '没钱买，一直是默认的光头 T_T', '楼上的造型好可爱', '最近在攒 Q 币买{a}', '{a}太贵了，一套要 {n} 块', '我喜欢{a}，看起来很酷', '哈哈，QQ 秀都是浮云', '我换了{a}，室友说很土 -_-!'],
  msn: ['我的签名：「{s}」', '「{s}」，最近心情不太好', '签名换了好几次，现在是「{s}」', '好文艺啊，学习了', '「{s}」—— 送给自己', '楼上的签名有深意', '我从来不写签名 :-P'],
  music: ['推荐 {m}，超好听', '{m} 必听！', '楼主可以听听 {m}', '顶楼上，{m} 我也很喜欢', '最近在听 {m}，单曲循环中', '去买 Now 合辑，里面都是好歌', '{m} 的歌词特别适合练英语'],
  poll: ['投了{p}，去年去过一次还想去', '{p}！等攒够钱就去', '我选{p}，好想看看那边的风景', '同投{p}', '想去的太多了，纠结', '十一出门就是看人头 T_T', '已投，{p}走起'],
  mod: ['报名！想管理{b}版块，每天晚上都在线', '支持站长，报名{b}', '我可以帮忙管{b}，经常在线', '中级会员了吗？看看我的积分……', '顶一下，希望社区越来越好', '{b}版需要人管理，灌水太严重了'],
  pc: ['速龙性价比高', '内存至少 512MB，不然玩 CS 卡', '3000 够了，显示器选 17 寸纯平', '建议去电脑城多砍砍价', '赛扬超频也不错'],
  coat: ['驼色百搭', '黑色耐脏，适合学生', '灰色显气质', '我买了驼色，一点都不后悔'],
  love: ['跟着心走吧', '两个人一起努力，距离不是问题', '稳定的工作也很重要，好好想想', '我也经历过，最后分手了……', '加油，祝福你们'],
  food: ['我们学校也涨了', '改吃土豆丝吧', '哈哈，民以食为天', '食堂阿姨手抖得更厉害了'],
  normal: ['收到！', '支持站长', '新人报到，会遵守规则的', '已阅', '顶，规则很合理'],
};
const FILL = {
  a: ['星空礼服', '粉色兔耳', '牛仔造型', '忍者套装', '小熊睡衣', '魔法师长袍', '海盗船长', '古装侠客'],
  n: ['8', '10', '15', '20', '30', '50'],
  s: ['我是一只小小鸟', '明天会更好', '在路上', '想念是会呼吸的痛', '做最好的自己', '人生若只如初见', '努力学习天天向上', '我在等风也等你'],
  m: ['Yesterday Once More', 'Right Here Waiting', 'My Heart Will Go On', 'Nothing\'s Gonna Change My Love For You', 'Take Me To Your Heart', 'Big Big World', 'Seasons In The Sun', 'Soledad', 'I Want It That Way'],
  p: ['丽江', '西藏', '三亚', '九寨沟', '北京', '厦门'],
  b: ['穿搭美妆', '旅行摄影', '数码天地', '灌水乐园', '音乐影视'],
};

const PRODUCTS = [
  // 分类, 名称, 价格(分), 市场价, 库存, 销量, 图片, 推荐, 描述
  ['美妆个护', '雅芳小黑裙淡香水', 6800, 8800, 120, 342, 'perfume', 1, '经典小黑裙香氛，前调清新果香，中调优雅花香，尾调温暖木质香。[b]50ml 装[/b]，适合日常通勤使用。'],
  ['文具书籍', '无印良品笔记本 A5', 1200, 1500, 500, 1260, 'notebook', 1, '再生纸封面，内页 80 张横线纸，书写顺滑不洇墨。学生党记笔记必备。'],
  ['美妆个护', '飘柔洗发水 400ml', 1990, 2590, 300, 890, 'shampoo', 1, '人参精华配方，柔顺不打结。[color=#c00]买二送一[/color]，限时优惠。'],
  ['数码电器', 'Discman 随身听', 39900, 49900, 30, 76, 'discman', 1, '支持 CD / MP3 光盘播放，防震 60 秒，两节五号电池可连续播放 20 小时。附赠耳机和线控。'],
  ['服饰鞋包', '三枪纯棉秋衣', 4500, 5900, 200, 415, 'undershirt', 1, '100% 纯棉，柔软贴身，保暖不起球。尺码：M / L / XL / XXL。'],
  ['数码电器', 'MP3 随身听 256MB', 29900, 36900, 50, 128, 'mp3', 0, '256MB 大容量，可存 60 首歌曲；支持收音机、录音、U 盘功能；锂电池充电一次可听 12 小时。'],
  ['数码电器', '数码相机 300 万像素', 128000, 159900, 15, 23, 'camera', 0, '300 万像素 CCD，3 倍光学变焦，1.5 英寸液晶屏，赠 32MB 存储卡。'],
  ['食品零食', '珍珠奶茶 DIY 套装', 1500, 2000, 400, 560, 'bubbletea', 0, '内含木薯粉 200g、红糖 100g、红茶包 10 个，可做 10 杯珍珠奶茶。附图文教程。'],
  ['服饰鞋包', '手工羊毛围巾', 3900, 5900, 80, 190, 'scarf', 0, '纯羊毛手工编织，长 180cm，米白 / 酒红 / 灰色三色可选。'],
  ['服饰鞋包', '原色帆布包', 2500, 3500, 150, 230, 'totebag', 0, '加厚帆布，容量大，可装 A4 书本。空白款可以自己画图案。'],
];

const ALBUMS = [
  ['摄影小白', '周末扫街', '拿着新买的数码相机到处拍拍拍', ['album1', 'album4', 'ginkgo', 'album5']],
  ['背包客小张', '西塘 · 秋', '两天一夜的江南小镇', ['xitang1', 'xitang2', 'xitang3', 'xitang4']],
  ['仓鼠妈妈', '我家豆豆', '仓鼠豆豆的成长记录', ['hamster', 'cat']],
  ['胶片少年', '胶片日记', '凤凰 205 + 富士 200', ['album2', 'album3', 'album6', 'film']],
];

const CHAT = [
  ['背包客小张', '大家好，十一有人去西塘吗？'],
  ['小雨', '我想去！就是怕人太多'],
  ['吃货一枚', '去西塘记得吃芡实糕 ^_^'],
  ['数码迷', '有没有人知道 256MB 的 MP3 现在多少钱？'],
  ['淘淘', '电脑城大概 300 左右'],
];

function pick(r, arr) { return arr[Math.floor(r() * arr.length)]; }
function fillTemplate(r, tpl) { return tpl.replace(/\{(\w)\}/g, (_, k) => pick(r, FILL[k])); }

export function seedDemo(ctx, { onlyIfEmpty = true } = {}) {
  const { db } = ctx;
  if (onlyIfEmpty && db.prepare('SELECT 1 FROM notes LIMIT 1').get()) {
    console.log('[seed] 已有笔记数据，跳过演示数据导入');
    return false;
  }
  const r = rng(20031128);
  const t0 = now();

  // 复制配图
  const imgDir = path.join(ctx.config.uploadDir, 'seed');
  fs.mkdirSync(imgDir, { recursive: true });
  const IMG = {};
  for (const f of fs.readdirSync(IMG_SRC).filter((x) => x.endsWith('.jpg'))) {
    const key = f.replace(/\.jpg$/, '');
    fs.copyFileSync(path.join(IMG_SRC, f), path.join(imgDir, f));
    const size = fs.statSync(path.join(imgDir, f)).size;
    db.prepare("INSERT OR IGNORE INTO uploads (user_id, path, mime, size, purpose) VALUES (NULL, ?, 'image/jpeg', ?, 'seed')").run(`seed/${f}`, size);
    IMG[key] = { url: `/uploads/seed/${f}`, size, path: `seed/${f}` };
  }
  const withImages = (s) => s.replace(/\{(\w+)\}/g, (m, k) => (IMG[k] ? IMG[k].url : m));

  const run = db.transaction(() => {
    // 会员（演示会员使用随机密码，无法登录）
    const uid = {};
    const randomPw = () => crypto.randomBytes(18).toString('base64url');
    for (const [name, loc, points, title, color, gender] of USERS) {
      const id = createUser(ctx, { username: name, password: randomPw(), location: loc, avatarColor: color });
      db.prepare('UPDATE users SET points = ?, title = ?, gender = ?, created_at = ? WHERE id = ?')
        .run(points, title, gender, t0 - Math.floor(200 + r() * 700) * 86400, id);
      uid[name] = id;
    }
    uid['单车少年'] = createUser(ctx, { username: '单车少年', password: randomPw(), location: '杭州 拱墅', avatarColor: '#58a' });
    db.prepare('UPDATE users SET signature = ? WHERE id = ?').run('在路上，永远年轻，永远热泪盈眶。', uid['背包客小张']);
    db.prepare('UPDATE users SET signature = ? WHERE id = ?').run('生活需要仪式感 ^_^', uid['小鹿乱撞']);
    const adminRow = db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get();
    uid.__admin__ = adminRow ? adminRow.id : uid['背包客小张'];

    // 标签先按设计稿顺序建好，保证热门标签云的排列
    for (const t of ['穿搭', '护肤', '美食', '旅行', '彩妆', '健身', '数码', '家居', '读书', '摄影', '宠物', '学习']) {
      db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)').run(t);
    }

    const channelId = Object.fromEntries(db.prepare('SELECT slug, id FROM channels').all().map((c) => [c.slug, c.id]));
    const noteIds = {};
    for (const [ch, author, title, tags, hits, likes, flowers, featured, hoursAgo, content] of NOTES) {
      const id = createNote(ctx, uid[author], { title, content: withImages(content), channelId: channelId[ch], tags });
      const created = t0 - Math.floor(hoursAgo * 3600) - Math.floor(r() * 1800);
      db.prepare('UPDATE notes SET hits = ?, likes = ?, flowers = ?, featured = ?, created_at = ?, updated_at = ? WHERE id = ?')
        .run(hits, likes, flowers, featured, created, created, id);
      noteIds[title] = { id, created, author };
    }
    // 西塘这篇模拟一次编辑
    const xt = noteIds['西塘两日游攻略（附路线图、住宿、花费明细）'];
    db.prepare('UPDATE notes SET edited_at = ?, edited_by = ? WHERE id = ?').run(xt.created + 11 * 3600 + 29 * 60, '背包客小张', xt.id);

    // 留言
    const commenters = USERS.map((u) => u[0]);
    const addC = (noteMeta, name, text, at, guest = false) => {
      const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(noteMeta.id);
      const user = guest ? null : db.prepare('SELECT * FROM users WHERE id = ?').get(uid[name]);
      const c = addComment(ctx, { note, user, guestName: guest ? name : '', content: text, ip: '127.0.0.1' });
      db.prepare("UPDATE comments SET created_at = ?, status = 'approved' WHERE id = ?").run(at, c.id);
    };
    XITANG_COMMENTS.forEach(([name, text], i) => addC(xt, name, text, xt.created + [18, 94, 659, 689, 890][i] * 60));
    for (let i = 0; i < 33; i++) {
      const guest = r() < 0.15;
      addC(xt, guest ? pick(r, ['路人甲', '江南客', '小鱼儿', '阿飞']) : pick(r, commenters), pick(r, COMMENT_POOL), xt.created + (900 + i * 173) * 60, guest);
    }
    for (const meta of Object.values(noteIds)) {
      if (meta === xt) continue;
      const n = Math.floor(r() * 9);
      const ageMin = Math.max(60, (t0 - meta.created) / 60);
      for (let i = 0; i < n; i++) {
        let name = pick(r, commenters);
        if (name === meta.author) name = '水木年华';
        addC(meta, name, pick(r, COMMENT_POOL), meta.created + Math.floor(((i + 1) / (n + 1)) * ageMin * 60 * 0.9));
      }
    }
    db.prepare("UPDATE comments SET status = 'approved'").run();
    db.prepare("UPDATE notes SET comment_count = (SELECT COUNT(*) FROM comments WHERE note_id = notes.id AND status = 'approved')").run();
    // 留言带来的系统通知对演示用户没有意义，清空
    db.prepare('DELETE FROM messages').run();

    // 顶、收藏、送花记录（让「已顶过」判断和排行榜数据真实存在）
    for (const meta of Object.values(noteIds)) {
      for (const name of commenters.slice(0, 1 + Math.floor(r() * 6))) {
        if (uid[name] === uid[meta.author]) continue;
        db.prepare('INSERT OR IGNORE INTO favorites (user_id, note_id, created_at) VALUES (?, ?, ?)').run(uid[name], meta.id, meta.created + 3600);
      }
    }
    db.prepare('UPDATE notes SET favorites = (SELECT COUNT(*) FROM favorites WHERE note_id = notes.id)').run();

    // 论坛
    const boards = Object.fromEntries(db.prepare('SELECT name, id FROM forum_boards').all().map((b) => [b.name, b.id]));
    const insThread = db.prepare(`INSERT INTO forum_threads (board_id, user_id, title, sticky, digest, is_poll, hits, reply_count, last_post_at, last_post_user_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`);
    const insPost = db.prepare('INSERT INTO forum_posts (thread_id, user_id, content, floor, created_at) VALUES (?, ?, ?, ?, ?)');
    FORUM.forEach(([board, author, title, replies, kind, content, sticky, digest], idx) => {
      const start = t0 - (30 - idx * 2) * 86400 - Math.floor(r() * 7200);
      const authorId = uid[author];
      const tid = Number(insThread.run(boards[board], authorId, title, sticky, digest, kind === 'poll' ? 1 : 0,
        replies * 12 + Math.floor(r() * 300), start, authorId, start).lastInsertRowid);
      insPost.run(tid, authorId, content, 1, start);
      let last = start, lastUser = authorId;
      const span = (t0 - start) - 3600;
      for (let i = 0; i < replies; i++) {
        const name = pick(r, commenters);
        last = start + Math.floor(((i + 1) / (replies + 1)) * span);
        lastUser = uid[name];
        insPost.run(tid, lastUser, fillTemplate(r, pick(r, REPLY_POOLS[kind])), i + 2, last);
      }
      db.prepare('UPDATE forum_threads SET reply_count = ?, last_post_at = ?, last_post_user_id = ? WHERE id = ?').run(replies, last, lastUser, tid);
      if (kind === 'poll') {
        const insOpt = db.prepare('INSERT INTO poll_options (thread_id, label, votes, sort) VALUES (?, ?, 0, ?)');
        const opts = FILL.p.map((p, i) => Number(insOpt.run(tid, p, i).lastInsertRowid));
        for (const name of commenters) {
          const o = pick(r, opts);
          db.prepare('INSERT OR IGNORE INTO poll_votes (thread_id, user_id, option_id) VALUES (?, ?, ?)').run(tid, uid[name], o);
        }
        db.prepare('UPDATE poll_options SET votes = (SELECT COUNT(*) FROM poll_votes WHERE option_id = poll_options.id) WHERE thread_id = ?').run(tid);
      }
    });
    db.prepare(`UPDATE forum_boards SET
      thread_count = (SELECT COUNT(*) FROM forum_threads WHERE board_id = forum_boards.id AND status = 'published'),
      post_count = (SELECT COUNT(*) FROM forum_posts p JOIN forum_threads t ON t.id = p.thread_id WHERE t.board_id = forum_boards.id AND t.status = 'published' AND p.status = 'published'),
      last_thread_id = (SELECT id FROM forum_threads WHERE board_id = forum_boards.id AND status = 'published' ORDER BY last_post_at DESC LIMIT 1),
      last_post_at = (SELECT MAX(last_post_at) FROM forum_threads WHERE board_id = forum_boards.id AND status = 'published')`).run();
    db.prepare('UPDATE users SET post_count = (SELECT COUNT(*) FROM forum_posts WHERE user_id = users.id)').run();

    // 商品
    const insP = db.prepare(`INSERT INTO products (category, name, price_cents, market_price_cents, stock, sales, image, description, featured, sort)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    PRODUCTS.forEach(([cat, name, price, market, stock, sales, img, featured, desc], i) =>
      insP.run(cat, name, price, market, stock, sales, IMG[img]?.url || '', desc, featured, i));

    // 相册
    for (const [owner, title, desc, keys] of ALBUMS) {
      const created = t0 - Math.floor(10 + r() * 60) * 86400;
      const aid = Number(db.prepare('INSERT INTO albums (user_id, title, description, cover, created_at, updated_at, hits) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(uid[owner], title, desc, IMG[keys[0]].url, created, created, Math.floor(50 + r() * 400)).lastInsertRowid);
      keys.forEach((k, i) => {
        db.prepare('INSERT INTO photos (album_id, user_id, path, size, caption, hits, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(aid, uid[owner], IMG[k].path, IMG[k].size, `${title} · ${i + 1}`, Math.floor(r() * 200), created + i * 600);
      });
      db.prepare('UPDATE albums SET photo_count = ? WHERE id = ?').run(keys.length, aid);
    }

    // 好友
    const pairs = [['背包客小张', '摄影小白'], ['背包客小张', '胶片少年'], ['小鹿乱撞', 'vivian'], ['数码迷', '胶片少年'], ['阿May', '小厨娘'], ['小雨', '背包客小张']];
    for (const [a, b] of pairs) {
      db.prepare('INSERT OR IGNORE INTO friends (user_id, friend_id) VALUES (?, ?)').run(uid[a], uid[b]);
      db.prepare('INSERT OR IGNORE INTO friends (user_id, friend_id) VALUES (?, ?)').run(uid[b], uid[a]);
    }

    // 聊天记录
    const lobby = db.prepare("SELECT id FROM chat_rooms WHERE slug = 'lobby'").get();
    if (lobby) {
      const colors = ['#000000', '#cc0000', '#006600', '#000099', '#993399'];
      CHAT.forEach(([name, text], i) => {
        db.prepare('INSERT INTO chat_messages (room_id, user_id, username, color, content, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(lobby.id, uid[name], name, colors[i % colors.length], text, t0 - (CHAT.length - i) * 240);
      });
    }

    // 公告、广告、友情链接、站点设置
    const notices = ['热烈庆祝小红书社区开通两周年！', '新增「相册」频道，每位会员免费赠送 20MB 空间', '第三届网友穿搭大赛火热投票中', '请勿在论坛发布广告信息，违者封号'];
    db.prepare('DELETE FROM announcements').run();
    notices.forEach((n, i) => db.prepare('INSERT INTO announcements (content, sort) VALUES (?, ?)').run(n, i));
    db.prepare('DELETE FROM ads').run();
    db.prepare(`INSERT INTO ads (slot, title, subtitle, cta, link, style, bg, sort) VALUES
      ('header', '震撼！全场 5 折起', 'Nokia 3310 · Discman · MP3 · 数码相机 限时抢购', '点击进入>>', '/shop', 'rainbow', '#3333ff', 0),
      ('header', '江南水乡 3 日游 ￥299 起', '', '立即报名', '/notes?channel=travel', 'solid', '#003366', 1)`).run();
    db.prepare('DELETE FROM links').run();
    [['网易', 'https://www.163.com'], ['搜狐', 'https://www.sohu.com'], ['新浪', 'https://www.sina.com.cn'], ['榕树下', 'https://www.rongshuxia.com'],
      ['西祠胡同', 'http://www.xici.net'], ['天涯社区', 'https://www.tianya.cn'], ['猫扑', 'https://www.mop.com'], ['中华网', 'https://www.china.com']]
      .forEach(([name, url], i) => db.prepare('INSERT INTO links (name, url, sort) VALUES (?, ?, ?)').run(name, url, i));

    ctx.settings.setMany({
      webmaster_notice: '服务器已升级至 100M 光纤，感谢大家支持！近期论坛灌水严重，请文明发言。相册空间每人 20MB，上传图片请勿超过 2MB。',
      counter_base: '318000',
    });

    recountNoteOwners(ctx, { channelIds: Object.values(channelId), userIds: Object.values(uid) });
    recountTags(ctx, db.prepare('SELECT id FROM tags').all().map((t) => t.id));
  });
  run();
  console.log('[seed] 演示数据导入完成');
  return true;
}
