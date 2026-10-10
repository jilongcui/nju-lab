# 幻灯片改版调研与规划：从「版式枚举」到「语义内容 + 固定舞台 + 设计系统」（2026-10-10）

> 目标读者：接手实现的人。现状功能指南见 `docs/SLIDES.md`，历史设计见
> `docs/DESIGN-2026-09-29-chapter-slides.md`、`docs/DESIGN-2026-09-30-slides-images.md`。
> 本文是**规划 + 落地记录**：§1–§8 是规划（`[已核实]` = 实际 clone 仓库看到的事实），
> §9 = P0（渲染层），§10 = P1（接入平台），§11 = P2 前置验证（语义 prompt 离线端到端），
> 均为 2026-10-10 当天实现并验证。

## 0. 一句话与结论

现有实现**已经是 HTML 渲染**（`SlideJson → renderDeck.ts → 自包含 reveal 文档 → iframe srcdoc`），
"死板"的根因不是 HTML，而是**版式被钉死成 16 种枚举**、每个版式的 DOM/CSS 写死在渲染层，
模型只能在格子里填字。因此改版的主张是：

> **把「模型选版式填字」换成「模型表达内容语义 + 程序选版式 + 固定 1920×1080 舞台 + 可换的设计系统」。**

三层解耦：**内容抽象层（语义页模型）→ 版式层（语义块 → 版式组件）→ 主题层（CSS token）**。
版式与主题资产**不必自研**：生态里已有成熟、MIT 许可、纯 CSS/零依赖、可直接 vendored 的库
（见 §2），其中 `html-ppt-skill` 的 37 个单页版式恰好覆盖了缺口最大的「图示/时间轴/关系/数据」。
编辑面按用户意见**收窄**（不指望教师手改字），教师保留四条操作，见 §3.6。

## 1. 现状诊断（为什么"死板"）

| # | 事实 | 位置 |
|---|---|---|
| 1 | 版式是**封闭枚举** `SLIDE_LAYOUTS`（16 种） | `server/src/slides/deck.schema.ts` |
| 2 | 页面 DOM 由 `switch (layout)` + 硬编码 CSS 类生成，样式全在 `BASE_OVERRIDES` 里 | `web/src/slides/renderDeck.ts` |
| 3 | 大纲 prompt 把选型规则**钉死**给学生模型（"要点用 bullets / 有数字用 stat…"） | `server/src/slides/slides.generator.ts` `LAYOUT_HINT` |
| 4 | 模板只能**调参**（主色/字体栈/圆角/疏密/字号/卡片样式），`designToCss` 只吐少数 CSS 变量 | `server/src/slides/template.schema.ts` |
| 5 | 内容过载只能**整体缩字号**（`slideWeight → deck-fit-2/3`），换不了更好的布局 | `web/src/slides/renderDeck.ts` |
| 6 | 效果评分里 D2/D3/D4 已全 5 分，**长期卡在 D7 整体观感 4 分、D5 版式多样 4–5 分** | `docs/REVIEW-slides-rubric.md` |

第 6 条说明瓶颈明确在**观感与版式自由度**，而不是内容组织能力 —— 这正好是外部成熟设计系统能补的短板。

## 2. 外部可复用资产调研（plugin / skill）

生态已经形成一个成熟的「Agent Skill → 单文件 HTML 演示」品类，多数是 MIT/Apache，可 vendored。
以下为本次实际 clone 后核实的信息（`[已核实]`）。

