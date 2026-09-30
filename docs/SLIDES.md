# 章节在线幻灯片（Slides）功能指南

> 平台的章节幻灯片功能：教师按章节用 LLM 一键生成在线演示（reveal.js），可改内容、换模板、全屏放映；
> 学生在章节页随时切换「文档 ⇄ 幻灯片」。
> 本文是**功能与原理的活文档**（随实现更新）。设计决策与踩坑见
> `docs/DESIGN-2026-09-29-chapter-slides.md`（含 §16 效果优化实录），
> 效果评分记录见 `docs/REVIEW-slides-rubric.md`，运行态见 `HANDOFF.md` §9。

## 1. 它能做什么

- **一键生成**：以章节正文（Markdown）为素材，LLM 自动组织分节、挑选版式，产出 6–20 页演示稿；
- **单页重生成**：个别页不满意可只重写那一页（同步一次 LLM 调用，其余页与手工编辑不动）；
- **双视图编辑**：JSON 视图精修、Markdown 视图改写，改完即时预览、保存即生效（不花 token）；
- **图片能力**：教师个人图片库（上传/复用，跨课程）+ 图片选择器插入/换图 + 5 种图片版式；
  章节正文可从图片库选图/上传插入（支持多选），正文有图时 LLM 生成会自动选用图片版式（只引用正文出现过的图）；
- **模板系统**：5 套内置模板（平台蓝/南大紫/学术白/深色高对比/极简黑白）+ 课程级自定义（可视化调参）；
- **在线放映**：全屏、键盘/鼠标翻页、页码进度、讲者备注（notes 是可照读的讲稿）、跨章节不退出切换；
- **跟随章节**：正文改了会提示「章节内容已变更」，教师决定重新生成或保留（绝不自动重新生成）。

## 2. 生成流程（核心原理）

素材不是专门为幻灯片写的内容，而是**章节本身的 Markdown 正文**（`Chapter.content`）。
生成分**两阶段**（一次吐 20 页完整 JSON 极易被 token 上限截断，拆开单次请求小、失败可局部降级）：

```
① 素材：章节正文（>30 万字截断，SLIDES_SOURCE_MAX_CHARS；2026-09-30 起随模型 500K token 上下文放开）
        │  教师手动点「生成」（绝不自动生成；sourceHash 命中缓存直接复用）
        ▼
② 阶段一：LLM 出大纲
   · 组织：通读正文 → 梳理 2–4 个分节 → 规划页序
     （封面 → agenda 目录 → 分节页 → 内容页 → 小结）
   · 选型：给每页定 layout（按内容类型，见 §3 选型规则）
   · 锚点：给每页写 keyPoint（“本页要让学员记住什么”，只给扩写看）
        ▼
③ 阶段二：LLM 分批扩写（4 页/批）
   大纲 + 原文回传，逐页补全：
   · bullets → 电报体成稿（≤20 字/条、3–5 条/页，禁止照抄整句）
   · stat/compare → 结构化字段（真实数字、两栏清单）
   · notes → 讲稿（3–6 句、有过渡语、信息量比页面大）
   · cover 不写 bullets；section 给 2–3 条「本节导览」要点（纯关键词 ≤12 字、点名本节
     主题词，禁冒号补充结构，deck-teaser 弱化渲染；承接与过渡仍进 notes）
   约束：layout/title/keyPoint 不许改、页序不许变
        ▼
④ 程序化质检（不靠模型自觉）
   · 逐页形状校验（不合法只丢该页、大纲骨架兜底）
   · 分节导览条数硬闸 ≤SLIDES_SECTION_TEASER_MAX(3)（扩写管线内，整份/单页同口径）
   · postProcessSlides：标题≤30/要点≤60 截断、页内去重、
     标题高相似页合并（bigram Jaccard≥0.7）、
     分节页眉题强制顺序编号「第 N 节」（结构信息不靠模型编）
        ▼
⑤ 落库：SlideDeck.slides（JSON 唯一真源）+ markdown 投影 + 章节哈希
        ▼
⑥ 渲染：SlideJson → 自包含 reveal.js 文档（iframe srcdoc 隔离）
   · 按 layout 渲染版式；内容超重 → deck-fit-2/3 自动缩档（防底部裁切）
   · 模板只管样式：调参 → designToCss 编译 CSS —— 换模板不用重新生成
```

**健壮性**（都是实测踩过的坑）：deepseek-flash/v4-pro 是推理模型，`max_tokens` 与推理共用
（已带 `reasoning_effort=low`）；JSON 截断有抢救（回退最后完整对象补齐括号）；
大纲/扩写失败各自动重试一次；缺页用大纲骨架补齐，不整份失败。
模型会把 prompt 里的完整 schema 抄成空壳占位（`"compare": {"left": [], "right": []}` 挂在无关页、
`"image": null` 等，2026-09-30 实测一批 6 页被误杀）：校验层对**非 compare 页的空 compare 宽容丢弃**；
扩写页其他结构化字段缺失时**先降级为要点页**（保住模型写好的 bullets/notes），救不回才退大纲骨架。

