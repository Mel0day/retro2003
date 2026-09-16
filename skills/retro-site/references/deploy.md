# 部署

## 一、本地或单机 Docker（最简单）

```bash
cp .env.example .env     # 至少改 ADMIN_PASSWORD 和 SESSION_SECRET
docker compose up -d --build
```

数据在命名卷里（SQLite 库 + 上传的图片 + 备份）。`docker compose down` 不会删数据，`-v` 才会。

多个站点一起跑：在仓库根目录的 `docker-compose.yml` 里加一个服务，端口顺延。

## 二、前面挂 Nginx

参考 `sites/*/deploy/nginx.conf`。注意：

- `client_max_body_size` 要大于上传上限（站点默认单图 2MB，配 8m 比较稳）
- `/static/` 和 `/uploads/` 可以设长缓存；模板里的静态资源带 `?v=` 版本号，重启即失效
- 如果有 SSE（聊天室、实时推送），那个路径要关掉 `proxy_buffering`

## 三、不开公网端口（Cloudflare Worker + Tunnel）

本仓库两个线上站用的方案，步骤见 `sites/*/deploy/cloudflare/README.md`：

```
浏览器 → Cloudflare 边缘（Worker 自定义域名）→ Workers VPC 服务 → Cloudflare Tunnel → 服务器容器
```

源站不向宿主机发布端口，公网和同机其他进程都绕不过 Worker。Worker 负责 http→https、HSTS、覆盖 `X-Forwarded-For`、静态资源边缘缓存、源站挂掉时显示维护页。

关键点：`TRUST_PROXY` 只写隧道连接器的固定内网地址，写成 `uniquelocal` 会让同机进程能伪造客户端 IP，绕过按 IP 的限速。

## 四、上线前检查

- [ ] `ADMIN_PASSWORD` 是强密码，`SESSION_SECRET` 已设置
- [ ] `SEED_DEMO=false`（演示数据只在首次导入）
- [ ] `npm test` 和 `npm run test:e2e` 全绿
- [ ] 爬站自检无 404/500
- [ ] README 写清楚演示账号、已知限制、免责与商标声明
- [ ] 备份：`npm run backup` 加进 crontab，数据卷（含 uploads）定期打包

## 五、备份与恢复

```bash
docker exec <容器名> npm run backup     # SQLite 在线备份到 /data/backups，保留 14 份
```

恢复：停应用 → 用备份的 `.db` 覆盖数据目录里的库（删掉 `-wal`/`-shm`）→ 解出 `uploads/` → 启动。
备份和数据在同一块盘上只防误删，重要数据要定期拉到异地。