| 项目 | 许可 | 资产形态（本次实测） | 可复用点 | 风险 |
|---|---|---|---|---|
| **`lewislulu/html-ppt-skill`** | **MIT** `[已核实]` | `assets/base.css` **15.3KB** token+组件；`assets/themes/*.css` **36 套**，各 **0.7–1.4KB**；`templates/single-page/*.html` **37 个版式，共 66KB**；`assets/runtime.js` **46.9KB**（导航/总览/讲者模式/画布缩放） | **主力资产来源**：token 主题体系 + 37 个版式片段（含 `timeline`/`roadmap`/`gantt`/`flow-diagram`/`arch-diagram`/`mindmap`/`kpi-grid`/`chart-*`/`table`/`diff`/`terminal`）+ 固定画布缩放运行时 | 图示版式全是**纯 HTML/CSS**（`[已核实]`：`flow-diagram.html`/`timeline.html` 零外部依赖）；仅 `chart-*` 用 Chart.js CDN、`code.html` 用 highlight.js CDN —— 需换内联/自有实现 |
| **`zarazhangrui/frontend-slides`** | **MIT** `[已核实]` | `viewport-base.css` **2.7KB**（固定 16:9 舞台的强制基础样式）、`STYLE_PRESETS.md`、`animation-patterns.md`、`bold-template-pack/`（**34 套设计系统** + `selection-index.json`） | 「固定 16:9 舞台」的规范与实现；**反 AI-slop 的设计规范**（字体/配色/动效/背景四原则）可直接转成我们的 prompt 与评审口径；34 套设计系统做可选主题 | Google Fonts CDN 依赖需替换；`bold-template-pack` 是"设计说明书 + 片段"，接入需改写 |
| `op7418/guizang-ppt-skill` | **AGPL-3.0** | 杂志/Swiss-grid 排版取向 | **只借鉴理念，不并入代码** | ⚠️ 网络服务型 copyleft：并入会污染本项目授权（平台对外提供 Web 服务即触发） |
| `iuiaoin/agent-skills` 的 `deck` | 见仓库 | 两阶段 `--plan`/`--generate` + 10 主题 + **`--export pptx`** | 若将来要 pptx 交付，参考其导出路径 | pptx 导出与自由布局天然冲突（只能截图式导出） |
| Anthropic 官方 `theme-factory` / `web-artifacts-builder` | **Apache-2.0** | 10 套主题；React+Tailwind+shadcn 构建链 | `theme-factory` 的主题集可作 token 参考 | `web-artifacts-builder` 需要 npm 构建链，与"iframe srcdoc 自包含"路线冲突；官方 `pptx` skill 是 **source-available 非开源**，不可用于生产 |
| `lainshao/modern-ppt`、`bluedusk/html-slides`、`OrangeViolin/presentation-skill`、`make-slide` | MIT 等 | 12 布局/3 主题；17 主题；62 品牌风格；10 主题 | 备选主题来源 | 品牌风格库（Apple/Stripe/Ferrari…）有商标与合规风险，不建议用于教学平台 |

**结论**：以 `html-ppt-skill`（MIT）为主要资产来源，`frontend-slides`（MIT）补固定舞台规范与设计原则，
`guizang` 只借理念。两者加起来**不到 200KB 未压缩**，全部可内联进 `srcdoc`，不需要新增部署面
（沿现有 `revealAssets.ts` 的 `?raw` / virtual 模块内联方式即可）。

### 2.1 两个值得直接吸收的工程结论

1. **固定设计画布 + 整体缩放**（两个项目一致，且都写成"不可协商"的铁律）：
   页面按 **1920×1080** 排版，用 `transform: scale(min(vw/1920, vh/1080))` 适配。
   好处：**布局可预测** —— 固定画布下"会不会溢出"是确定性的，可被程序断言；
   而现有 `deck-fit-2/3` 是"按字数猜要不要缩字号"，本质上不可保证。
2. **主题 = 纯 token 文件**（`--bg/--surface/--text-1..3/--accent/--radius/--font-*` 一套变量），
   版式片段**禁止硬编码颜色**。这使得"换主题零成本"从口号变成架构事实，也正好接上我们已有的
   "模板只管样式、换模板不用重生成"。

## 3. 目标架构：三层解耦

### 3.1 L1 内容抽象层 —— 语义页模型（本次改版的真正核心）

现状的每页是**版式导向**的（`layout + bullets/stats/compare…`），模型必须同时想"讲什么"
和"用什么版式"，结果两头都不好。改为**语义导向**：模型只表达"这一页要完成什么、由哪些内容块构成"，
版式由程序决定。

```
Page {
  intent: 'cover' | 'toc' | 'section' | 'claim' | 'contrast' | 'pillars' | 'metric'
        | 'data' | 'sequence' | 'flow' | 'hierarchy' | 'graph' | 'timeline'
        | 'definition' | 'example' | 'formula' | 'quote' | 'image' | 'checklist' | 'summary'
  title, subtitle?, kicker?
  blocks: Block[]      // 语义块，见下
  notes?: string       // 讲稿，只进 <div class="notes">
  keyPoint?: string    // 生成侧锚点，不渲染
}

Block =
  | { kind:'claim',     text }                       // 一句主张（≤40 字）
  | { kind:'evidence',  items: string[] }            // 支撑要点（≤5 条，每条 ≤20 字）
  | { kind:'metric',    items: {value,unit?,label,delta?,tone?}[] }   // 真实数字 1–4 个
  | { kind:'series',    chart:'bar'|'line'|'pie'|'radar', labels[], values[] }  // 数据图
  | { kind:'sequence',  items: {title,desc?}[] }     // 有序步骤
  | { kind:'flow',      nodes: {title,desc?,icon?,hi?}[], edges?: 'linear'|'branch' }  // 流程
  | { kind:'relation',  nodes: {id,label,group?}[], edges: {from,to,label?}[] }        // 关系图
  | { kind:'hierarchy', levels: {title, items[]}[] } // 分层/架构
  | { kind:'timeline',  points: {at,title,desc?}[] } // 时间轴/路线图
  | { kind:'compare',   left:{title,items[]}, right:{title,items[]} }
  | { kind:'table',     head: string[], rows: string[][] }
  | { kind:'definition',term, body }
  | { kind:'code',      lang, content, caption? }
  | { kind:'formula',   tex, caption? }
  | { kind:'quote',     text, cite? }
  | { kind:'image',     fileId, caption?, role:'hero'|'full'|'inline'|'grid' }
  | { kind:'checklist', items: {text, done?}[] }
```

