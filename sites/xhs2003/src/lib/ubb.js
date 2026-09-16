// UBB 代码解析器：先建语法树，再渲染成 HTML。所有文本和参数都会被转义，
// 未闭合或不认识的标签原样当作文字显示。

const TAGS = {
  b: { kind: 'inline' }, i: { kind: 'inline' }, u: { kind: 'inline' }, s: { kind: 'inline' },
  color: { kind: 'inline', arg: 'required' },
  size: { kind: 'inline', arg: 'required' },
  url: { kind: 'inline', rawWithoutArg: true },
  h: { kind: 'block' },
  center: { kind: 'block' },
  right: { kind: 'block' },
  quote: { kind: 'block' },
  code: { kind: 'block', raw: true },
  list: { kind: 'block' },
  '*': { kind: 'item' },
  table: { kind: 'block' },
  tr: { kind: 'row', parent: 'table' },
  th: { kind: 'cell', parent: 'tr' },
  td: { kind: 'cell', parent: 'tr' },
  img: { kind: 'block', raw: true },
  fimg: { kind: 'block', raw: true },
  gallery: { kind: 'block' },
  hr: { kind: 'block', void: true },
};

const MODES = {
  note: null, // 全部允许
  post: null,
  comment: new Set(['b', 'i', 'u', 's', 'color', 'size', 'url', 'quote']),
  chat: new Set([]),
};

