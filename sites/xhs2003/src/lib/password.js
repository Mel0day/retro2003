import crypto from 'node:crypto';

const N = 16384, R = 8, P = 1, KEYLEN = 64;

export function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(plain), salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(plain, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, n, r, p, saltB64, hashB64] = stored.split('$');
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(String(plain), Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n), r: Number(r), p: Number(p),
  });
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

// 密码提示答案：忽略首尾空格和大小写
export const normalizeAnswer = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

export const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