要点：
- **`intent` 与 `blocks` 分离**：`intent` 表达教学意图（对比/演化/证据链），`blocks` 表达内容形态；
  渲染器做 `intent × blocks → 版式组件` 的映射，不匹配时按 blocks 兜底（未知块 → `evidence`）。
- **图示不再靠模型手写图形**：模型只给 `relation/sequence/timeline/series` 这类**结构数据**，
  图形由版式组件画（纯 CSS/SVG）—— 这是"要有图示能力"和"模型写不出好看 SVG"之间的正解。
- **数字真实性**：`metric`/`series` 沿用现有"必须来自正文真实数字"的约束（现有 prompt 已有此规则）。
- **生成侧改造**：仍两阶段（大纲 → 分批扩写），但大纲输出 `intent + blocks 骨架 + keyPoint`，
  扩写填充块内容；`postProcessSlides` 的"形状校验"升级为**块级预算校验**（见 §3.4）。
- **`schemaVersion`**：新模型需要版本号，老 deck 继续走旧渲染器（双渲染器并存，见 §4）。

### 3.2 L2 版式层 —— 语义块 → 版式映射

直接对齐 `html-ppt-skill` 的 37 个单页版式（MIT，可 vendored），缺口最小、风格成体系：

| intent / block | 采用版式（vendored） | 说明 |
|---|---|---|
| `cover` / `section` / `toc` / `summary` | `cover` / `section-divider` / `toc` / `cta`·`thanks` | 开场、分节、脉络、收尾 |
| `claim` + `evidence` | `bullets` / `two-column` / `three-column` | 一页一主张，证据卡 |
| `contrast` | `comparison` / `pros-cons` | 双栏列标题 |
| `pillars` | `three-column` | 三支柱 |
| `metric` | `stat-highlight` / `kpi-grid` | 大数字 / KPI 行（含增减色） |
| `data` | `chart-bar` / `chart-line` / `chart-pie` / `chart-radar` | 需内联图表库，见 §5 |
| `sequence` | `process-steps` / `todo-checklist` | 有序步骤 |
| `flow` | `flow-diagram` | 节点 + 箭头 + 高亮节点（**纯 CSS** `[已核实]`） |
| `hierarchy` | `arch-diagram` | 三层架构网格 |
| `relation` | `mindmap` | 知识关系（纯 CSS/HTML） |
| `timeline` | `timeline` / `roadmap` / `gantt` | 时间轴（**纯 CSS** `[已核实]`） |
| `table` | `table` | 数据表 |
| `example` | `code` / `diff` / `terminal` | highlight.js 平台已有依赖 |
| `formula` | **新增**（KaTeX） | 平台已有 `katex` 依赖，需内联 CSS/字体 |
| `quote` | `big-quote` | 全幅引文 |
| `image` | `image-hero`/`image-full-bleed`/`image-grid`/`image-text-split`/`image-single` | 复用现有 `file:<fileId>` 机制 |

现有 16 版式与上表的映射关系：`bullets/steps/stat/compare/code/quote/two-col` 有对应；
`agenda → toc`、`image-*` 保留现有实现（已对接文件库），`cover/section/end` 换成新版式。
**不做**的事：不让模型自由写 HTML/CSS（原因见 §3.5）。

### 3.3 L3 主题层 —— token 体系

- 用 `base.css` 的 token 变量表替换现有 `TemplateDesign`（主色/字体栈/圆角/疏密…），
  `designToCss` 从"吐几条规则"升级为"吐一份 token 覆盖"—— **调参面反而更大**（背景分层/边框/语义色/阴影/渐变）。
- 内置主题：现有 5 套名号（平台蓝/南大紫/学术白/深色高对比/极简黑白）**映射到新 token**（避免教师侧概念断裂），
  另从 36 套里挑 **4–6 套**增量内置（建议：`academic-paper`、`editorial-serif`、`swiss-grid`、`catppuccin-mocha`、`tokyo-night`、`xiaohongshu-white`）——
  教学/学术场景优先。
- 字体：**不依赖 Google Fonts CDN**（沙箱、离线、内网、隐私都不合适）。方案见 §5 第 2 条。

### 3.4 承载与溢出：固定舞台取代"估算缩档"

