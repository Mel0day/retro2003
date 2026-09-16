export function safeNext(next, fallback = '/') {
  const n = String(next || '');
  return n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/\\') ? n : fallback;
}

export function wantsJson(req) {
  return req.path.startsWith('/api/') || req.get('x-requested-with') === 'fetch';
}

export function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

export const intParam = (v, def = 0) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : def;
};

const MOBILE_RE = /Mobile|Android|iPhone|iPod|Windows Phone|BlackBerry|Opera Mini|IEMobile|Nokia|Symbian|UCWEB|MIDP/i;
export const isMobileUA = (ua) => MOBILE_RE.test(ua || '') && !/iPad|Tablet/i.test(ua || '');

export const USERNAME_RE = /^[一-龥A-Za-z0-9_]{2,16}$/;
export const RESERVED_NAMES = ['游客', '系统', '系统消息', '站长', '管理员', 'admin', 'administrator', 'root', 'webmaster', 'system', 'guest'];