const TOKEN_RE = /\[(\/?)([a-z]+|\*)(?:=([^\]\n]{0,300}))?\]/gi;

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function safeUrl(raw, { image = false } = {}) {
  const u = String(raw || '').trim();
  if (!u || u.length > 1000 || /[\s"'<>\\]/.test(u)) return null;
  if (/^\/uploads\/[\w./-]+$/.test(u) && !u.includes('..')) return u;
  if (/^https?:\/\/[^/]/i.test(u)) return u;
  if (!image && /^\/(?!\/)[\w\-./?=&%#~+]*$/.test(u)) return u;
  return null;
}

const COLOR_RE = /^(#[0-9a-f]{3}|#[0-9a-f]{6}|[a-z]{3,20})$/i;
const SIZE_PX = { 1: 10, 2: 12, 3: 14, 4: 16, 5: 20 };

export function parse(input, mode = 'note') {
  const allowed = MODES[mode] ?? null;
  const src = String(input ?? '').replace(/\r\n?/g, '\n');
  const root = { type: 'root', children: [] };
  const stack = [root];
  const top = () => stack[stack.length - 1];
  const pushText = (t) => {
    if (!t) return;
    const kids = top().children;
    const last = kids[kids.length - 1];
    if (last && last.type === 'text') last.value += t;
    else kids.push({ type: 'text', value: t });
  };
  const inStack = (name) => stack.some((n) => n.tag === name);

  TOKEN_RE.lastIndex = 0;
  let pos = 0;
  let m;
  while ((m = TOKEN_RE.exec(src))) {
    const [whole, slash, rawName, arg] = m;
    const name = rawName.toLowerCase();
    const def = TAGS[name];
    pushText(src.slice(pos, m.index));
    pos = m.index + whole.length;

    if (!def || (allowed && !allowed.has(name))) { pushText(whole); continue; }

    if (slash) {
      let idx = -1;
      for (let i = stack.length - 1; i > 0; i--) if (stack[i].tag === name) { idx = i; break; }
      if (idx === -1) { pushText(whole); continue; }
      stack.length = idx;
      continue;
    }

    if (def.arg === 'required' && !arg) { pushText(whole); continue; }

    // 原文类标签：内容不再解析
    if (def.raw || (def.rawWithoutArg && arg === undefined)) {
      const closeRe = new RegExp(`\\[/${name}\\]`, 'i');
      const rest = src.slice(pos);
      const cm = closeRe.exec(rest);
      if (!cm) { pushText(whole); continue; }
      const node = { type: 'tag', tag: name, arg, raw: rest.slice(0, cm.index), open: whole };
      if (name === 'img' && top().tag === 'gallery') top().children.push(node);
      else top().children.push(node);
      pos += cm.index + cm[0].length;
      TOKEN_RE.lastIndex = pos;
      continue;
    }

    if (def.void) { top().children.push({ type: 'tag', tag: name, open: whole }); continue; }

    if (def.kind === 'item') {
      if (top().tag === '*') stack.pop();
      if (top().tag !== 'list') { pushText(whole); continue; }
    }
    if (def.parent) {
      // 允许省略 [/td] [/tr] 的写法
      if (def.kind === 'cell' && (top().tag === 'td' || top().tag === 'th')) stack.pop();
      if (def.kind === 'row') {
        while (top().tag === 'td' || top().tag === 'th' || top().tag === 'tr') stack.pop();
      }
      if (top().tag !== def.parent) { pushText(whole); continue; }
    }
    if (def.kind === 'block' && name !== 'quote' && name !== 'center' && name !== 'right' && inStack('*') === false
        && ['td', 'th'].includes(top().tag) && name !== 'img') {
      // 表格单元格内不允许再嵌块级结构
      pushText(whole); continue;
    }

    const node = { type: 'tag', tag: name, arg, children: [], open: whole };
    top().children.push(node);
    stack.push(node);
  }
  pushText(src.slice(pos));

  // 未闭合的标签（列表项、单元格除外）退化为文字
  while (stack.length > 1) {
    const node = stack.pop();
    if (['*', 'td', 'th', 'tr'].includes(node.tag)) continue;
    const parent = top();
    const i = parent.children.indexOf(node);
    parent.children.splice(i, 1, { type: 'text', value: node.open }, ...node.children);
    // 合并相邻文本
    for (let j = parent.children.length - 1; j > 0; j--) {
      const a = parent.children[j - 1], b = parent.children[j];
      if (a.type === 'text' && b.type === 'text') { a.value += b.value; parent.children.splice(j, 1); }
    }
  }
  return root;
}

const URL_IN_TEXT = /\bhttps?:\/\/[^\s<>"'\[\]]+/gi;

function renderText(text, { autolink = true } = {}) {
  if (!autolink) return escapeHtml(text).replace(/\n/g, '<br>');
  let out = '';
  let last = 0;
  text.replace(URL_IN_TEXT, (url, idx) => {
    out += escapeHtml(text.slice(last, idx));
    const safe = safeUrl(url);
    out += safe
      ? `<a href="${escapeHtml(safe)}" target="_blank" rel="nofollow noopener">${escapeHtml(url)}</a>`
      : escapeHtml(url);
    last = idx + url.length;
    return url;
  });
  out += escapeHtml(text.slice(last));
  return out.replace(/\n/g, '<br>');
}

function isInline(node) {
  return node.type === 'text' || TAGS[node.tag]?.kind === 'inline';
}

function renderInline(nodes, ctx) {
  return nodes.map((n) => renderInlineNode(n, ctx)).join('');
}

function renderInlineNode(n, ctx) {
  if (n.type === 'text') return renderText(n.value, { autolink: !ctx.inLink });
  switch (n.tag) {
    case 'b': return `<b>${renderInline(n.children, ctx)}</b>`;
    case 'i': return `<i>${renderInline(n.children, ctx)}</i>`;
    case 'u': return `<u>${renderInline(n.children, ctx)}</u>`;
    case 's': return `<s>${renderInline(n.children, ctx)}</s>`;
    case 'color': {
      const c = n.arg.trim();
      if (!COLOR_RE.test(c)) return escapeHtml(n.open) + renderInline(n.children, ctx);
      return `<span style="color:${c}">${renderInline(n.children, ctx)}</span>`;
    }
    case 'size': {
      const px = SIZE_PX[n.arg.trim()];
      if (!px) return escapeHtml(n.open) + renderInline(n.children, ctx);
      // 点阵字体按字号选对应字体族，20px 以上用系统宋体
      return `<span style="font-size:${px}px;font-family:var(--f-song-${px <= 16 ? px : 'big'})">${renderInline(n.children, ctx)}</span>`;
    }
    case 'url': {
      const target = n.arg !== undefined ? n.arg : n.raw;
      const safe = safeUrl(target);
      const label = n.arg !== undefined ? renderInline(n.children, { ...ctx, inLink: true }) : escapeHtml(n.raw);
      if (!safe) return label;
      const external = /^https?:/i.test(safe);
      return `<a href="${escapeHtml(safe)}"${external ? ' target="_blank" rel="nofollow noopener"' : ''}>${label}</a>`;
    }
    default:
      // 块级标签出现在行内位置时按块渲染
      return renderBlockNode(n, ctx).html;
  }
}

function figure(n, extraClass = '') {
  const src = safeUrl(n.raw, { image: true });
  if (!src) return `<p>${escapeHtml(n.open + n.raw + `[/${n.tag}]`)}</p>`;
  const cap = n.arg ? String(n.arg).trim() : '';
  return `<figure class="ubb-fig${extraClass}"><a href="${escapeHtml(src)}" target="_blank" rel="noopener">`
    + `<img src="${escapeHtml(src)}" alt="${escapeHtml(cap)}" loading="lazy"></a>`
    + (cap ? `<figcaption>${escapeHtml(cap)}</figcaption>` : '') + '</figure>';
}

function plainOf(nodes) {
  let s = '';
  for (const n of nodes) {
    if (n.type === 'text') s += n.value;
    else if (n.raw !== undefined && (n.tag === 'code' || n.tag === 'url')) s += n.raw;
    else if (n.children) s += plainOf(n.children) + (TAGS[n.tag] && TAGS[n.tag].kind !== 'inline' ? ' ' : '');
  }
  return s;
}

function renderBlockNode(n, ctx) {
  const kids = n.children || [];
  switch (n.tag) {
    case 'h': return { html: `<h3 class="ubb-h">${renderInline(kids, ctx)}</h3>`, weight: plainOf(kids).length + 20 };
    case 'center': return { html: `<div class="ubb-center">${renderBlocks(kids, ctx)}</div>`, weight: plainOf(kids).length };
    case 'right': return { html: `<div class="ubb-right">${renderBlocks(kids, ctx)}</div>`, weight: plainOf(kids).length };
    case 'quote': {
      const who = n.arg ? `<div class="ubb-quote-who">引用 ${escapeHtml(n.arg)} 的话：</div>` : '<div class="ubb-quote-who">引用：</div>';
      return { html: `<blockquote class="ubb-quote">${who}${renderBlocks(kids, ctx)}</blockquote>`, weight: plainOf(kids).length };
    }
    case 'code': return { html: `<pre class="ubb-code">${escapeHtml(n.raw.replace(/^\n|\n$/g, ''))}</pre>`, weight: n.raw.length };
    case 'list': {
      const ordered = n.arg === '1';
      const items = kids.filter((k) => k.tag === '*')
        .map((k) => `<li>${renderInline(trimNodes(k.children), ctx)}</li>`).join('');
      const tagName = ordered ? 'ol' : 'ul';
      return { html: `<${tagName} class="ubb-list">${items}</${tagName}>`, weight: plainOf(kids).length + 10 };
    }
    case 'table': {
      const rows = kids.filter((k) => k.tag === 'tr').map((tr) => {
        const cells = tr.children.filter((c) => c.tag === 'td' || c.tag === 'th')
          .map((c) => `<${c.tag}>${renderInline(trimNodes(c.children), ctx)}</${c.tag}>`).join('');
        return `<tr>${cells}</tr>`;
      }).join('');
      return { html: `<table class="ubb-table">${rows}</table>`, weight: plainOf(kids).length + 40 };
    }
    case 'img': return { html: figure(n), weight: 160 };
    case 'fimg': return { html: figure(n, ' ubb-float'), weight: 200 };
    case 'gallery': {
      const figs = kids.filter((k) => k.tag === 'img').map((k) => figure(k)).join('');
      return { html: `<div class="ubb-gallery">${figs}</div>`, weight: 200 };
    }
    case 'hr': return { html: '<hr class="ubb-hr">', weight: 0 };
    default: return { html: renderInlineNode(n, ctx), weight: 0 };
  }
}

function trimNodes(nodes) {
  const out = nodes.map((n) => ({ ...n }));
  while (out.length && out[0].type === 'text' && !out[0].value.trim()) out.shift();
  while (out.length && out[out.length - 1].type === 'text' && !out[out.length - 1].value.trim()) out.pop();
  if (out.length && out[0].type === 'text') out[0].value = out[0].value.replace(/^\s+/, '');
  if (out.length && out[out.length - 1].type === 'text') out[out.length - 1].value = out[out.length - 1].value.replace(/\s+$/, '');
  return out;
}

// 把节点序列切成段：连续的行内节点按空行分段为 <p>，块级节点单独成段
function segments(nodes, ctx) {
  const segs = [];
  let run = [];
  const flush = () => {
    const trimmed = trimNodes(run);
    run = [];
    if (!trimmed.length) return;
    const html = renderInline(trimmed, ctx);
    if (!html.replace(/<br>/g, '').trim()) return;
    segs.push({ html: `<p>${html}</p>`, weight: plainOf(trimmed).length });
  };
  for (const n of nodes) {
    if (n.type === 'text') {
      const parts = n.value.split(/\n[ \t]*\n+/);
      parts.forEach((part, i) => {
        if (i > 0) flush();
        if (part) run.push({ type: 'text', value: part });
      });
    } else if (isInline(n)) {
      run.push(n);
    } else {
      flush();
      segs.push(renderBlockNode(n, ctx));
    }
  }
  flush();
  return segs;
}

function renderBlocks(nodes, ctx) {
  return segments(nodes, ctx).map((s) => s.html).join('');
}

export function render(input, mode = 'note') {
  return renderBlocks(parse(input, mode).children, { mode });
}

// WAP 分页：按段累计字数切页，不会把一个段落拆开
export function renderPages(input, charsPerPage = 400, mode = 'note') {
  const segs = segments(parse(input, mode).children, { mode });
  const pages = [];
  let cur = [], weight = 0;
  for (const s of segs) {
    if (cur.length && weight + s.weight > charsPerPage) { pages.push(cur.join('')); cur = []; weight = 0; }
    cur.push(s.html);
    weight += s.weight;
  }
  if (cur.length) pages.push(cur.join(''));
  return pages.length ? pages : [''];
}

// 提取图片地址和纯文本，用于封面、[图]/[文] 标记和摘要
export function analyze(input, mode = 'note') {
  const tree = parse(input, mode);
  const images = [];
  const walk = (nodes) => {
    for (const n of nodes) {
      if ((n.tag === 'img' || n.tag === 'fimg') && n.raw !== undefined) {
        const src = safeUrl(n.raw, { image: true });
        if (src) images.push(src);
      }
      if (n.children) walk(n.children);
    }
  };
  walk(tree.children);
  const text = plainOf(tree.children).replace(/\s+/g, ' ').trim();
  return { images, text };
}

export function summarize(input, len = 120) {
  const { text } = analyze(input);
  return text.length > len ? text.slice(0, len) + '……' : text;
}

// 纯文本（聊天、留言昵称等）：只转义和换行
export function plain(input) {
  return escapeHtml(input).replace(/\n/g, '<br>');
}