- 每页内容排在 **1920×1080** 固定画布内，整体 `scale` 适配 —— 替换 `slideWeight → deck-fit-2/3`。
- 溢出改为**可断言的硬约束**：生成后测量每页内容高度，`> 1080` 即判为溢出（可自动分流：
  缩至下一档字号 → 拆页 → 标记 warning 供教师重生成）。测点在浏览器（`verify-slides.mjs`）。
- 块级预算（写进 prompt + 校验）：`claim ≤40 字`、`evidence ≤5 条×20 字`、`metric ≤4 个`、
  `sequence/flow ≤5 节点`、`table ≤6 行`、`code ≤20 行` —— 固定画布下这些是**可计算**的。
- `[待实测]` reveal.js 对 `section` 自己施加 transform（过渡用），内层再套固定画布 + scale 是否冲突；
  P0 必须验证「reveal 内嵌固定舞台」与「换用 vendor runtime.js」两条路的观感与体量。

### 3.5 安全边界 —— 为什么不是"让模型直接写 HTML"

- 我们**不采纳**"LLM 直接产完整 HTML/CSS deck"：一旦自由 HTML/CSS 进来，
  `markdown.ts` 的 Markdown 白名单清理要扩成 HTML+CSS 白名单（含 `style`/`svg`/`foreignObject`/外链），
  安全面成倍放大，且观感一致性（D7）靠 prompt 自律。
- 语义块路线下，**注入面与今天相同**：内容仍是我们自己序列化的文本，走 `escapeHtml` + 现有清理；
  `relation/sequence` 等图示由我们自己的组件渲染，模型碰不到标签。
- 保留"自由页"作为**逃生舱（v2 可选）**：若确需，则以独立 `layout:'free'` + 严格白名单（禁 `script`/`on*`/外链、
  `svg` 白名单标签、`style` 只允许 token 变量）在现有 opaque-origin 沙箱内渲染；
  `sandbox="allow-scripts"`（不给 `allow-same-origin`）这一条不放松。
- 图表库/KaTeX 等第三方脚本**只内联、不引 CDN**，且与内容分离（内容永远进不了 `<script>`）。

### 3.6 编辑面收窄（按用户意见）

"没人想手动改字" ⇒ 教师侧不再以"MD/JSON 双视图编辑"为中心，改为四条**零 token 或单页 token** 的操作：

1. **换主题**（零 token，样式与内容解耦）；
2. **换版式**（同一页换 intent 渲染，零 token）；
3. **重生成单页 / 重写单个块**（一次调用，已有能力）；
4. **整章重新生成**（已有能力，`sourceHash` 缓存 + 跟随章节变更提示不变）。

MD 视图**降级为只读预览 + 应急文本修正**（保留 `toMarkdown`/`parseMarkdown` 以避免能力倒退，
但不再承诺它能表达新模型的全部字段）。JSON 视图保留为高级入口（教师/运维排障）。

## 4. 与现有实现的差异（文件级改造清单）

| 层 | 文件 | 改动 |
|---|---|---|
| schema | `server/src/slides/deck.schema.ts` | 新增语义 `Page/Block` 模型与校验（块级预算）；保留旧 `SlideJson` 校验器；加 `schemaVersion` |
| 生成 | `server/src/slides/slides.generator.ts` | 两阶段 prompt 重写（大纲出 `intent+blocks 骨架`、扩写出块内容）；`LAYOUT_HINT` → `INTENT_HINT`；mock 生成器同步产出语义页；分流"旧容器页 shape" |
| 生成 | `server/src/slides/slides.config.ts` | **`SLIDES_PROMPT_VERSION` +1**（否则同 hash 命中旧缓存） |
| 存储 | `server/src/slides/slide-deck.entity.ts` / 迁移 | 存 `schemaVersion`（JSON 列，加字段即可，**无需新表**） |
| 服务 | `server/src/slides/slides.service.ts` | 按 `schemaVersion` 选择渲染契约；单页/单块重生成走新模型 |
| 投影 | `server/src/slides/deck-markdown.ts` | 新模型的 MD 投影与解析（块 → 语法），保持"确定性 + 失败带行号"两条既有保证 |
| 渲染 | `web/src/slides/renderDeck.ts` | 新渲染器：`intent × blocks → 版式片段`；固定 1920×1080 舞台；token 主题编译 |
| 渲染 | `web/src/slides/theme-tokens.ts`（新） | token 校验与编译（窄字符集/枚举，替代 `designToCss` 直吐规则） |
| 资产 | `web/src/slides/vendor/html-ppt/**`（新） | vendored MIT 资产（base.css / themes / layouts / runtime）+ `LICENSE` 与来源说明 |
| 模板 | `server/src/slides/template.schema.ts` | 调参面映射到 token；内置 5 套 + 新增 4–6 套 |
| 工具 | `web/tools/assert-render.mjs` | 断言块 → 版式映射、token 无硬编码色、固定舞台尺寸 |
| 工具 | `web/tools/verify-slides.mjs` | 新增"每页内容高度 ≤1080、无重叠"实测断言 |
| 工具 | `web/tools/review-decks.mjs` | 截图基线改为 1920×1080 固定舞台（截图更稳定，便于逐轮对比） |

