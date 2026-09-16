# 小红书 2003

> 本站是 [retro2003](../../README.md) 项目的一部分：用 2003 年的互联网形态复刻今天的主流产品。仓库根目录有两个站点一起跑的 Docker 编排。

一个「如果小红书诞生在 2003 年」的复古门户风社区站：778px 宽的三栏首页、渐变标题栏、闪烁的 NEW、访客计数器、盖楼留言、论坛、聊天室，外加一个 WAP 2.0 手机版。

视觉原型来自 Claude Design 项目「小红书 2003 年风格重设」，三张稿的源文件和截图在 `design/` 目录。需求拆解见 [docs/需求拆解.md](docs/需求拆解.md)。

## 功能一览

| 模块 | 内容 |
| --- | --- |
| 首页 | 会员登录框、频道导航、站内搜索、友情链接、今日推荐、最新笔记、好物推荐、论坛热帖、热门标签、人气排行、站长公告、访客计数器 |
| 笔记 | UBB 编辑器与图片上传、频道和标签、顶一下、收藏、送花、盖楼留言与审核、打印版、举报、字号切换 |
| 论坛 | 分区版块、置顶精华锁帖、投票帖、楼层分页、版主工具 |
| 购物 | 商品分类与详情、下单扣库存、货到付款 / 邮局汇款 / 银行转账、订单状态流转 |
| 相册 | 建相册、批量上传、空间配额、封面、照片浏览 |
| 聊天室 | 多房间、实时推送、在线名单、字体颜色和动作 |
| 会员 | 注册登录、记住我、密码提示问题找回、个人主页、控制面板、头像、好友、短消息、积分等级 |
| 排行榜与搜索 | 点击 / 顶 / 送花 / 热评榜，积分榜、发帖榜、销量榜；笔记 / 用户 / 商品 / 帖子搜索 |
| WAP 版 | `/wap`，数字快捷键、正文分页、留言、论坛、聊天室，手机访问首页自动跳转 |
| 站长后台 | `/admin`，概况、会员、笔记、留言审核、举报、频道、论坛版块、聊天室、商品订单、公告、广告、友情链接、单页、站点设置 |

## 技术栈

Node.js 22+、Express 5、Nunjucks 服务端渲染、SQLite（better-sqlite3，WAL 模式）、原生 JS 渐进增强、Server-Sent Events。没有前端构建步骤，单进程加一个数据目录即可运行。

## 2003 年的点阵字体

当年的中文网页在 Windows XP 上用 12px 宋体显示：字体内置点阵字形、没有抗锯齿，边缘是锐利的像素台阶。现在的 Mac 和手机没有 SimSun，只写 `font-family: 宋体` 会退回苹方等圆润字体，所以本站自带了一套像素网页字体：

- **来源**：文泉驿点阵宋体（12、13、14、16px，覆盖 GBK 全部汉字）和同一源码包里的 Liberation Sans 点阵版（Verdana 风格的数字和小字）。
- **做法**：`scripts/fonts/build_pixel_fonts.py` 把每个点阵像素转成方块轮廓，按设计尺寸使用时一个字体像素正好对应一个 CSS 像素；粗体按 Windows 伪粗体的方式向右多描一像素；全角冒号、分号按国标靠左摆放。
- **分片加载**：每个尺寸按西文、符号、汉字两段切成 4 个文件，页面只下载用到的部分，12px 常规体汉字约 600KB，浏览器缓存后不再下载。
- **字号规则**：9~11px 的中文按 12px 点阵显示，这也是当年中文网页的习惯。17px 以上的标题用系统黑体或宋体。
- **写样式时**：设置 `font-size` 的地方要同时写 `font-family: var(--f-song-N)` 或 `var(--f-sans-N)`，否则点阵字会被缩放发虚，变量定义在 `public/css/fonts.css`。

重新生成字体：

