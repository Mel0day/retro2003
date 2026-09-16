#!/usr/bin/env node
// 把 retro-site 技能包装进 AI 助手的技能目录（默认 ~/.claude/skills/retro-site）。
// 用法：npm run install-skill [-- --dir ~/.claude/skills]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argDir = process.argv.indexOf('--dir');
const target = path.join(
  argDir > -1 && process.argv[argDir + 1] ? process.argv[argDir + 1].replace(/^~/, os.homedir()) : path.join(os.homedir(), '.claude/skills'),
  'retro-site',
);

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(SKILL_DIR, target, { recursive: true });
// 把点阵字体一并装进技能，这样在仓库之外生成站点也有 2003 年的字
const repoFonts = ['sites/xhs2003/public', 'sites/taobao2003/public']
  .map((p) => path.resolve(SKILL_DIR, '../..', p))
  .find((p) => fs.existsSync(path.join(p, 'fonts')) && fs.existsSync(path.join(p, 'css/fonts.css')));
if (repoFonts) {
  const dst = path.join(target, 'assets/fonts-source');
  fs.mkdirSync(path.join(dst, 'css'), { recursive: true });
  fs.cpSync(path.join(repoFonts, 'fonts'), path.join(dst, 'fonts'), { recursive: true });
  fs.copyFileSync(path.join(repoFonts, 'css/fonts.css'), path.join(dst, 'css/fonts.css'));
}

const count = (dir) => fs.readdirSync(dir, { withFileTypes: true })
  .reduce((n, e) => n + (e.isDirectory() ? count(path.join(dir, e.name)) : 1), 0);
console.log(`✓ 已安装 retro-site 技能到 ${target}（${count(target)} 个文件）`);
console.log('  在 Claude Code 里说「帮我做一个 2003 版的豆瓣」即可触发；也可以直接 /retro-site。');
console.log('  脚手架：在本仓库里运行会生成到 sites/<slug>/，在其它目录运行则生成到当前目录下的 <slug>/。');
