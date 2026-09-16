import express from 'express';
import { LEVELS, POINT_RULES, starsText } from '../lib/levels.js';
import { httpError } from '../lib/http.js';

// 帮助中心里的 UBB 示例：左边是代码，右边是渲染效果
const UBB_EXAMPLES = [
  ['粗体 / 斜体 / 下划线', '[b]粗体[/b] [i]斜体[/i] [u]下划线[/u]'],
  ['文字颜色', '[color=#c00]红色文字[/color] [color=green]绿色文字[/color]'],
  ['文字大小（1-5）', '[size=1]小号[/size] [size=4]大号[/size]'],
  ['链接', '[url=https://www.example.com]示例网站[/url]'],
  ['小标题', '[h]一、行程安排[/h]'],
  ['引用', '[quote=背包客小张]西塘的芡实糕真好吃[/quote]'],
  ['有序列表', '[list=1]\n[*]第一条\n[*]第二条\n[/list]'],
  ['表格', '[table]\n[tr][th]时间[th]安排[/tr]\n[tr][td]08:00[td]出发[/tr]\n[/table]'],
  ['居中', '[center]居中的文字[/center]'],
  ['分割线', '[hr]'],
];

export default function pagesRoutes(ctx) {
  const r = express.Router();
  const { db } = ctx;

  const allPages = () => db.prepare('SELECT slug, title FROM pages ORDER BY sort, slug').all();

  r.get('/help', (req, res) => {
    res.render('pages/help.njk', {
      title: '帮助中心', nav: 'help', crumbs: [['帮助中心']],
      examples: UBB_EXAMPLES,
      levels: LEVELS.map((l, i) => ({ ...l, starsText: starsText(l.stars), max: LEVELS[i + 1] ? LEVELS[i + 1].min - 1 : null })),
      rules: Object.values(POINT_RULES),
      uploadKb: ctx.settings.int('upload_max_kb'),
      quotaMb: ctx.settings.int('album_quota_mb'),
      pages: allPages(),
    });
  });

  r.get('/page/:slug', (req, res) => {
    const page = db.prepare('SELECT * FROM pages WHERE slug = ?').get(String(req.params.slug));
    if (!page) throw httpError(404, '页面不存在');
    res.render('pages/page.njk', {
      title: page.title, nav: 'help', crumbs: [['帮助中心', '/help'], [page.title]],
      page, pages: allPages(),
    });
  });

  r.get('/sitemap', (req, res) => {
    const cats = db.prepare('SELECT * FROM forum_categories ORDER BY sort, id').all();
    const boards = db.prepare('SELECT id, category_id, name FROM forum_boards ORDER BY sort, id').all();
    res.render('pages/sitemap.njk', {
      title: '网站地图', nav: 'help', crumbs: [['网站地图']],
      channels: db.prepare('SELECT slug, name, note_count FROM channels ORDER BY sort, id').all(),
      forum: cats.map((c) => ({ ...c, boards: boards.filter((b) => b.category_id === c.id) })),
      rooms: db.prepare('SELECT slug, name FROM chat_rooms ORDER BY sort, id').all(),
      productCats: db.prepare("SELECT category, COUNT(*) AS n FROM products WHERE status = 'on' AND category <> '' GROUP BY category ORDER BY MIN(sort)").all(),
      pages: allPages(),
    });
  });

  return r;
}