```bash
pip install fonttools brotli
python3 scripts/fonts/build_pixel_fonts.py <xfonts-wqy 源码目录> public/fonts
node scripts/fonts/gen_font_css.mjs
```

源码包可从 Debian 获取：`http://deb.debian.org/debian/pool/main/x/xfonts-wqy/xfonts-wqy_1.0.0~rc1.orig.tar.gz`。

## 本地运行

```bash
npm install
cp .env.example .env            # 按需修改
npm run seed                    # 可选：导入演示数据
npm run dev                     # http://localhost:3003
```

首次启动会用 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 创建站长账号。也可以随时用命令创建或重置：

```bash
npm run create-admin -- 站长 新的强密码
```

## 测试

```bash
npm test          # 集成测试：每个测试文件起一个独立实例和临时数据库
npx playwright install chromium   # 首次运行端到端测试前安装浏览器
npm run test:e2e  # 浏览器端到端测试，截图输出到 test-results/
```

| 测试 | 数量 | 覆盖 |
| --- | --- | --- |
| `test/core.test.js` | 8 | UBB 安全、CSRF、注册登录找回、封禁、笔记全流程、上传校验 |
| `test/forum.test.js`、`rank-search.test.js` | 9 | 发帖回帖楼层、投票防重、锁帖、版主工具、排行、搜索通配符转义、后台版块 |
| `test/shop.test.js`、`album.test.js` | 7 | 下单扣库存、取消恢复、订单越权、后台发货通知、相册配额与删除 |
| `test/users.test.js`、`chat.test.js`、`pages.test.js` | 17 | 个人主页、资料头像密码、好友、短消息越权、聊天限速与推送、帮助单页 |
| `test/admin.test.js` | 9 | 后台权限分级、推荐隐藏、批量审核、举报流转、封禁、积分、站点设置生效 |
| `test/wap.test.js` | 9 | 手机跳转、正文分页、顶和留言、论坛聊天、我的小红书、页面字节数 |
| `test/e2e/*.test.js` | 9 | 真实浏览器：首页登录发笔记传图、游客留言审核、聊天室实时互发、下单取消、投票帖、后台审核、相册上传、WAP 翻页 |

已使用本机缓存的 Chromium 时，可以用 `PW_CHROMIUM=<chrome 可执行文件路径> npm run test:e2e` 跳过下载。

## 部署

### 方式一：Docker Compose（推荐）

```bash
git clone <你的仓库> xhs2003 && cd xhs2003
cp .env.example .env && vi .env     # 至少改 ADMIN_PASSWORD 和 SESSION_SECRET
docker compose up -d --build
docker compose logs -f               # 看到「已启动」即可访问 http://服务器IP:3003
```

数据（数据库和上传的图片）保存在名为 `xhs-data` 的 Docker 卷里，升级镜像不会丢失。

```bash
git pull && docker compose up -d --build           # 升级
docker compose exec xhs2003 npm run backup         # 备份数据库到卷内 backups/ 目录
docker compose exec xhs2003 npm run seed           # 导入演示数据
```

### 方式二：直接用 Node 运行

```bash
# 服务器上安装 Node.js 22 或更高版本
git clone <你的仓库> /opt/xhs2003 && cd /opt/xhs2003
npm ci --omit=dev
cp .env.example .env && vi .env
sudo cp deploy/xhs2003.service /etc/systemd/system/
sudo mkdir -p /var/lib/xhs2003 && sudo chown www-data /var/lib/xhs2003
sudo systemctl daemon-reload && sudo systemctl enable --now xhs2003
```

### 加上域名和 HTTPS

参考 `deploy/nginx.conf`。要点有三个：

1. 聊天室的 `/api/chat/<房间>/stream` 必须关闭 `proxy_buffering`，否则消息不实时。
2. `client_max_body_size` 要大于后台设置的单张图片上限。
3. 必须传 `X-Forwarded-Proto`，并把 `TRUST_PROXY` 设成代理所在网段，这样登录 Cookie 才会带 Secure 标记，限速也能拿到真实 IP。

