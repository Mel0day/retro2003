import crypto from 'node:crypto';

export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k || k in out) continue;
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { out[k] = part.slice(i + 1).trim(); }
  }
  return out;
}

export function cookies() {
  return (req, res, next) => {
    req.cookies = parseCookies(req.headers.cookie);
    res.setCookie = (name, value, { maxAge, httpOnly = true, sameSite = 'Lax', path = '/' } = {}) => {
      let c = `${name}=${encodeURIComponent(value)}; Path=${path}; SameSite=${sameSite}`;
      if (maxAge !== undefined) c += `; Max-Age=${Math.floor(maxAge)}`;
      if (httpOnly) c += '; HttpOnly';
      if (req.secure) c += '; Secure';
      res.append('Set-Cookie', c);
    };
    res.clearCookie = (name) => res.setCookie(name, '', { maxAge: 0 });
    next();
  };
}

export function securityHeaders() {
  return (req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'",
      "img-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self'",
      "connect-src 'self'",
      "font-src 'self'",
      "frame-ancestors 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join('; '));
    next();
  };
}

// 访客 ID：用于游客购物车、CSRF 令牌和访问量计数
const BOT_RE = /bot|spider|crawl|slurp|curl|wget|python|httpclient|monitor|preview/i;

export function visitor(ctx) {
  return (req, res, next) => {
    let vid = req.cookies.vid;
    if (!vid || !/^[A-Za-z0-9_-]{16,64}$/.test(vid)) {
      vid = crypto.randomBytes(16).toString('base64url');
      res.setCookie('vid', vid, { maxAge: 365 * 86400 });
      const ua = req.headers['user-agent'] || '';
      if (req.method === 'GET' && !BOT_RE.test(ua)) ctx.settings.incr('visitor_count');
    }
    req.vid = vid;
    next();
  };
}

// CSRF：令牌 = HMAC(secret, vid)，无状态。只接受表单字段 _csrf 或请求头 X-CSRF-Token（不接受 URL 参数）
export function csrfToken(ctx, vid) {
  return crypto.createHmac('sha256', ctx.config.secret).update(`csrf:${vid}`).digest('base64url').slice(0, 32);
}

export function csrf(ctx) {
  return (req, res, next) => {
    req.csrfToken = csrfToken(ctx, req.vid);
    res.locals.csrf = req.csrfToken;
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const header = req.get('x-csrf-token');
    const field = req.body && typeof req.body._csrf === 'string' ? req.body._csrf : '';
    const sent = typeof header === 'string' && header ? header : field;
    const ok = sent.length === req.csrfToken.length
      && crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(req.csrfToken));
    if (ok) return next();
    const err = new Error('页面已过期，请刷新后重试（安全校验失败）');
    err.status = 403;
    next(err);
  };
}