## 3. 版式（16 种 layout + kicker 眉题）

| layout | 用途 | 内容形态 |
|---|---|---|
| `cover` | 封面（仅首页） | kicker 眉题 + 标题 + 副标题 |
| `agenda` | 目录/本章脉络（通常第 2 页） | 编号条目（bullets 承载） |
| `section` | 分节标题页 | kicker「第 N 节」（质检统一编号）+ 标题 + 2–3 条「本节导览」关键词（deck-teaser 弱化样式，与正文要点区分） |
| `bullets` | 要点页（最常用） | 3–5 条电报体要点，卡片化 |
| `steps` | 有序步骤/流程 | 序号圆点 + 连接线（bullets 承载） |
| `stat` | 大数字（1–4 个） | `{value, label, detail?}`，value 必须正文真实数字 |
| `compare` | 左右对比 | `{leftTitle, rightTitle, left[], right[]}` 双栏清单卡片 |
| `two-col` | 两栏自由文本 | left/right 两段 Markdown |
| `code` | 代码页 | `{lang, content}` ≤20 行 |
| `quote` | 引文/关键结论 | `{text, cite?}` |
| `image` | 单图页（暂限平台内文件） | `file:<fileId>` 引用 + 可选图注 |
| `image-full` | 全幅大图页 | 一张图撑满整页（contain 不裁切） |
| `image-left` | 左图右文页 | 图 + bullets 要点（图不可空，要点可空） |
| `image-right` | 右图左文页 | 同上，图在右侧 |
| `image-grid` | 多图网格页（1–4 张） | `images: [{url, caption?}]`，2 张两列 / 3 张三列 / 4 张 2×2 |
| `end` | 小结/结尾（仅末页） | 标题 + 要点 |

**生成侧的选型规则**（写在大纲 prompt 里，模型按此挑选）：一般要点 bullets；有先后顺序 steps；
正文有 1–4 个有说服力的数字 stat；成对对比 compare（优先于 two-col）；示例 code；点睛结论 quote。
**图片版式是条件放行**：正文含 `file:` 插图时（清单随 prompt 下发，fileId 与图注），模型可为讲图的页
选 image 系版式（一份 deck ≤3 页，url 只能照抄清单，服务端另有防幻觉闸，清单外引用直接丢该页走
大纲骨架兜底）；正文没有图时维持「不生成 image 页」。教师也可随时用「插入图片页 / 换图」手动插图。

## 4. JSON 与 Markdown 的关系（真源与投影）

可以直接改 Markdown，不会丢东西。**JSON 是唯一真源，Markdown 是 JSON 的可读投影**：

```
JSON（SlideDeck.slides，真源）
  │  toMarkdown()   确定性投影（每页带 <!-- .slide: layout=xxx --> 指令）
  ▼
Markdown（教师编辑视图）
  │  保存
  ▼
parseMarkdown()  严格解析（语法错误带行号报错，不静默丢）
  + mergeMarkdown()  按页位次合并：MD 表达不了的字段从旧 deck 捡回
  ▼
normalizeSlides() 统一校验 → 落库，即时生效（零 token）
```

**MD 视图能写**（刻意保持小的子集）：`# 标题`、`## 副标题`、`- 要点`、编号列表（agenda/steps）、
`- **数字** 标签：说明`（stat）、`**列标题**` + `<!-- .col -->`（compare/two-col）、围栏代码块、
`> 引用`、`![caption](file:...)`（image/image-full/image-left/image-right 单图行；
image-grid 把多张图写成多行、≤4 张）、`<!-- .notes: 讲者备注 -->`、`<!-- .slide: layout=xxx kicker="..." -->`、`---` 分页。

**MD 视图改不了**：页级高级设置（`attrs.background/transition/className`）——只在 JSON 视图改；
MD 保存时按位次合并保留，不会被悄悄覆盖。

三条硬保证：
1. JSON → MD **确定性**，切视图本身不改变任何内容（全版式往返实测逐字段相等）；
2. 解析失败**不静默**：返回 400 并带「第几行（第几页）：什么原因」；
3. 保存即生效、**不花 token**（渲染是数据驱动的；调 LLM 只在手动「重新生成」时发生）。

## 5. 模板系统

- **内置 5 套**：平台蓝（默认）/ 南大紫 / 学术白 / 深色高对比 / 极简黑白；
  基于 reveal 轻量主题派生（刻意避开内嵌 564KB 字体的 black 系）。
- **可视化调参**（教师端「模板调参」抽屉，不开放自由 CSS）：主色/背景/文字/强调色、字体栈、
  圆角、疏密、**字号阶梯 fontScale**（小字 32px / 标准 38px / 大字 44px）、
  **要点卡片 cardStyle**（无 / 浅色底 / 描边）、页脚文案与 logo。
