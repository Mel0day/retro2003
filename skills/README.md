# Skills

这里放的是可以直接交给 AI 编程助手使用的「技能包」。

## retro-site：复刻一个 2003 年版的网站

把任意现代网站或 App 复刻成 1999-2005 年的形态，并做成真的能用、能部署的站点。内容包括：完整工作流程、年代形态参考、视觉与点阵字体规则、演示数据配方、安全与测试清单、部署方案，以及一个能立刻跑起来的脚手架。

### 直接用脚手架（不需要 AI）

```bash
node skills/retro-site/scripts/new-site.mjs \
  --slug weibo2005 --name "微博 2005" --port 3005 \
  --tagline "随时随地分享新鲜事" --theme "#d4213d" --width 800
cd sites/weibo2005 && npm install && npm test && npm start
```

生成的骨架自带会员注册登录、内容发布（带图上传）、留言、顶一下、个人空间、站长后台、演示数据、8 项集成测试和 2 项浏览器测试。

### 装进 Claude Code

```bash
npm run install-skill      # 复制到 ~/.claude/skills/retro-site
```

之后在 Claude Code 里说「帮我做一个 2003 版的豆瓣」，它就会按这套流程走：问清产品和年代 → 写需求拆解 → 生成骨架 → 实现核心功能 → 造演示数据 → 跑测试 → 部署。

### 其它 agent

Codex、Cursor 之类的工具直接读文件也行：把 `skills/retro-site/SKILL.md` 的内容贴给它，或者告诉它「按仓库里 skills/retro-site/SKILL.md 的流程做一个 XX 的 2003 版」。