## 5. 关键工程风险与待实测项

1. **reveal.js 与新舞台的耦合** `[待实测]` — reveal 自身用 transform 做过渡/居中，内层固定画布是否被干扰；
   另一条路是用 vendor `runtime.js`（47KB）替掉 reveal（119KB + CSS 54KB），体积更小但要自研过渡/概览。
2. **中文字体** `[待实测]` — 不引 CDN 的前提下的取舍：系统字体栈（`PingFang SC`/`HarmonyOS Sans`/`Source Han Sans`
   优先，跨平台差异可接受）**或**自托管 woff2 子集（体积可控但要维护子集脚本）。历史决策是"刻意避开 564KB 内嵌字体"。
3. **图示与图表** `[待实测]` — `relation/timeline/flow/arch/mindmap` 是纯 CSS（可复用）；
   `chart-*` 需 Chart.js 内联（约 200KB min，gzip ~70KB；只在含数据页的 deck 按需内联）**或**自绘 SVG。
   倾向：P1 先只做纯 CSS 图示（覆盖用户痛点的大头），数据图留 P4。
4. **公式（KaTeX）** — 平台已有 `katex` 依赖，但要内联 CSS 且 KaTeX CSS 引用字体文件 → 需字体内联或降级为
   "公式转图片/数学字体栈"。`[待实测]`。
5. **一致性与反 AI-slop** — 靠"单一设计系统 + 禁硬编码色 + prompt 反模式清单"（可参考 `frontend-slides`
   的 Design Aesthetics 与 `html-ppt-skill` 的 "What to NOT do"）保障，而不是靠模型审美。
6. **老 deck 兼容** — `schemaVersion` + 双渲染器并存；教师已有 deck 不强制重生成（沿用"跟随章节变更提示"）。
7. **图像与安全** — 内容中出现的 `<script>`/事件属性/外链一律不入渲染；`svg` 只在"我们自己的组件"里出现，
   模型提供的只是数据。
8. **许可合规** — vendored 目录必须有 `LICENSE` + 来源与版本记录；**AGPL 项目（guizang）代码不得并入**。

## 6. 分期与验收

| 阶段 | 内容 | 出口判据 |
|---|---|---|
| **P0 样张实验**（0.5–1 天）✅ **已完成，见 §9** | vendored 资产落 `web/src/slides/vendor/`；手写 6–8 页语义 JSON（cover/toc/claim/contrast/timeline/relation/metric），跑通固定舞台渲染 + 3 套主题；顺带验证 reveal 耦合与字体方案 | 出 1920×1080 截图，与现有 deck 并排；D5/D7 盲评 ≥ 现在 |
| **P1 渲染层**（2–4 天） | 语义块 → 版式映射（含纯 CSS 图示）；token 主题编译；固定舞台 + 溢出实测；`assert-render`/`verify-slides` 断言 | 断言全绿；同一份语义 JSON 换主题/换版式零 token |
| **P2 生成层**（2–3 天） | 两阶段 prompt 改造（intent/blocks）；块级预算校验；mock 同步；`SLIDES_PROMPT_VERSION +1`；`review-decks` 出素材盲评 | 真实章节端到端；D5/D7 目标 5 分；零 warning |
| **P3 教师/学生端**（2–3 天） | 教师：换主题/换版式/重生成单页；MD 视图降级为只读+应急；学生端只读放映 | 交互回归（浏览器断言）全绿 |
| **P4 增强**（按需） | 数据图表（Chart.js 内联或 SVG 自绘）、KaTeX 公式、PDF 导出（Chromium 本机已具备）、自由页逃生舱 | 逐项单独验收；**pptx 导出仍不做**（自由布局与 pptx 不可调和） |

**验收口径扩展**（`docs/REVIEW-slides-rubric.md`）：保留 D1–D7，新增
**D8 图示有效性**（关系/流程/数据是否真用图示表达，而非文字堆砌）与
**D9 固定画布零裁切**（自动断言，非人工评分）。总目标：D5/D7 从 4 提到 5。

## 7. 成本与工作量粗估

- 资产引入 + 许可整理：0.5 天（体积 <200KB，内联，无部署面变化）。
- 渲染层重写：2–4 天（新渲染器 + 舞台 + token，`renderDeck.ts` 现约 21KB）。
- 生成层改造：2–3 天（prompt 与校验是主体，两阶段框架可复用）。
- 教师/学生端：2–3 天。
- 端到端回归与盲评：1–2 天。
- **合计约 1.5–2 周**（单人），其中 P0 样张决定是否继续，越早越好。

## 8. 待决策项