Docker 部署在 Nginx 后面时，把 `docker-compose.yml` 的端口改成 `127.0.0.1:3003:3003`，避免绕过 Nginx 直接访问。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3003` | 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `DATA_DIR` | `./data` | 数据库、上传文件、备份所在目录 |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | 空 | 首次启动时创建站长账号 |
| `SESSION_SECRET` | 自动生成 | 签名密钥，自动生成时保存在 `DATA_DIR/secret.key` |
| `TRUST_PROXY` | `loopback` | Express 的 trust proxy 设置 |
| `SEED_DEMO` | `false` | 启动时导入演示数据（已有笔记时跳过） |
| `LOG_REQUESTS` | 生产环境开启 | 是否打印访问日志 |
| `SITE_TZ` | `Asia/Shanghai` | 页面显示时间所用时区 |

站名、口号、站长信箱、备案号、审核策略、上传限制等运营参数都在后台「站点设置」里改，不需要重启。

## 数据与备份

- 数据库文件：`DATA_DIR/xhs2003.db`（WAL 模式，旁边的 `-wal`、`-shm` 文件也属于数据库）。
- 上传图片：`DATA_DIR/uploads/`。
- `npm run backup` 用 SQLite 在线备份接口生成一致性快照，默认保留 14 份，可以配合 cron 每天执行；图片目录用 rsync 等工具另外备份。
- 升级时数据库结构自动迁移（`src/db/index.js` 按 `PRAGMA user_version` 顺序执行）。

## 安全设计

- 密码和提示问题答案用 scrypt 加盐哈希。
- 会话 Cookie 为 HttpOnly + SameSite=Lax，HTTPS 下自动加 Secure；「记住我」有效期 14 天。
- 所有 POST 请求校验 CSRF 令牌；严格的 Content-Security-Policy 禁止内联脚本。
- 用户内容一律转义，UBB 代码经语法树解析后输出，链接和图片地址走白名单。
- 上传按文件头识别图片类型，随机文件名，限制单张大小和相册总空间。
- 登录、注册、找回密码、留言、发帖、聊天、上传均有限速；封禁会员立即失效所有会话。

## 上线前请注意

- **名称与商标**：「小红书」是行吟信息科技的注册商标。本项目是复古风格的设计练习，公开上线前请在后台「站点设置」里换成你自己的站名。
- **备案**：在中国大陆服务器上公开运营需要 ICP 备案，备案号填在后台「站点设置」里即会显示在页脚。
- **演示数据**：演示会员使用随机密码，无法登录；演示商品和广告只是示意，正式运营前请在后台清理或替换。
- **字体许可**：像素字体由文泉驿点阵宋体转换而来，遵循 GPL v2 并附字体嵌入例外，网页使用该字体不会让网站代码受 GPL 约束。许可证原文在 `public/fonts/LICENSE-wqy-bitmapsong.txt`，转换脚本在 `scripts/fonts/`。
- **演示图片**：来自 Unsplash，遵循 [Unsplash License](https://unsplash.com/license)，作者与出处见 `seed/images/credits.json`。

## 目录结构

```
src/
  app.js            应用装配：中间件、模板、路由
  server.js         启动入口
  config.js         环境变量
  db/               表结构与迁移
  lib/              UBB 解析、验证码、上传、分页、格式化、限速
  middleware/       Cookie、访客、CSRF、安全头
  services/         业务逻辑（笔记、论坛、聊天、积分、会话…）
  routes/           页面与接口（admin/ 为后台子模块）
views/              Nunjucks 模板（wap/ 为手机版，admin/ 为后台）
public/             样式与前端脚本
scripts/            演示数据、创建站长、备份
seed/images/        演示图片
deploy/             Nginx 与 systemd 示例
test/               集成测试与端到端测试
design/             Claude Design 原型源文件
```
