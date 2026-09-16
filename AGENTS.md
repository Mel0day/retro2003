# 给 AI agent 的说明

这个仓库有两个独立的 Node.js 站点（`sites/xhs2003`、`sites/taobao2003`），都是服务端渲染 + SQLite，没有前端构建步骤。下面是让它们在本地跑起来、跑测试、部署上线的完整步骤。按顺序执行即可，不需要额外提问。

## 环境要求

- Node.js 22 或更高（推荐 24），npm
- 可选：Docker（最省事的方式）
- 可选：Chromium（跑浏览器端到端测试用）

## 一、本地跑起来

### Docker（首选）

```bash
docker compose up -d --build
# 小红书 2003 → http://localhost:3003
# 淘宝网 2003 → http://localhost:3004
docker compose logs -f          # 看日志
docker compose down             # 停止（加 -v 会删掉数据卷）
```

### 不用 Docker

```bash
npm run setup          # 等价于在两个站点目录里各跑一次 npm install
npm run dev:xhs        # 前台运行小红书 2003，端口 3003
npm run dev:taobao     # 前台运行淘宝网 2003，端口 3004
```

两条 dev 命令都会前台阻塞，需要分别在不同的终端（或后台）运行。首次启动会自动导入演示数据。

环境变量（两个站点通用，完整列表见各自的 `.env.example`）：

| 变量 | 说明 |
| --- | --- |
| `PORT` / `HOST` | 监听端口与地址，默认 3003 / 3004 与 `0.0.0.0` |
| `DATA_DIR` | 数据目录（SQLite 库、上传的图片、备份），默认站点目录下的 `data/` |
| `SEED_DEMO` | `true` 时在空库里导入演示数据 |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | 首次启动创建站长账号；之后改这两个值不会改已有账号的密码 |
| `SESSION_SECRET` | 会话签名密钥，不填会自动生成并存在数据目录 |
| `TRUST_PROXY` | 反向代理信任设置，本机直连用默认值即可 |

## 二、验证

```bash
curl -s localhost:3003/healthz && curl -s localhost:3004/healthz   # 都应返回 {"ok":true}
npm test              # 集成测试：小红书 59 项 + 淘宝 80 项
npm run test:e2e      # 浏览器端到端：小红书 9 项 + 淘宝 5 项
node sites/taobao2003/scripts/crawl.mjs http://127.0.0.1:3004 demo demo1234   # 爬站自检
```

浏览器测试需要 Chromium。若本机没有 playwright 自带浏览器，设置 `PW_CHROMIUM=/绝对路径/chrome-headless-shell`，或先运行 `npx playwright install chromium`。

## 三、演示账号

| 站点 | 账号 | 密码 | 说明 |
| --- | --- | --- | --- |
| 淘宝网 2003 | `demo` | `demo1234` | 买家，手上有各种状态的订单 |
| 淘宝网 2003 | `数码小铺` | `demo1234` | 卖家，有待发货订单和在售宝贝 |
| 淘宝网 2003 | 站长 | 见 `ADMIN_PASSWORD` | 后台 `/admin` |
| 小红书 2003 | 自行注册 | — | 注册页有图形验证码；站长账号同样由 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 创建 |

## 四、部署到服务器

1. 最简单：把仓库或单个站点目录传到服务器，`docker compose up -d --build`，前面用 Nginx 反代（`sites/*/deploy/nginx.conf` 是现成示例，注意 `client_max_body_size` 要放开，站点有图片上传）。
2. 不开公网端口的做法：Cloudflare Worker + Workers VPC + Cloudflare Tunnel，步骤写在 `sites/*/deploy/cloudflare/README.md`（文档里的服务器地址、密钥名、账号 ID 都是占位符，换成自己的）。
3. 上线前务必设置强 `ADMIN_PASSWORD` 和 `SESSION_SECRET`，并把 `SEED_DEMO` 改回 `false`。

## 五、改代码时的约定

- 两个站点互相独立，不要在它们之间抽公共包；各自的 `README.md` 和 `docs/需求拆解.md` 是权威文档，改了功能要同步更新。
- 保持 2003 年的形态：表格排版、内联风格、跑马灯、点阵字体；**凡是写 `font-size` 的地方都要同时写对应的点阵字体族变量**（`var(--f-song-12)` 这类），否则点阵字会被缩放糊掉。
- 页面脚本放在 `public/`，模板里不写内联 `<script>` 和内联事件（站点有严格 CSP）。
- 所有 POST 都要带 CSRF 令牌；SQL 一律参数化；用户输入在模板里默认转义。
- 改完必须跑 `npm test`；涉及页面交互的还要跑 `npm run test:e2e`。
- 不要提交 `data/`、`.env`、`node_modules`、测试产物。
