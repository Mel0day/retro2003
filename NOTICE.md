# 第三方素材与商标声明

## 代码

本仓库的代码采用 MIT 许可证（见 [LICENSE](LICENSE)），全部为原创实现。

## 点阵字体

`sites/*/public/fonts/` 下的 woff2 字体由以下字体转换而来，随本仓库分发：

- **文泉驿点阵宋体（WenQuanYi Bitmap Song）**：GPL v2 并附字体嵌入例外条款（font embedding exception），即把字体嵌入文档或网页不会使文档本身受 GPL 约束。许可证原文随字体一起放在 `sites/*/public/fonts/LICENSE-wqy-bitmapsong.txt`。
- **Liberation Sans 的点阵版本**（同一源码包内，SIL Open Font License 1.1），用于西文数字和小字号。

转换脚本见 `sites/*/scripts/fonts/`：把 BDF 点阵字形转成方块轮廓的 woff2，并按字号生成 `--f-song-N` / `--f-sans-N` 两族 CSS 变量。

## 演示图片

`sites/*/seed/images/` 下的演示配图来自 [Unsplash](https://unsplash.com)，遵循 Unsplash License。每张图片的来源链接与作者署名记录在同目录的 `credits.json` 里。上传功能产生的图片不在仓库内。

## 商标与致敬声明

「小红书」「淘宝」「支付宝」「腾讯」「微信」等名称与标识是其各自权利人的注册商标。

本项目是一个怀旧向的技术演示：用 2003 年的网页形态重新想象这些产品在当年可能的样子。界面、文案与代码均为原创，未使用任何权利人的商标图形、UI 素材或数据；站内所有会员、商品、订单、金额都是虚构的演示数据，支付与资金全部是模拟的数字，不涉及真实交易。

本项目与上述公司没有任何关联、赞助或背书关系。若要把本项目用于对外运营，请自行更换站点名称并处理相应的合规事项（包括但不限于备案、支付资质和内容审核）。
