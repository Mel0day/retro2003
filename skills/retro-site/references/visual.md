# 视觉还原与点阵字体

## 一、点阵字体（最容易翻车的一环）

当年的中文网页在 Windows XP 上是 12px 宋体，字体内置点阵字形、没有抗锯齿，边缘是硬的像素台阶。今天的 Mac 和手机没有 SimSun，只写 `font-family: 宋体` 会退回苹方，观感立刻变成 2020 年。

骨架自带了从文泉驿点阵宋体转出来的像素网页字体（`public/fonts` + `public/css/fonts.css`），按字号分成两族：

- `var(--f-song-N)`：宋体，N = 9…16，用于正文、标题、按钮、输入框
- `var(--f-sans-N)`：Verdana 风格的点阵西文，用于数字、计数器、英文小字

**规则：凡是写 `font-size` 的地方，必须同时写对应字号的字体族。**

```css
.title { font-size: 14px; font-family: var(--f-song-14); }   /* 对 */
.title { font-size: 14px; }                                   /* 错：会用 12px 的点阵缩放，糊 */
```

例外：大号数字（访客计数器、价格）用 `'Courier New'` 或 `Arial`，当年也是这样。

## 二、配色

骨架的 `public/css/site.css` 顶部有四个变量：主色、深色、浅色、边框色。脚手架按主色自动推导另外三个，也可以手工调。常见的年代配色：

- 门户蓝：`#1155aa`，浅色 `#eaf1f8`
- 社区红：`#cc0000`，浅色 `#fff0f0`
- 电商橙：`#ff6600`，浅色 `#ffe8cc`
- 论坛绿：`#2e7d32`，浅色 `#eaf5ea`

## 三、布局

- 固定宽度居中（`.wrap`），左右各一条 1px 灰边。
- 主体用 `<table>` 分栏：左栏 150-180px，右栏自适应；不要用 flex 布局大块结构（小范围对齐可以用）。
- 盒子：1px 边框 + 浅色标题条 + 虚线分隔行。
- 行高 1.7-1.9，正文 12px，标题 14px，大标题 16px。
- 所有可能被长文本撑破的单元格加 `word-break: break-all`，否则一行超长英文能把 778px 的表格撑到 3000px。

## 四、和设计稿比对

有原型（例如 Claude Design 出的 `.dc.html`）时：

```js
// 用 Playwright 把原型和站点截同一状态的图，再逐项比对
const ctx = await browser.newContext({ viewport: { width: 1000, height: 800 } });
await page.goto('file:///…/原型.dc.html'); await page.screenshot({ path: 'proto.png', fullPage: true });
await page.goto('http://127.0.0.1:3005/'); await page.screenshot({ path: 'site.png', fullPage: true });
```

比对清单：容器宽度、栏宽、表格列宽、边框颜色与虚实、标题条渐变、按钮样式、字号与行高、间距、链接颜色与 hover、空状态文案。
用 `getComputedStyle` 读关键元素的颜色和字号，和原型源码里的值逐个核对，比肉眼准。

## 五、别忘了的年代小物件

跑马灯公告、闪烁 NEW、访客计数器、「当前在线 N 人」、「设为首页 / 加入收藏」、友情链接、页脚备案号与浏览器建议、表单旁边的红色必填星号、操作成功后的 3 秒跳转提示页。
