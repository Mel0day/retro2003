# __NAME__

__TAGLINE__ —— 用 2003 年的网页形态复刻的站点。

## 运行

```bash
npm install
DATA_DIR=./data SEED_DEMO=true ADMIN_USERNAME=__ADMIN__ ADMIN_PASSWORD=改成12位以上的密码 npm start
# 打开 http://localhost:__PORT__
npm test            # 集成测试
npm run test:e2e    # 浏览器端到端测试
npm run crawl -- http://127.0.0.1:__PORT__   # 爬站自检：404/500、模板残留
```

演示账号：`demo` / `demo1234`（`SEED_DEMO=true` 导入后）。

## 页面与路由

| 路由 | 说明 |
| --- | --- |
| `GET /` | 首页：栏目、搜索、分页、人气排行、站长公告 |
| `GET /entry/:id` | 内容详情、留言、顶一下 |
| `GET/POST /publish` | 发布内容（可传一张图） |
| `POST /entry/:id/comment` `like` `delete` | 留言、顶一下、删除 |
| `GET/POST /login` `/register` `POST /logout` | 登录、注册、退出 |
| `GET /my` `POST /my/profile` `/my/password` | 我的空间、资料、改密 |
| `GET /u/:id` | 会员主页 |
| `GET /admin` … | 站长后台：统计、会员、内容、留言、站点设置 |

> 这是脚手架生成的骨架，上面的「内容 / 留言」是示例业务。请按你的产品替换 `src/services/entries.js`、`src/routes/entries.js`、数据库表和视图，并同步更新本文件。

## 待办清单

- [ ] 用 `docs/需求拆解.md` 写清楚复刻对象、年代形态和核心闭环
- [ ] 把示例的 entries/comments 换成真正的业务对象与动作
- [ ] 调整 `public/css/site.css` 顶部的主色变量与页面宽度，对着原型还原
- [ ] 把 `scripts/seed-data.js` 换成像运营了一两年的演示数据
- [ ] 补测试：每个功能点的主路径与错误路径；`npm test` 和 `npm run test:e2e` 全绿
- [ ] `npm run crawl` 确认没有 404/500 和模板残留
- [ ] 更新本文件：功能清单、数据模型、演示账号、已知限制
