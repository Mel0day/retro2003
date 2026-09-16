// xhs-2003.dshmod.com 的入口 Worker：把请求经 Workers VPC 转发到服务器上的 Cloudflare Tunnel。
// 源站不向宿主机发布端口，公网和宿主机上的其他进程都无法绕过本 Worker 直接访问。

// 模板里的样式和脚本都带 ?v=<启动时间>，每次重启换新地址，边缘缓存不会拿到旧文件。
// /uploads/ 不在边缘缓存：后台删除的图片应当尽快失效。
const EDGE_CACHEABLE = /^\/static\//;
const HSTS = 'max-age=31536000';

function maintenancePage() {
  return new Response(
    '<!doctype html><meta charset="utf-8"><title>正在维护</title><p style="font:14px/1.8 SimSun,serif;text-align:center;margin-top:20vh">小红书 2003 正在维护，请稍后刷新。</p>',
    { status: 502, headers: { 'content-type': 'text/html; charset=utf-8', 'retry-after': '30', 'cache-control': 'no-store', 'strict-transport-security': HSTS } },
  );
}

function withHsts(response) {
  const res = new Response(response.body, response);
  res.headers.set('Strict-Transport-Security', HSTS);
  return res;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // 明文 HTTP 下应用会发 Secure Cookie，浏览器存不住，登录必然 CSRF 失败，而密码已经明文发出。
    if (url.protocol === 'http:') {
      url.protocol = 'https:';
      return Response.redirect(url.toString(), 308);
    }

    const cacheable = request.method === 'GET' && EDGE_CACHEABLE.test(url.pathname);
    if (cacheable) {
      const hit = await caches.default.match(request);
      if (hit) return withHsts(hit);
    }

    const headers = new Headers(request.headers);
    // 应用靠 X-Forwarded-Proto 给登录 Cookie 加 Secure，靠 X-Forwarded-For 做按 IP 限速。
    // 这里用 Cloudflare 看到的真实客户端地址覆盖，客户端自带的伪造值不会传到源站。
    headers.set('X-Forwarded-Proto', 'https');
    headers.set('X-Forwarded-Host', url.host);
    const clientIp = request.headers.get('CF-Connecting-IP');
    if (clientIp) headers.set('X-Forwarded-For', clientIp);
    else headers.delete('X-Forwarded-For');
    for (const name of ['Forwarded', 'X-Real-IP', 'True-Client-IP']) headers.delete(name);

    let response;
    try {
      // 主机名只是占位，实际目标由 VPC 服务配置决定
      response = await env.ORIGIN.fetch(`http://xhs2003:3003${url.pathname}${url.search}`, {
        method: request.method,
        headers,
        body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
        // 应用的 303/301 要原样交给浏览器，不能在 Worker 里跟随
        redirect: 'manual',
      });
    } catch (err) {
      console.error('origin unreachable', err);
      return maintenancePage();
    }
    if (response.status === 502 || response.status === 503 || response.status === 504) return maintenancePage();

    if (cacheable && response.status === 200 && !response.headers.has('Set-Cookie')) {
      ctx.waitUntil(caches.default.put(request, response.clone()));
    }
    return withHsts(response);
  },
};
