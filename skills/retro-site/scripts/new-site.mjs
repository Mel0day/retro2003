#!/usr/bin/env node
// 脚手架：生成一个能立刻跑起来的 2003 风格站点骨架。
//
// 用法（在 retro2003 仓库根目录）：
//   node skills/retro-site/scripts/new-site.mjs --slug weibo2005 --name "微博 2005" --port 3005 \
//        --tagline "随时随地分享新鲜事" --theme "#d4213d" --width 800 --admin "站长"
//
// 生成的目录：sites/<slug>/，自带会员、发布、留言、后台、演示数据、测试和 Dockerfile。
// 之后 cd sites/<slug> && npm install && npm test，再按 docs/需求拆解.md 改成你的产品。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(HERE, '..');
const TEMPLATE = path.join(SKILL_DIR, 'assets/template');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    out[key] = val;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const fail = (msg) => { console.error(`✗ ${msg}`); process.exit(1); };

const slug = args.slug || '';
if (!/^[a-z][a-z0-9-]{2,30}$/.test(slug)) fail('--slug 必须是 3-31 位小写字母、数字或连字符，例如 weibo2005');
const name = args.name || fail('--name 必填，例如 --name "微博 2005"');
const port = Number(args.port || 3005);
if (!Number.isInteger(port) || port < 1024 || port > 65535) fail('--port 必须是 1024-65535 的整数');
const tagline = args.tagline || '标记这个年代';
const admin = args.admin || '站长';
const width = Number(args.width || 778);
const theme = (args.theme || '#cc0000').toLowerCase();
if (!/^#[0-9a-f]{6}$/.test(theme)) fail('--theme 必须是 #rrggbb 形式的颜色');

// 由主色推导出深浅色，省得手工配四个颜色
const mix = (hex, target, ratio) => {
  const n = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const t = [1, 3, 5].map((i) => parseInt(target.slice(i, i + 2), 16));
  return `#${n.map((v, i) => Math.round(v + (t[i] - v) * ratio).toString(16).padStart(2, '0')).join('')}`;
};
const vars = {
  __SLUG__: slug,
  __NAME__: name,
  __PORT__: String(port),
  __TAGLINE__: tagline,
  __ADMIN__: admin,
  __WIDTH__: String(width),
  __THEME__: theme,
  __THEME_DARK__: mix(theme, '#000000', 0.25),
  __THEME_LIGHT__: mix(theme, '#ffffff', 0.85),
  __THEME_BORDER__: mix(theme, '#ffffff', 0.55),
};

// 目标目录：
//   --out 指定时用它；
//   当前目录（或上层）是本仓库这种「有 sites/ 的项目」时放进 sites/<slug>；
//   否则放在当前目录下的 <slug>/。
function findRepoRoot(from) {
  let dir = path.resolve(from);
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'sites')) && fs.statSync(path.join(dir, 'sites')).isDirectory()) return dir;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}
// 只按当前目录判断；技能被装到 ~/.claude/skills 后，不能拿技能目录的上层当项目根
const repoRoot = findRepoRoot(process.cwd());
const outDir = path.resolve(args.out || (repoRoot ? path.join(repoRoot, 'sites', slug) : path.join(process.cwd(), slug)));
if (fs.existsSync(outDir)) fail(`目录已存在：${outDir}`);

const BINARY = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.woff2']);
let files = 0;
function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) { copyDir(src, dst); continue; }
    if (BINARY.has(path.extname(entry.name).toLowerCase())) fs.copyFileSync(src, dst);
    else {
      let text = fs.readFileSync(src, 'utf8');
      for (const [k, v] of Object.entries(vars)) text = text.split(k).join(v);
      fs.writeFileSync(dst, text);
    }
    files++;
  }
}
copyDir(TEMPLATE, outDir);

// 点阵字体：从仓库里已有的站点复制一份（字体文件不重复存放在模板里）
const fontCandidates = [];
if (repoRoot) {
  for (const site of fs.existsSync(path.join(repoRoot, 'sites')) ? fs.readdirSync(path.join(repoRoot, 'sites')) : []) {
    fontCandidates.push(path.join(repoRoot, 'sites', site, 'public'));
  }
}
fontCandidates.push(path.join(SKILL_DIR, 'assets/fonts-source'));
const fontSource = fontCandidates.find((p) => fs.existsSync(path.join(p, 'fonts')) && fs.existsSync(path.join(p, 'css/fonts.css')));
if (fontSource) {
  fs.cpSync(path.join(fontSource, 'fonts'), path.join(outDir, 'public/fonts'), { recursive: true });
  fs.copyFileSync(path.join(fontSource, 'css/fonts.css'), path.join(outDir, 'public/css/fonts.css'));
  files += fs.readdirSync(path.join(outDir, 'public/fonts')).length + 1;
} else {
  console.warn('! 没找到点阵字体。到 https://github.com/Mel0day/retro2003 下载任一站点的 public/fonts 和 public/css/fonts.css 放进新站点，否则中文会用系统字体，失去 2003 年的观感。');
}
fs.mkdirSync(path.join(outDir, 'seed/images'), { recursive: true });
fs.writeFileSync(path.join(outDir, 'seed/images/.gitkeep'), '');

const rel = path.relative(process.cwd(), outDir) || outDir;
console.log(`✓ 已生成 ${name}（${files} 个文件）：${rel}`);
console.log(`
下一步：
  cd ${rel}
  npm install
  npm test                      # 骨架自带 8 项测试，应该全绿
  DATA_DIR=./data SEED_DEMO=true ADMIN_USERNAME=${admin} ADMIN_PASSWORD=改成12位以上的密码 npm start
  打开 http://localhost:${port}

然后按 docs/需求拆解.md 把示例的「内容/留言」换成你要复刻的产品对象，
并在根目录 docker-compose.yml、package.json、README.md 里登记这个新站点。`);
