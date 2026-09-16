# 安全与测试清单

复古的是外观，不是工程质量。下面每一条都要做到，并且有测试覆盖。

## 安全硬性要求

| 项目 | 做法 | 骨架里的位置 |
| --- | --- | --- |
| CSRF | 令牌 = HMAC(密钥, 访客 id)，所有 POST 校验；只认表单字段 `_csrf` 或请求头，不认 URL 参数 | `src/middleware/basics.js` |
| XSS | 模板默认转义；富文本只允许换行转 `<br>`；搜索高亮先在原文匹配再分段转义 | `src/lib/text.js` |
| SQL | 全部参数化；`LIKE` 用 `likeEscape` + `ESCAPE '\'` | 各 service |
| 越权 | 订单、内容、地址都校验归属；别人的资源返回 404（不泄露是否存在） | 各 route |
| 会话 | 令牌存 sha256，Cookie 加 HttpOnly + SameSite；改密后踢掉其它设备；封禁立即下线 | `src/services/auth.js` |
| 限速 | 登录 20 次/10 分钟/IP、注册 5 个/小时/IP，发布、留言、下单都有上限 | `src/lib/ratelimit.js` |
| 响应头 | CSP（`script-src 'self'`）、nosniff、X-Frame-Options、Referrer-Policy | `src/middleware/basics.js` |
| 上传 | 按文件头识别 JPG/PNG/GIF/WEBP，不信任扩展名，不接受 SVG；大小与数量上限 | `src/lib/uploads.js` |
| 输入清洗 | 去零宽字符和控制字符、按码点截断（别切坏 emoji）、非字符串一律当空 | `src/lib/text.js` |
| 错误页 | 不泄露堆栈；404/403/413 都有 2003 风格的提示页 | `src/app.js` |

## 测试清单

**集成测试**（`test/*.test.js`，每个功能点一条主路径 + 关键错误路径）

- [ ] 注册：正常、重名（含大小写/全角）、弱密码、保留字、关闭注册
- [ ] 登录：正确、密码错、被封禁、限速、`next` 只接受站内相对地址
- [ ] 列表与搜索：筛选、排序、分页边界、无结果、非法参数不 500
- [ ] 核心闭环：每一步的正常路径 + 状态不对时的拒绝
- [ ] 权限：未登录跳登录、改别人的东西返回 404/403、普通会员进不了后台
- [ ] 安全：无 CSRF 令牌 403、URL 里的令牌无效、XSS 被转义、SQL/LIKE 注入无效
- [ ] 数据：演示数据幂等、重启后数据还在、空库能正常使用

**浏览器端到端**（`test/e2e/*.test.js`）

- [ ] 走完核心闭环（必要时开两个浏览器上下文模拟两个用户）
- [ ] 断言 `e.problems` 为空（控制台零报错、无 pageerror）
- [ ] 主要页面没有 `undefined` / `NaN` / `[object Object]` / 未渲染的 `{{`

**爬站自检**

```bash
npm run crawl -- http://127.0.0.1:<端口>                 # 游客视角
npm run crawl -- http://127.0.0.1:<端口> demo demo1234    # 登录视角
```

没有 404/500、没有模板残留才算过。

## 常见翻车点

1. 写了 `font-size` 没配点阵字体族 → 字糊。
2. 演示数据不幂等 → 重启数据翻倍，或删光后重启直接崩。
3. 长英文串撑破固定宽度布局 → 容器加 `word-break: break-all`。
4. 表单校验失败返回 400，浏览器控制台报错 → 原地重新渲染并返回 200（或在 e2e 里把预期状态码加进白名单）。
5. 同一页面有两个同名表单元素（比如页头搜索框和正文表单都有 `select[name=cat]`）→ 测试选择器要带表单 id。
6. 并发下单/重复提交 → 状态迁移用 `WHERE status = 旧状态`，库存扣减用 `WHERE stock >= n`。
