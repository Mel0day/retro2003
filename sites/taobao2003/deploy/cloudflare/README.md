# 线上部署：taobao-2003.dshmod.com

> 本文是这两个站点线上部署的真实做法，已经把服务器地址、密钥名和账号 ID 换成占位符。
> 自己部署时把占位符换成你自己的值即可；也可以完全不用 Cloudflare，直接看仓库根目录 README 的「本地运行」或站点 README 的 Nginx 方案。

2026-09-16 上线。和根目录 README 里的 Nginx 方案不同，这里不开任何公网端口，全部流量走 Cloudflare。
做法与同一台服务器上的 `xhs-2003.dshmod.com`（`~/projects/xhs2003`）完全一致，只是名字、端口和网段不同。

## 架构

```
浏览器
 └─ Cloudflare 边缘 taobao-2003.dshmod.com（Worker 自定义域名，DNS 和证书由 wrangler deploy 自动创建）
     └─ Worker「taobao2003-gateway」（worker.js）
          · http → https 308，加 HSTS
          · 覆盖 X-Forwarded-Proto / X-Forwarded-For（取 CF-Connecting-IP）
          · /static/ 走边缘缓存；源站不可达时返回维护页
         └─ Workers VPC 服务「taobao2003-origin」（<VPC 服务 ID>，http taobao2003:3004）
             └─ Cloudflare Tunnel「taobao2003」（<隧道 ID>）
                 └─ AWS EC2 <服务器 IP> · ~/workspace/taobao2003（compose 项目 taobao2003，网段 172.20.0.0/24）
                     ├─ taobao2003-tunnel（172.20.0.3）：cloudflared，只在 compose 网络内
                     └─ taobao2003（172.20.0.2）：应用，不向宿主机发布端口，数据在卷 taobao2003_taobao-data
```

之所以用 Worker + VPC 而不是直接给隧道加 CNAME：本机 wrangler 的 OAuth 登录没有 DNS 编辑权限，而 Worker 自定义域名和 VPC 服务只需要现有权限。

这台 EC2 同时跑着 www.efflora.ai、xhs-2003.dshmod.com 和其他项目的容器，只动 `~/workspace/taobao2003`、这两个容器和下面的 crontab。

## 升级应用

rsync 传的是本机工作区原样内容，未提交、未测试的改动也会一起上线（`--delete` 还会删掉服务器上本地已删除的文件）。先确认工作区是要上线的状态、`npm test` 通过，再在本机的站点目录（`sites/taobao2003/`）里执行：

```bash
rsync -az --delete -e "ssh -i ~/.ssh/<你的 SSH 私钥>.pem" \
  --exclude /node_modules --exclude /data --exclude /test-results --exclude /.git \
  --exclude /design --exclude /docs/shots --exclude .DS_Store --exclude /.env --exclude /.tunnel.env \
  ./ ubuntu@<服务器 IP>:workspace/taobao2003/
ssh -i ~/.ssh/<你的 SSH 私钥>.pem ubuntu@<服务器 IP> \
  'cd ~/workspace/taobao2003 && DOCKER_CONFIG=~/.docker-anon docker compose up -d --build \
   && docker image prune -f --filter label=com.docker.compose.project=taobao2003'
```

- 服务器 `.env` 里有 `COMPOSE_FILE=docker-compose.yml:deploy/cloudflare/compose.tunnel.yml`，所以不用写两个 `-f`。
- **必须带 `DOCKER_CONFIG=~/.docker-anon`**：服务器 `~/.docker/config.json` 里的 Docker Hub 令牌已过期，不带它连公共镜像都拉不下来。那份配置是别的项目共用的，不要改。匿名拉取按 IP 限额 100 次/小时。
- 改了 compose 里的网段、地址这类网络配置时，`up -d` 会报网络配置不一致，要先 `docker compose down`（不带 `-v`）再 `up -d`。
- 永远不要 `docker compose down -v`，会删掉数据卷。
- 重建期间几秒内访客会看到 Worker 的维护页。

## 改 Worker

```bash
npx wrangler deploy -c deploy/cloudflare/wrangler.jsonc
```

## 首次搭建（已完成，重建时参考）

```bash
npx wrangler tunnel create taobao2003
# 取连接器令牌写进服务器 ~/workspace/taobao2003/.tunnel.env（TUNNEL_TOKEN=...，chmod 600）：
#   GET https://api.cloudflare.com/client/v4/accounts/<Cloudflare 账号 ID>/cfd_tunnel/<隧道 ID>/token
#   Authorization: Bearer <~/Library/Preferences/.wrangler/config/default.toml 里的 oauth_token>
npx wrangler vpc service create taobao2003-origin --type http \
  --tunnel-id <隧道 ID> --hostname taobao2003 --http-port 3004
# 把返回的服务 ID 写进 wrangler.jsonc 的 vpc_services，再 wrangler deploy
```

服务器 `.env` 除了 `.env.example` 里的项，还需要：

- `TRUST_PROXY=172.20.0.3`：只信任隧道连接器的固定地址（见 compose.tunnel.yml）。写成 `uniquelocal` 会让宿主机上的其他进程伪造客户端 IP，绕过按 IP 的限速。
- `COMPOSE_FILE=docker-compose.yml:deploy/cloudflare/compose.tunnel.yml`
- `SEED_DEMO`：首次启动时是 `true`（导入演示数据），导入后已改回 `false`。演示数据全部删光后再带 `true` 启动会因为会员重名而失败。
- `ADMIN_PASSWORD` 只在首次启动创建站长时需要；站长密码本机保存在 `~/.config/taobao2003/production.env`（600）。

## 备份

服务器 ubuntu 用户的 crontab（UTC）：

- 03:47 `docker exec taobao2003 npm run backup`：SQLite 在线备份到卷内 `backups/`，保留 14 份。
- 03:57 把卷打包到 `~/backups/taobao2003/taobao2003-日期.tgz`（含一致性备份和上传的宝贝图片，不含正在写的库文件），同时复制 `.env` 为 `env.latest`，保留 14 天。日志在 `~/backups/taobao2003/backup.log`。

这些备份和数据在同一块 EBS 盘上，只防误删和数据损坏，不防实例丢失；需要异地副本时把 `~/backups/taobao2003` 定期拉回本机。

恢复：停应用 → 把 tgz 里 `backups/` 下最新的 `.db` 拷成卷里的 `taobao2003.db`（删掉旧的 `-wal`/`-shm`）→ 解出 `uploads/` → 启动。

## 上线后的检查清单

```bash
curl -s https://taobao-2003.dshmod.com/healthz            # {"ok":true}
curl -sI http://taobao-2003.dshmod.com/ | head -1          # 308 跳 https
node scripts/crawl.mjs https://taobao-2003.dshmod.com      # 无 404/500（「慢」是跨网络往返，属正常）
```

演示账号：买家 `demo` / `demo1234`，卖家 `数码小铺` / `demo1234`，站长 `淘宝小二`（密码在本机 `~/.config/taobao2003/production.env`）。
演示账号是公开的弱密码，只放演示数据；不要用演示账号存放任何真实信息。

## 已知的小问题

- Cloudflare 会给页面自动注入统计脚本 `static.cloudflareinsights.com/beacon.min.js`，被本站的 CSP（`script-src 'self'`）拦掉，浏览器控制台会有一条报错。功能不受影响；要消除它，可以在 Cloudflare 面板关掉该域名的 Web Analytics 自动注入，或在 CSP 里放行这个域名（不建议）。
