// 信用等级：沿用淘宝早期的心、钻、冠划分。列表页按原型用 ★☆ 显示（1-5 心对应 1-5 颗星）。
export const LEVELS = [
  { min: 4, max: 10, icon: 'heart', n: 1 },
  { min: 11, max: 40, icon: 'heart', n: 2 },
  { min: 41, max: 90, icon: 'heart', n: 3 },
  { min: 91, max: 150, icon: 'heart', n: 4 },
  { min: 151, max: 250, icon: 'heart', n: 5 },
  { min: 251, max: 500, icon: 'diamond', n: 1 },
  { min: 501, max: 1000, icon: 'diamond', n: 2 },
  { min: 1001, max: 2000, icon: 'diamond', n: 3 },
  { min: 2001, max: 5000, icon: 'diamond', n: 4 },
  { min: 5001, max: 10000, icon: 'diamond', n: 5 },
  { min: 10001, max: Infinity, icon: 'crown', n: 1 },
];

export function levelOf(score) {
  const s = Number(score || 0);
  return LEVELS.find((l) => s >= l.min && s <= l.max) || null;
}

// 原型列表里的五角星：心级 1-5 对应星数；钻级以上显示 ◆，未满 4 分显示 ☆☆☆☆☆
export function starsText(score) {
  const l = levelOf(score);
  if (!l) return '☆☆☆☆☆';
  if (l.icon === 'heart') return '★'.repeat(l.n) + '☆'.repeat(5 - l.n);
  if (l.icon === 'diamond') return '◆'.repeat(l.n);
  return '♛';
}

export function levelTitle(score) {
  const l = levelOf(score);
  if (!l) return '信用积分不足 4 分';
  const name = { heart: '心', diamond: '钻', crown: '皇冠' }[l.icon];
  return l.icon === 'crown' ? `皇冠卖家（${score} 分）` : `${l.n}${name}（${l.min}-${l.max === Infinity ? '' : l.max} 分）`;
}

// 好评率保留一位小数；没有评价时显示 100.0
export const goodRate = (good, total) => (total > 0 ? (Math.floor((good / total) * 1000) / 10).toFixed(1) : '100.0');
