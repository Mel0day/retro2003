// 积分等级：四颗星表示，站长设置的头衔优先显示
export const LEVELS = [
  { min: 0, name: '新手上路', stars: 0 },
  { min: 50, name: '初级会员', stars: 1 },
  { min: 300, name: '中级会员', stars: 2 },
  { min: 1000, name: '高级会员', stars: 2.5 },
  { min: 3000, name: '资深会员', stars: 3 },
  { min: 8000, name: '元老会员', stars: 4 },
];

export const POINT_RULES = {
  note: { delta: 10, reason: '发表笔记' },
  comment: { delta: 2, reason: '发表留言' },
  commented: { delta: 1, reason: '笔记收到留言' },
  flowerReceived: { delta: 5, reason: '笔记收到鲜花' },
  dailyLogin: { delta: 5, reason: '每日首次登录' },
  thread: { delta: 5, reason: '发表主题' },
  reply: { delta: 1, reason: '回复主题' },
  digest: { delta: 20, reason: '主题被加精' },
};

export function levelOf(points) {
  let lv = LEVELS[0];
  for (const l of LEVELS) if (points >= l.min) lv = l;
  return lv;
}

export function starsText(stars) {
  let s = '';
  for (let i = 1; i <= 4; i++) s += stars >= i ? '★' : '☆';
  return s;
}

export function levelName(user) {
  if (!user) return '游客';
  return user.title || levelOf(user.points || 0).name;
}

export function levelInfo(user) {
  const lv = levelOf(user?.points || 0);
  return { name: user?.title || lv.name, stars: starsText(lv.stars), level: lv };
}