1. **承载**：v1 保留 reveal.js（改动小）还是换用 vendor `runtime.js`（体积更小、更自由）？—— 建议 P0 两条路各出一页样张再定。
2. **主题集**：新增内置哪 4–6 套？（建议 academic/editorial/swiss/mocha/tokyo-night/xhs-white 中选）。
3. **字体**：系统字体栈 vs 自托管 woff2 子集（影响中文观感一致性）。
4. **P0 样张章节**：用生产库哪一章做对照（建议取篇幅中等、含流程/对比各一处的一章）。
5. **图表与公式**：P1 是否一并做，还是先纯 CSS 图示、数据图/公式推迟到 P4。


---

## 9. P0 落地记录（2026-10-10，已实测）

### 9.1 交付物（文件级）

| 文件 | 作用 |
|---|---|
| `web/src/slides/vendor/html-ppt/{LICENSE,NOTICE.md,base.css,themes/*.css}` | vendored 设计系统资产（MIT，来源与改动见 NOTICE） |
| `web/src/slides/semantic/types.ts` | **语义页模型**（17 个 intent + 13 种 block），取代"版式枚举" |
| `web/src/slides/semantic/theme.ts` | 8 套 token 主题（5 套沿用平台历史 id/主色 + 3 套 vendored）；系统字体栈，**零 CDN** |
| `web/src/slides/semantic/layouts.css` | 版式层（`ly-` 命名空间，16 个版式；颜色全部走 token） |
| `web/src/slides/semantic/render.ts` | `Page` → HTML（intent 决定版式；块兜底；全量转义） |
| `web/src/slides/semantic/stage.ts` | 固定 1920×1080 舞台 + 自研运行时（缩放/翻页/postMessage **契约与旧渲染器一致**） |
| `web/tools/fixtures/chapter4-deck.ts` | 13 页样张（第 4 章注意力实验，**数字全部来自真实实验记录**） |
| `web/tools/preview-semantic.mjs` | 样张截图（多主题/指定页；产物落 `web/tools/shots/`，已 gitignore） |
| `web/tools/assert-semantic.mjs` | 渲染层断言 **32 项**（结构/映射/转义/主题解耦/颜色纪律） |

### 9.2 实测结果

- **样张 13 页 × 3 主题**（平台蓝 / 学术白 / 深色高对比）逐页截图：观感明显优于旧渲染器
  （固定 16:9 画布、眉题-标题-导语的字号阶梯、卡片/网格体系、渐变装饰、页码与页脚齐备）；
  **同一份语义 JSON 换主题，DOM 逐字节不变**（断言已固化）——"换主题零成本"从口号变成事实。
- **渲染层断言 32/32 通过**：`node web/tools/assert-semantic.mjs`。
- **未破坏现有应用**：`npx tsc --noEmit` 与 `npm run build` 均通过（新渲染层尚未接入应用代码路径）。
- **承载决策（原 §8 待决项 1）**：P0 采用**自研运行时**而非 reveal —— 固定画布 + `transform: scale`
  与 reveal 自身的 transform/居中机制天然冲突（这正是原计划里 `[待实测]` 的那条），
  而自研运行时仅数十行、与 `SlideStage` 的 postMessage 契约完全一致（`boot/ready/slidechanged/exit-present`
  + `next/prev/goto`），换渲染器不需要改 `SlideStage`。
- **字体决策（原 §8 待决项 3）**：走**系统字体栈**（`PingFang SC`/`Source Han Sans`/`Noto Sans CJK SC`…，
  衬线用 `Source Han Serif`/`Noto Serif CJK SC`），零 CDN、零体积；学术白主题的中文衬线效果已验证可接受。

### 9.3 P0 抓到的两个真 bug（都值得写进规范）

1. **类名撞车**：关系图中心节点原本用 `class="... center"`，撞上 vendored `base.css` 的
   工具类 `.center{display:flex}` → 中心卡里的标题与说明被压成左右两列（截图 p04 一眼可见）。
   修法：改用自有 `ly-rel-center`，并**加断言**"中心节点不得带 `.center`"。
   教训：**沿用第三方 CSS 时，自有类名要带前缀**，否则会被对方的工具类静默命中。
2. **代码高亮的替换顺序**：先插 `<span class="cm">` 再跑关键字替换 → 插入片段里的 `class` 被当成关键字
   二次染色，**输出 `class="kw">class</span>="cm">…` 这种破属性**。修法：先按行切分注释、再做关键字着色。
   教训：字符串 → HTML 的多次替换必须保证"后一步不重扫前一步插入的标记"。

### 9.4 下一步（P1 入口，尚未开工）

1. **`SlideJson → Page` 适配器**：让平台里**现有 deck 零生成成本**地换上新渲染器（观感立即可得），
   同时为生成侧改造留出迁移期；
