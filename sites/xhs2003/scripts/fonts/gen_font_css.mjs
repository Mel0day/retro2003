// 根据 public/fonts 下的像素字体生成 public/css/fonts.css
// 用法：node scripts/fonts/gen_font_css.mjs
//
// 点阵字体只有在「设计尺寸」下才锐利，所以每个 CSS 字号对应一个字体族：
//   --f-song-N   宋体风格（中文 + 宋体自带的西文），用于正文
//   --f-sans-N   Verdana/Tahoma 风格（点阵无衬线西文 + 宋体中文），用于数字、日期等小字
// 9~11px 没有对应的中文点阵，沿用 2003 年中文网页的做法：中文最小按 12px 显示，
// 通过 @font-face 的 size-adjust 让 12px 点阵在 11px 字号下仍是一个像素对一个像素。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const RANGES = {
  latin: 'U+0000-00FF,U+0131,U+0152-0153,U+02C6-02DC,U+2013-2014,U+2018-201E,U+2022,U+2026,U+20AC,U+2122',
  sym: 'U+0100-0130,U+0132-0151,U+0154-02C5,U+02DD-2012,U+2015-2017,U+201F-2021,U+2023-2025,U+2027-20AB,U+20AD-2121,U+2123-33FF,U+FE30-FE6F,U+FF00-FFEF',
  han1: 'U+4E00-6FFF',
  han2: 'U+7000-9FFF',
};

// 字体族定义：[族名, CSS 字号, 西文来源, 中文来源]，来源格式 [类型, 设计像素]
const FAMILIES = [];
for (const n of [9, 10, 11]) {
  FAMILIES.push([`XHS Song ${n}`, n, ['sans', 12], ['song', 12]]);
  FAMILIES.push([`XHS Sans ${n}`, n, ['sans', 12], ['song', 12]]);
}
FAMILIES.push(['XHS Song 12', 12, ['song', 12], ['song', 12]]);
FAMILIES.push(['XHS Sans 12', 12, ['sans', 12], ['song', 12]]);
FAMILIES.push(['XHS Song 13', 13, ['song', 13], ['song', 13]]);
FAMILIES.push(['XHS Sans 13', 13, ['sans', 13], ['song', 13]]);
FAMILIES.push(['XHS Song 14', 14, ['song', 14], ['song', 14]]);
FAMILIES.push(['XHS Sans 14', 14, ['sans', 13], ['song', 14]]);
FAMILIES.push(['XHS Song 15', 15, ['song', 14], ['song', 14]]);
FAMILIES.push(['XHS Sans 15', 15, ['sans', 16], ['song', 16]]);
FAMILIES.push(['XHS Song 16', 16, ['song', 16], ['song', 16]]);
FAMILIES.push(['XHS Sans 16', 16, ['sans', 16], ['song', 16]]);

const exists = (f) => fs.existsSync(path.join(ROOT, 'public/fonts', f));
// 文件内容哈希作为版本号，字体更新后浏览器缓存自动失效
const hash = (f) => crypto.createHash('sha1').update(fs.readFileSync(path.join(ROOT, 'public/fonts', f))).digest('hex').slice(0, 8);
const adjust = (design, used) => (design === used ? '' : `size-adjust:${((design / used) * 100).toFixed(4)}%;`);

let css = `/* 由 scripts/fonts/gen_font_css.mjs 生成，请勿手改。
   像素字体源自文泉驿点阵宋体（GPL v2 with font embedding exception）与 Liberation Sans 点阵版。 */\n`;
for (const [family, used, latin, cjk] of FAMILIES) {
  for (const bold of [false, true]) {
    const parts = [['latin', latin], ['sym', cjk], ['han1', cjk], ['han2', cjk]];
    for (const [slice, [kind, design]] of parts) {
      const file = `${kind}${design}-${slice}${bold ? '-b' : ''}.woff2`;
      if (!exists(file)) continue;
      css += `@font-face{font-family:"${family}";font-weight:${bold ? 700 : 400};font-display:swap;${adjust(design, used)}src:url(/static/fonts/${file}?v=${hash(file)}) format("woff2");unicode-range:${RANGES[slice]}}\n`;
    }
  }
}

const SONG_FALLBACK = `"宋体",SimSun,"Songti SC",STSong,serif`;
const SANS_FALLBACK = `Tahoma,Verdana,"宋体",SimSun,sans-serif`;
css += '\n:root{\n';
for (const n of [9, 10, 11, 12, 13, 14, 15, 16]) {
  css += `  --f-song-${n}:"XHS Song ${n}",${SONG_FALLBACK};\n`;
  css += `  --f-sans-${n}:"XHS Sans ${n}",${SANS_FALLBACK};\n`;
}
css += `  --f-song-big:"Songti SC",STSong,"宋体",SimSun,serif;\n`;
css += `  --f-sans-big:Verdana,Tahoma,"Songti SC","宋体",sans-serif;\n`;
css += `  --f-hei:Impact,"黑体",SimHei,"Heiti SC",STHeiti,sans-serif;\n`;
css += `  --f-heiti:"黑体",SimHei,"Heiti SC",STHeiti,sans-serif;\n`;
css += '}\n';
css += `/* 表单控件默认不继承字体，统一继承，避免退回系统字体 */\nbutton,input,select,textarea{font-family:inherit}\n`;

fs.writeFileSync(path.join(ROOT, 'public/css/fonts.css'), css);
console.log('fonts.css', (css.length / 1024).toFixed(1), 'KB,', css.split('@font-face').length - 1, 'faces');
