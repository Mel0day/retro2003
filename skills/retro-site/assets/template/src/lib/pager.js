// 分页：返回页码、偏移量和「页次：1/4 2 3 4 下一页」所需的链接数据
export function paginate({ total, page, perPage, baseUrl, param = 'page', window = 5 }) {
  const pages = Math.max(1, Math.ceil(total / perPage));
  const current = Math.min(Math.max(1, parseInt(page, 10) || 1), pages);
  const link = (p) => {
    const [path, qs = ''] = baseUrl.split('?');
    const sp = new URLSearchParams(qs);
    if (p === 1) sp.delete(param); else sp.set(param, String(p));
    const q = sp.toString();
    return q ? `${path}?${q}` : path;
  };
  let start = Math.max(1, current - Math.floor(window / 2));
  const end = Math.min(pages, start + window - 1);
  start = Math.max(1, end - window + 1);
  const nums = [];
  for (let p = start; p <= end; p++) nums.push({ n: p, url: link(p), current: p === current });
  return {
    total, pages, current, perPage,
    offset: (current - 1) * perPage,
    nums,
    first: link(1), last: link(pages),
    prev: current > 1 ? link(current - 1) : null,
    next: current < pages ? link(current + 1) : null,
    link,
  };
}