2. **`SlideStage` 切换**：新渲染器与旧渲染器并存，按 `schemaVersion` 分流；契约不变则 `SlideStage` 不动；
3. **生成侧改造**（P2）：两阶段 prompt 改为输出 `intent + blocks`，块级预算校验，
   `SLIDES_PROMPT_VERSION` +1（否则同 hash 命中旧缓存）；
4. **老断言迁移**：`verify-slides.mjs`（11 项，基于 reveal DOM）与 `assert-render.mjs`（27 项）
   需要按新渲染器改写，并新增"每页内容高度 ≤ 1080、无重叠"的溢出实测断言。


---

## 10. P1 落地记录：把新渲染层接进平台（2026-10-10，已实测）

### 10.1 交付物

| 文件 | 作用 |
|---|---|
| `web/src/slides/semantic/legacy.ts` | **旧 `SlideJson` → 语义 `Page` 适配器**（16 版式全映射，有损但**不丢内容**）+ `designToTokenOverrides`（旧模板调参 → token） |
| `web/src/slides/SlideStage.tsx` | 双渲染器：`renderer='semantic'**（默认）** \| 'reveal'`；新增 `slideTheme` / `meta` 两个 prop；新版渲染器走**动态 import**（不进主包） |
| `web/src/slides/semantic/{stage,render,theme}.ts`、`layouts.css` | 支持主题 token 覆盖、页脚文案、页脚 logo；图片版式扩展 `full`（大图不裁切）/`grid`（多图）/**占位**（拿不到图不留白、不发外部请求） |
| `web/src/pages/teacher/ChapterSlides.tsx`、`web/src/pages/student/ChapterRead.tsx` | 调用点传入 `slideTheme`（模板 id + 课程自定义 design）与 `meta`（章节名） |
| `web/tools/fixtures/legacy-deck.ts` | 旧模型测试集（**覆盖全部 16 种旧版式**，用第 16 章记忆系统的真实口径） |

**默认即生效**：教师端与学生端现在都用新渲染器；`VITE_SLIDES_RENDERER=reveal` 可一键回退旧渲染器
（旧代码路径完整保留，未删除）。

### 10.2 为什么 `verify-slides.mjs`（11 项浏览器断言）不用改

它的断言刻意**全部走 postMessage 契约**（页码从 `message` 事件读、点击/键盘/Esc 作用于父窗口 UI），
注释里写明了原因——"演示 iframe 是 opaque origin，读不到它的 DOM"。新运行时复刻了同一套
`boot/ready/slidechanged/exit-present` 与 `next/prev/goto` 契约，因此这些断言对两条渲染路径同样成立。
（真实环境复跑仍建议做一次，作为切换后的验收。）

### 10.3 实测结果

- `web/tools/assert-semantic.mjs` **44/44 通过**（新增 12 条适配器断言：映射/不丢页/不丢数字/不丢讲稿/
  Markdown 降级/多图网格/图片占位/调参 token 生效）。
- `npx tsc --noEmit`、`npm run build` 通过。
- **主包未变大**：`index` 701.5KB（切换前 700.7KB），新渲染层与 vendor 主题 CSS 被拆成
  `stage-*.js` + `legacy-*.js`（合计 60KB）**按需加载**。
- 适配器出图验证：旧 deck（16 版式测试集）经 `--source=legacy` 渲染，`bullets/steps/stat/compare/
  code/image-*` 全部落到新观感上；图片拿不到时按"占位块 + 图注"呈现。

### 10.4 适配器的三处**有损**（明确记录，避免误判为 bug）

1. `two-col` 的两段 Markdown 片段降级为**纯文本**（新模型没有"自由 Markdown 两栏"这种块；
   需要时应在生成侧改出 `pillars/contrast` 语义）；
2. 旧模型没有语义可依的图示（`relation/flow/arch/timeline`）**不臆造** —— 适配器只做保守映射，
   这些版式要靠生成侧直接产语义块（P2）才会出现；
3. 旧调参里的 `density` / `cardStyle` / `fontScale` 三项**暂未映射**（新版的疏密与卡片风格应改为
   token 化的 scale 变量，属 P2）；页级 `attrs.background`（背景图）暂未实现。

### 10.5 下一步（P2）

1. **生成侧改造**：两阶段 prompt 改为直接输出 `intent + blocks`（大纲出骨架、扩写出块内容），
   块级预算校验（claim ≤40 字 / evidence ≤5×20 / metric ≤4 / relation ≤7 节点…），
   `SLIDES_PROMPT_VERSION` **+1**（否则同 hash 命中旧缓存）；
2. `postProcessSlides` 从"形状校验"升级为**块级预算校验**；mock 生成器同步产语义页；
3. 教师端把"MD/JSON 双视图"降级为只读预览 + 应急修正，主操作改为「换主题 / 换版式 / 重生成单页」；
4. 溢出实测断言（每页内容高度 ≤1080、无重叠）纳入 `verify-slides.mjs`。


---

## 11. P2 前置验证：语义 prompt 端到端跑通（2026-10-10，已实测）

> 结论：**生成侧改造方向已验证可行**。先用真实模型离线跑通（不碰 server、不碰生产库），
> 再决定是否把 prompt 搬进 `slides.generator.ts`（那一步会改变教师端生成结果，需单独确认）。

### 11.1 工具

`web/tools/gen-semantic-deck.mjs` —— 章节正文 →（两阶段 LLM）→ 语义 deck → 渲染截图：

```
node web/tools/gen-semantic-deck.mjs [--source=server/fixtures/<某实验>/README.md] [--reuse]
```

- 阶段一（大纲）：产出 `intent + title + lede + keyPoint + plan` 的**页面计划**；
- 阶段二（扩写）：4 页一批填 `blocks`（含讲稿 `notes`），缺内容用骨架兜底 → **页数/页序永不漂移**；
- `--reuse` 复用上次落盘的 `deck.json`：调 prompt 时反复重跑**不再花模型钱**。

### 11.2 实测（素材：`server/fixtures/attention-ablation/README.md`，6.9k 字符）

- **19 页 / 11 种 intent**：`cover → toc → section → claim → table → section → sequence → pillars(relation)
  → contrast → flow → section → contrast → metric → section → metric → sequence → example → pillars → summary`；
- 出现了**旧模型给不出的图示页**：`relation`（Q/K/V 与注意力权重的关系图，中心 + 卫星 + 曲线）、
  `flow`（X → Q/K/V → QKᵀ → ÷√d → 掩码 → softmax 的管线）、`table`（三档消融 × 两个 case 的完整数值表）；
- 内容保真：数字全部来自正文（0.2761/0.4329、2.2074/1.7238、0.4725、0.3149/0.5296…），
  讲稿是成段的课堂口播稿而非要点重述；
- 成本：一次完整两阶段约 **27k prompt tokens + 10k completion tokens**，5 批各 7–10 秒（deepseek-flash）。

### 11.3 这轮抓到的两个问题（都已修 + 加断言）

1. **模型输出的 JSON 不总是合法**：字符串内部出现未转义的英文双引号（中文语料里高频），
   `notes` 偶被写成字符串数组 → 解析直接失败。
   修法：`parseLooseJson`（逐字符扫描，字符串内"看起来像内容引号"的补转义）+ prompt 明确
   "内部引号用「」、notes 是单个字符串"。**server 侧落地必须带同样兜底**（`slides.generator.ts`
   已有 `parseJsonLoose` / `salvageTruncatedJson` 的先例）。
2. **渲染层会静默丢块**（真缺陷）：模型偶尔给出 intent 与块不匹配的组合（实测 `contrast` 页多带一张
   `table`、`pillars` 页用 `relation` 表达），原实现按 intent 只渲染匹配的块，**其余块被悄悄丢掉** ——
   表格、代码、图整块消失。
   修法：渲染层引入 `CONSUMED`（每种 intent 主渲染吃掉的块类型）+ **兜底渲染**剩余块；
   并加 3 条断言（多带的 table/note 照常出现、`pillars` 配 `relation` 仍出关系图）。
   同时在 prompt 里写死「intent ↔ blocks 对应表」降低发生概率。**渲染层永远兜底，不依赖 prompt 自觉。**

### 11.4 观察：图示页取决于素材结构

同一套 prompt，实验说明类素材（`attention-ablation/README.md`）出的是 `relation`/`flow`；
时间线（`timeline`）与分层架构（`arch`）没有出现 —— 因为该素材本身没有"阶段演化""层 × 组件"的叙述。
**这不是 prompt 失效**：选型规则明确要求"确有相应结构才用"，硬凑反而会做出与内容不符的页。

### 11.5 P2b 落地清单（尚未执行，需要先确认）

| 步骤 | 内容 | 风险 |
|---|---|---|
| 1 | `server/src/slides` 新增语义 schema + 校验（与前端 `semantic/types.ts` 对齐），`slides` 列加 `schemaVersion` | 低（纯增量） |
| 2 | prompt 搬进 `slides.generator.ts`（两阶段改为产 `intent + blocks`），**`SLIDES_PROMPT_VERSION` +1** | **中：改变教师端生成结果** |
| 3 | 前端 `SlideStage` 按 `schemaVersion` 直接渲染 `Page[]`（不再走适配器） | 低 |
| 4 | MD 投影（`deck-markdown.ts`）适配新模型，或按"编辑面收窄"降级为只读预览 | 中 |
| 5 | mock 生成器同步产语义页；`review-decks.mjs` 跑一轮真实盲评（对比新旧 prompt） | 低 + 少量模型成本 |
