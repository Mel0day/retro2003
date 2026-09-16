import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function bool(v, def = false) {
  if (v === undefined || v === '') return def;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

export function loadConfig(overrides = {}) {
  const env = { ...process.env, ...overrides };
  const dataDir = path.resolve(ROOT, env.DATA_DIR || 'data');
  fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });

  let secret = env.SESSION_SECRET;
  if (!secret) {
    const keyFile = path.join(dataDir, 'secret.key');
    if (fs.existsSync(keyFile)) secret = fs.readFileSync(keyFile, 'utf8').trim();
    else {
      secret = crypto.randomBytes(32).toString('hex');
      fs.writeFileSync(keyFile, secret, { mode: 0o600 });
    }
  }

  return {
    root: ROOT,
    env: env.NODE_ENV || 'development',
    isTest: env.NODE_ENV === 'test',
    isProd: env.NODE_ENV === 'production',
    port: Number(env.PORT || 3003),
    host: env.HOST || '0.0.0.0',
    dataDir,
    dbFile: path.join(dataDir, env.DB_FILE || 'xhs2003.db'),
    uploadDir: path.join(dataDir, 'uploads'),
    secret,
    trustProxy: env.TRUST_PROXY ?? 'loopback',
    adminUsername: env.ADMIN_USERNAME || '',
    adminPassword: env.ADMIN_PASSWORD || '',
    seedDemo: bool(env.SEED_DEMO, false),
    // 仅在 NODE_ENV=test 时生效，用于自动化测试绕过图形验证码
    captchaTestCode: env.NODE_ENV === 'test' ? (env.CAPTCHA_TEST_CODE || '') : '',
    disableRateLimit: env.NODE_ENV === 'test' && bool(env.DISABLE_RATE_LIMIT, true),
    logRequests: bool(env.LOG_REQUESTS, env.NODE_ENV === 'production'),
  };
}
