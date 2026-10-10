# 第三方资产来源与许可（Vendor NOTICE）

本目录下的文件来自开源项目，按原许可（MIT）使用。**修改过的地方均已注明**。

## `html-ppt-skill`

- 仓库：https://github.com/lewislulu/html-ppt-skill
- 版本：commit `fd1629067909ff55b36b905476de4e5f26062a1f`（2026-09-14）
- 许可：MIT（见本目录 `LICENSE`，Copyright (c) 2026 lewis <sudolewis@gmail.com>）
- 取用范围：
  - `base.css` —— 原样保留（设计令牌体系、固定 1920×1080 画布与缩放适配、排版阶梯、
    卡片/网格/图片框/页眉页脚/进度条/讲者备注等组件类）；它在 HTML 中**先加载**，
    我们的主题与版式在它之后注入。
  - `themes/*.css` —— 原样保留（`academic-paper`、`swiss-grid`、`editorial-serif`、`bauhaus`
    等 token 主题文件，每套 0.7–1.4KB）。
- **本平台的改动与补充**（不在原文件内，见 `../semantic/`）：
  - 字体：原项目主题把 `--font-*` 指向 Google Fonts（Inter / Noto Sans SC / Playfair…）。
    本平台**不引用任何 CDN**（内网与离线场景），在 `semantic/theme.ts` 的 `themeCss()` 里
    先注入系统中英字体栈，再挂 vendor 主题 —— 后者无法覆盖前者以外的字体依赖。
  - 版式：`semantic/layouts.css`（`ly-` 前缀）参考原项目 `templates/single-page/*.html`
    的视觉语言重写为平台自己的版式组件，未整段复制其文件（原因：可维护性 + 命名空间隔离）。
  - 运行时：`semantic/stage.ts` 内联自研运行时（缩放/翻页/postMessage 契约），
    未使用原项目的 `assets/runtime.js`（47KB，含讲者窗口、总览、动画等本平台暂不需要的能力）。

## 未采用的资产（仅作调研，不进入代码）

- `op7418/guizang-ppt-skill` —— **AGPL-3.0**：与平台自有代码组合并对外提供 Web 服务会触发
  copyleft 义务，因此**只借鉴其排版理念，不并入任何代码**。
- Anthropic 官方 `pptx` skill —— **source-available（非开源）**，不可用于生产环境。