- **安全边界**：调参值全部窄字符集 + 枚举校验后才编译进 CSS（`designToCss`），
  杜绝注入；内置模板不可直接改，「保存模板」会先另存为课程模板。
- **换模板零成本**：模板只提供样式，不改变 SlideJson 语义 —— 同一份 deck 换模板不需要重新生成。

## 6. 模型、成本与护栏

- **默认 `deepseek-flash`**（盲评定版：结构完整性/覆盖更好、延迟约为 v4-pro 的 1/3、成本更低；
  评分记录见 `docs/REVIEW-slides-rubric.md`）。
- 配置：`SLIDES_GENERATOR=llm|mock`、`SLIDES_MODEL`、`SLIDES_OUTLINE_MODEL` / `SLIDES_EXPAND_MODEL`
  （分级策略，如大纲 pro + 扩写 flash）、`SLIDES_LLM_REASONING_EFFORT=low`、
  `SLIDES_TITLE_MAX_CHARS=30`、`SLIDES_BULLET_MAX_CHARS=60` 等，全量见 `server/.env.example`。
- **成本量级**：单章 ≈ 20–30k tokens / 40–90 秒（flash）。护栏：每课程每小时 20 次
  （`SLIDES_GENERATE_PER_HOUR`）+ 同内容缓存（`sourceHash = sha256(正文+模型+prompt版本)`，
  命中直接复用）+ `SLIDES_MAX_TOKENS` 单次上限。
  **2026-09-30 放开 token 限制**：模型上下文支持 500K tokens，`SLIDES_MAX_TOKENS` 默认
  4000→32768（旧预算会把大纲/扩写 JSON 截断，表现为「内容没生成完就结束了」）、
  `SLIDES_SOURCE_MAX_CHARS` 默认 12000→300000、`SLIDES_LLM_TIMEOUT_MS` 默认 90s→300s；
  截断抢救与失败重试保留作兜底。
- **改 prompt 必须把 `SLIDES_PROMPT_VERSION` +1**（当前 v8：section 导览为极简关键词 ≤12 字；cover 不写），否则命中旧缓存看不到新效果。

## 7. 典型工作流

1. 教师写好章节正文 → 章节编辑页点「幻灯片」→「生成」（可顺便选模板）；
2. 等 1 分钟左右（异步生成，页面轮询状态）→ 得 6–20 页初稿；
3. 微调：MD 视图改要点/加备注，JSON 视图精修；个别页不满意点「重生成当前页」单页重写
   （同步一次 LLM 调用，计入每小时频次；该页手工修改会被覆盖）；「插入图片页」5 种版式任选
   （图片库上传/复用），
   单图页可一键「换图」，MD 视图还能「插图到光标」（给并排页补图、手动凑多图网格）；「模板调参」改观感；
4. 放映授课：全屏翻页（←/→、空格、点左右区域、Esc 退出），教师看讲稿（notes）；
5. 章节正文大改后：页面提示「章节内容已变更」→ 选「重新生成」或「保留现有 deck」。

学生侧：章节页顶部「文档 ⇄ 幻灯片」切换，只读（章节须已发布）。

## 8. 评测与回归工具（改 prompt/版式必跑）

| 工具 | 用途 |
|---|---|
| `web/tools/review-decks.mjs <标签>` | 真实生成 + 放映态逐页截图 + deck.json（盲评素材；`REVIEW_API` 可指临时实例做异模型对比，`--shots-only` 只截图） |
| `docs/REVIEW-slides-rubric.md` | 7 维评分清单与历史评分记录 |
| `web/tools/assert-render.mjs` | jsdom 渲染断言 27 项（注入清理/版式 DOM/图片版式与占位回退/防溢出缩档），毫秒级 |
| `web/tools/verify-slides.mjs` | 真实浏览器 11 项断言（翻页/控件/Esc/Spin 回归） |

渲染层改动跑 assert-render + verify-slides；prompt 改动跑 review-decks 对比评测集
（记得 `SLIDES_PROMPT_VERSION` +1）；mock 模式（`SLIDES_GENERATOR=mock`）可零成本回归版式。

## 9. 已知限制与后续项

- 个别运行缺 end 页（大纲概率事件，重新生成可解）；steps 条目偶带“第一步”冗余字样；
- 长章节分块生成未做（单次送入上限 30 万字；当前真实章节最长 3.6k 字打不到）；
- image-grid 页内逐张换图没有图形化入口（在 JSON/MD 文本里改 `file:` 引用即可）；
- LLM 配图只引用**正文里出现过的** `file:` 插图（防编造）；正文无图时不生成图片页；
- v2/v3 候选：Mermaid/公式渲染、pptx/pdf 导出、自由 CSS 模板档（见设计文档 §14 分期）。
