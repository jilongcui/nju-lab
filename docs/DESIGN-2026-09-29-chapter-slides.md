# 章节在线幻灯片（reveal.js）—— 设计方案（2026-09-29）

> 目标读者：接手实现的人。文中 `[推荐]` / `[已定]` 标记的是取舍结论，`[已实测]` 是可复现的事实。

## 0. 一句话

把每个**章节**的 Markdown 内容交给大模型，产出**结构化 JSON 幻灯片**，在平台内用 **reveal.js 在线演示**；
教师可换模板、可改模板、可改内容（Markdown / JSON 双视图），可跨章节切换放映。**v1 不做 pptx 下载。**

## 0.1 已确认的产品决策（2026-09-29，实现按此执行）

- 前期**只做在线演示**（reveal.js）；pptx 导出留到后期，不进 v1。
- **分章节生成**，一章一 deck，跟随章节内容（哈希比对提示重新生成）。
- 内容 **md / json 双视图可编辑**；**模板可选、可编辑**。
- **切换展示两边都要**：教师端可跨章节换 deck、不退出放映；学生端章节阅读页加「文档 ⇄ 幻灯片」。
- 模板"可编辑"在 v1 **只做可视化调参**（不开放自由写 CSS，留 v2）。
- 模型生成**由教师手动触发**（不自动重生成、不按需生成）。

## 1. 目标与非目标

**目标（v1）**
- 按章节生成幻灯片：一章一份 deck，素材就是该章 `Chapter.content`（Markdown）。
- 在线演示：平台内全屏放映，键盘翻页、页码、进度、讲者备注。
- 模板**可选择**（内置 N 套）、**可编辑**（课程级自定义模板）。
- 内容**可编辑**：Markdown 视图、JSON 视图两条路，改完即时预览。
- **跟随章节内容**：记住生成时的章节内容哈希，章节改了要能提示并一键同步。
- **切换展示**：在章节之间切换 deck，不退出放映态。

**非目标（v1 明确不做）**
- pptx / pdf 导出（v2 再说，见 §14）。
- AI 配图、公式渲染、自动图示（Mermaid）。
- 协作编辑 / 版本历史 / 评论。
- 模板市场、跨课程共享模板。

## 2. 关键约束（决定架构的既有事实）

| 约束 | 出处 | 后果 |
|---|---|---|
| 章节内容 = Markdown（`text`，可空） | `server/src/courses/course.entity.ts:100` | 素材现成，无需解析 docx/pptx |
| 平台已有 OpenAI 兼容 key：`DEEPSEEK_API_KEY`、`MOONSHOT_API_KEY` | `server/.env` | 模型接入零新增配置 |
| **服务端目前没有直接调 LLM 的代码**（LLM judge 在复验容器里跑） | `workspace.config.ts:134`、`docker-evaluation-runner.ts` | 需新增一个 LLM 客户端层，并沿用 `EVALUATION_RUNNER=mock\|docker` 的可 mock 模式 |
| 后端 `MemoryMax=800M`，CPU 为 QEMU vCPU（无 SSE4.2/POPCNT） | `nju-lab.service`、HANDOFF §2.1 注意③ | **任何需要 Chromium 的方案（Marp、Slidev、HTML→PDF）不可用** |
| 前端无编辑器依赖，只有 `marked@12` | `web/package.json` | 编辑控件先用 `Input.TextArea` + 校验，别引入 Monaco |
| 部署纪律：改 `/var/www/lab` 必须走 `deploy/deploy-web-lab.sh`（先 chunk 后 index.html） | HANDOFF §2.2 | **尽量不新增静态文件**，见 §4 |
| 已挂载点：`teacher/chapters/:chapterId/edit`、`student/chapters/:chapterId` | `web/src/App.tsx:94,105` | 幻灯片就挂在这两处，不新开路由树 |

## 3. 架构总览

```
① 生成（教师触发，可 mock）
   POST /api/chapters/:chapterId/slides/generate
        │  chapter.content(Markdown) + 课程名/章节序号 + 关联实验摘要
        ▼
   LlmClient（OpenAI 兼容 /chat/completions，model 可配）
        │  阶段 1：大纲 { deckTitle, slides:[{layout,title,bullets 骨架}] }
        │  阶段 2：逐页扩写 { bullets 展开, notes 讲者备注 }（小批次并发）
        ▼
   zod 校验 + 规整（页数上限、每页要点数、字符裁剪）→ SlideDeck.slides(JSON)

② 存储
   SlideDeck{ chapterId, slides(json), markdown(md 视图), templateId, config,
              basedOnChapterHash, status, model, tokensUsed, ... }
   SlideTemplate{ courseId|null, name, css, config, isBuiltin }

③ 渲染（前端，数据驱动）
   deck JSON ──renderSlidesHtml()──► 自包含 reveal 文档（HTML+CSS+JS 全内联）
                                    └─► <iframe srcdoc sandbox="allow-scripts">

④ 展示
   教师：章节编辑页「幻灯片」标签（生成 / 编辑 / 换模板 / 放映 / 跨章节切换）
   学生：章节阅读页「文档 ⇄ 幻灯片」视图切换（若该 deck 已发布）
```

## 4. 承载方式：`iframe srcdoc` 自包含文档 **[推荐，已实测要点]**

**为什么必须隔离**：reveal.js 自带 `reset.css`，会重置 `html/body/h1..h6/table` 等全局样式，**与 antd 直接冲突**（页面其余部分会错位）。所以幻灯片必须跑在独立文档里。

**两种隔离形态**

| 形态 | 体积 | 部署面 | 深链分享 | 结论 |
|---|---|---|---|---|
| **A. `iframe srcdoc` 自包含**（reveal 资产用 Vite `?raw` 动态 import 后内联） | 首次进入幻灯片页懒加载 ≈ 200–300KB（gzip 后 ≈ 100KB），主 bundle 不受影响 | **零改动**（不用碰 `/var/www/lab`，不用改 nginx） | 靠 SPA 路由深链（`/teacher/chapters/:id/slides`） | **[推荐 v1]** |
| B. 同源静态 viewer 页（`/lab/slides/viewer.html` + postMessage 传 deck） | 浏览器可缓存、多 deck 共享一份 reveal | 需新增静态文件 → 要走部署脚本与 §2.2 纪律 | 可给独立 URL | v2 再议 |

选 A 的关键理由：**不新增部署面**（本项目刚在部署顺序上踩过坑），且隔离是"物理级"的——`sandbox="allow-scripts"`（**不给 `allow-same-origin`**）让 iframe 文档落入 **opaque origin**，读不到平台 localStorage / cookie，教师或内容里的任何脚本都无法冒充当前用户（见 §11）。

**为什么 A 可行（2026-09-29 实测 reveal.js@6.0.2 的包内容）**：`dist/reveal.mjs` 是**完全自包含的单文件 ESM**——
静态 `import` 0 处、动态 `import()` 0 处、`import.meta` 0 处、仅 1 处 `export { … as default }`，
未压缩 141KB（gzip 后约 35–40KB），**可以直接内联进 `srcdoc` 的 `<script type="module">`，不需要任何相对路径解析**；
配套 `reveal.css` 54KB、`reset.css` 594B。

A 形态的两个实现要点：
- **键盘与全屏**：iframe 内跑一段我们自己的胶水脚本，监听 `message` 事件调用 `Reveal.next()/prev()/slide(i)`；父窗口负责接管按键与"演示模式"（把 iframe 铺满 viewport），**不依赖 iframe 内的 Fullscreen API**（opaque origin 下不保险）。
- **跨章节切换**：父窗口换 deck 时重建那一个 iframe 的 `srcdoc`（或复用 iframe + postMessage 增量换 `slides`），不退出演示态。
  **[已定 2026-09-29]** v1 用「重建 iframe」（状态最干净、实现最少），postMessage 增量换页留 v2。

## 5. 数据模型（新增 2 张表 + 迁移）

```ts
// 一章一 deck（v1 唯一约束 chapterId；多版本留到 v2）
@Entity()
export class SlideDeck {
  id: string;                     // uuid
  @Index() courseId: string;
  @Index({ unique: true }) chapterId: string;
  title: string;                  // 默认取章节标题
  slides: SlideJson[];            // json 列 —— 内容真源
  markdown: string | null;        // md 视图（由 slides 生成/教师编辑后的缓存，见 §7）
  templateId: string | null;      // null = 用平台默认模板
  config: SlideConfig | null;     // reveal 覆盖项：transition/背景/hash/页码/进度条
  status: 'empty'|'generating'|'ready'|'failed';
  generatedBy: 'llm'|'manual'|null;
  model: string | null; tokensUsed: number | null;
  basedOnChapterHash: string | null;   // 生成时章节内容的 sha256 → "内容已变更"提示（§9）
  sourceHash: string | null;           // 缓存键 = sha256(正文 + 模型 + prompt 版本)，命中即复用（§8）[实现期新增]
  error: string | null;
  warnings: string | null;             // 非致命提示（如"某批扩写失败已用大纲兜底"），与 error 分开 [实现期新增]
  createdBy: string; createdAt: Date; updatedAt: Date;
}

@Entity()
export class SlideTemplate {
  id: string;
  courseId: string | null;        // null = 内置模板（全局）
  name: string; description: string | null;
  baseTheme: string;              // reveal 主题基座（白名单，排除内嵌字体的 black 系列）[实现期新增]
  design: TemplateDesign | null;  // **只存调参，不存 CSS** —— CSS 由 designToCss 编译（§6）[实现期收敛]
  config: SlideConfig | null;     // 该模板的 reveal 默认配置
  isBuiltin: boolean; createdBy: string | null;
  createdAt: Date; updatedAt: Date;
}
```

```ts
type SlideJson = {
  id: string;
  layout: 'cover'|'section'|'bullets'|'two-col'|'code'|'quote'|'image'|'end';
  title?: string; subtitle?: string;
  bullets?: string[];             // 支持一级要点（v1 不做嵌套列表）
  left?: string; right?: string;  // two-col：两栏 Markdown
  code?: { lang: string; content: string };
  quote?: { text: string; cite?: string };
  image?: { url: string; caption?: string };   // 只允许平台内图片/已上传附件
  notes?: string;                 // 讲者备注 → <aside class="notes">
  attrs?: { background?: string; transition?: string; class?: string };
};

type SlideConfig = {
  transition?: 'none'|'fade'|'slide'|'convex'|'concave'|'zoom';
  slideNumber?: boolean|'c/t'; progress?: boolean; hash?: boolean;
  controls?: boolean; center?: boolean; loop?: boolean;
};
```

> 权限：`SlideDeck` 只信 `courseId`，由课程 owner（教师）写；学生只读且**仅当章节 `status=published`**（同 §11 权限矩阵）。

## 6. 模板系统：可选择 + 可编辑

**分层**（`SlideTemplate` + 内置）
1. **内置模板**（`isBuiltin=true`，代码里预置，不入库或首次启动 seed）：基于 reveal 官方主题派生 4–5 套，
   例如 `平台蓝`（对齐 antd `colorPrimary`）、`深色高对比`、`学术白`、`南大紫`、`极简黑白`。
   每套 = `theme 基座 + CSS 变量块 + 字体栈 + 页脚/logo 插槽`。
   ⚠️ **基座别选 `black` / `black-contrast`**：实测这两份各内嵌了 base64 字体、**564KB/份**，内联进 `srcdoc`
   等于每次放映都多背半兆；无内嵌字体的 `dracula` / `simple` / `serif` / `sky` / `night` 都只有 8KB。
   中文场景本就依赖系统字体栈（CSS 只写字体名，不需要服务端装字体）。
2. **课程级自定义模板**：教师从任一内置模板「另存为」→ 在该课程下可编辑 CSS 与配置 → 存 `SlideTemplate(courseId=…, isBuiltin=false)`。

**"可编辑"的两个档位 [待定]**
- **档 1（推荐 v1）：可视化调参** —— 配色（主色/背景/文字/强调）、字体栈、标题字号、页脚文案、logo（上传的 `files` 引用）、圆角/间距。
  落库为结构化 `design`，由 `designToCss()` 编译成 CSS 变量块（`--deck-primary` 等），教师不直接写 CSS。
  **[已实测 2026-09-29]** 安全边界按预期工作：`fontFamily` 里塞 `; } body { … } {`、`primary` 用 `url(javascript:…)`、
  `footerText` 塞 `<script>`、`radius` 越界、`density` 非法 **全部被拒**；中文页脚与中文字体名正常工作。
- **档 2（v2）：自由 CSS 编辑器** —— 允许写任意 CSS，落库前过滤：
  去掉 `@import`、`url(http…)` 外链、`expression(`、`javascript:`；限制 `position:fixed` 覆盖宿主（iframe 内无所谓宿主，但会盖住 reveal 控件）；
  禁止任何 `<script>`（CSS 编辑器里出现 `<` 直接拒绝）。

**模板与内容的耦合点**：模板只提供"样式与插槽"，**不改变 `SlideJson` 的语义**——同一份 deck 换模板不需要重新生成（这是把渲染层做成数据驱动的最大收益）。

## 7. 内容编辑：JSON 与 Markdown 双视图

**真源是 JSON**（`SlideDeck.slides`），Markdown 是它的**可读投影**：

| 视图 | 用途 | 与真源的关系 |
|---|---|---|
| **JSON 视图** | 精确控制（layout/notes/attrs）、批量替换、复制粘贴 | 直接编辑 `slides` |
| **Markdown 视图** | 教师日常写作、从章节正文搬内容 | `slides → md` 生成；编辑后**解析回** `slides` |

Markdown 视图的约定（受支持子集，刻意保持小）：
```md
# 页标题
<!-- .slide: layout=bullets -->
- 要点一
- 要点二

<!-- .notes: 讲者备注 -->

---

<!-- .slide: layout=two-col -->
左侧内容（Markdown）

<!-- .col -->
右侧内容（Markdown）
```
- JSON → MD 是**确定性**的（每个 layout 有固定模板），所以"换视图"不会漂移。
- MD → JSON 只解析上面的子集；解析失败给**行号 + 原因**，不静默丢弃。
- **不承诺无损 round-trip**：JSON 里的 `attrs.class`、自定义 `background` 等高级字段在 MD 视图里没有等价写法 → 打开 MD 视图时保留并在保存时**合并回**（而不是整体覆盖），并在 UI 上提示"该页有 MD 视图不支持的高级设置，已在保存时保留"。

## 8. 生成管线（LLM）

- **两阶段**（避免长 JSON 被截断，也让教师能卡在中间改）：
  1. **大纲**：输入章节 Markdown → 输出 `{deckTitle, slides:[{layout,title,bullets 骨架}]}`（页数上限默认 20，可配）。
  2. **扩写**：按页分批（默认 4 页/批并发）补全要点表述与 `notes` 讲者备注。
- **契约与配置**：`LlmClient`（`server/src/slides/llm.client.ts`）走 OpenAI 兼容 `/chat/completions`；
  `SLIDES_MODEL`（默认复用 `DEEPSEEK_API_KEY` 对应模型）、`SLIDES_GENERATOR=mock|llm`（默认 mock，开发/测试不烧额度，与 `EVALUATION_RUNNER` 同风格）、`SLIDES_MAX_SLIDES`、`SLIDES_MAX_TOKENS`。
- **规整与拒绝**：zod 校验 layout 枚举、字段类型、页数/要点数/字符上限；不合法就**报错并留原文**，绝不把畸形结构渲染出去。
- **缓存**：`sourceHash = sha256(chapter.content + model + promptVersion)`；同 hash 直接复用已有 deck（返回 `cached: true`）。
- **成本护栏**：`SLIDES_MAX_TOKENS` 单次上限 + 每课程每小时生成次数上限（计数落 DB，不引 Redis）。
- **异步**：生成 10–60s，接口立即返回 `status='generating'`，前端轮询 `GET .../slides` 直到 `ready|failed`（平台已有 `verifying` 状态机先例）。

## 9. 与章节内容联动（"跟随章节内容"）

- 生成时写入 `basedOnChapterHash = sha256(chapter.content)`。
- 读取 deck 时后端**顺带比较**当前章节 hash，返回 `chapterChanged: boolean`。
- 教师端在 `chapterChanged` 时提示：「章节内容已变更，重新生成 / 保留现有 deck（仅更新哈希）」。
- **绝不自动重生成**：LLM 调用有成本、且会覆盖教师的手工编辑。

## 10. 展示与切换

**教师端**（挂在 `teacher/chapters/:chapterId/edit`，与现有「编辑 / 预览」并列加一格「幻灯片」）
- 左侧：页缩略列表（增/删/拖排序/上下移动）
- 中间：当前页编辑（字段表单 **或** md / json 全文视图切换）
- 右侧：实时预览（iframe）
- 顶部：模板选择（下拉 + 「编辑模板」抽屉）、`生成/重新生成`、`放映`（iframe 铺满 viewport）、**上一章 / 下一章**（跨章节切换 deck，不退出放映）
- 「章节内容已变更」提示条（§9）

**学生端**（挂在 `student/chapters/:chapterId`）
- 章节阅读页顶部加 `文档 ⇄ 幻灯片` 切换；无 deck 或章节未发布时不显示该切换。
- 只读：不能编辑模板/内容，只能看与翻页。

## 11. 安全（这一节不能省）

| 面 | 威胁 | 对策 |
|---|---|---|
| 内容里的原始 HTML | 教师内容 → 学生浏览器 XSS（同源 iframe 可读 localStorage token） | 渲染内容时**禁用原始 HTML**（marked 关闭 HTML 或 DOMPurify 白名单）；正文只允许标准 Markdown |
| iframe 隔离 | iframe 内脚本访问平台存储 | `sandbox="allow-scripts"`（**不给 `allow-same-origin`**）→ opaque origin，读不到 cookie/localStorage；父 → 子只走 `postMessage` 且校验 `event.data` 形状 |
| 模板 CSS | `@import`/外链 `url()` 泄露访问者 IP、注入外部资源 | 落库前过滤（§6 档 2 规则） |
| 图片 URL | 外链图片泄露、混合内容 | 只允许平台内 `files` 引用与白名单域名 |
| 权限 | 学生改内容、跨课程越权 | 写操作限课程 owner（`teacher`）；读限该课程师生；学生额外要求章节 `status=published` |
| 成本 | 刷生成接口 | 每课程频次上限 + `SLIDES_MAX_TOKENS` + 幂等 hash |

## 12. API 契约（草案）

| 方法 | 路径 | 角色 | 说明 |
|---|---|---|---|
| `GET` | `/api/chapters/:chapterId/slides` | 师生 | 返回 deck（无则 `null`）+ `chapterChanged` + 可用模板列表 |
| `POST` | `/api/chapters/:chapterId/slides/generate` | 教师 | 触发两阶段生成；`{templateId?, force?}`；命中缓存则直接 `ready` |
| ~~`POST` `/api/chapters/:chapterId/slides/outline`~~ | 教师 | **[v1 收敛，移到 v2]** 单独暴露"只出大纲"对当前界面无用：两阶段已在服务端内部完成，教师拿到的是完整 deck 且可编辑 |
| `PUT` | `/api/chapters/:chapterId/slides` | 教师 | 保存内容（`{slides?, markdown?, templateId?, config?}`）；`slides` 与 `markdown` 二者至少给一个，服务端按 §7 合并 |
| `POST` | `/api/chapters/:chapterId/slides/sync-hash` | 教师 | 仅更新 `basedOnChapterHash`（"保留现有 deck"） |
| `DELETE` | `/api/chapters/:chapterId/slides` | 教师 | 删除 deck |
| `GET` | `/api/slide-templates?courseId=` | 教师 | 内置 + 本课程自定义模板 |
| `POST` | `/api/slide-templates` | 教师 | 从内置另存为课程级自定义模板 |
| `PUT` | `/api/slide-templates/:id` | 教师 | 编辑自定义模板（内置模板不可改，只能另存） |
| `DELETE` | `/api/slide-templates/:id` | 教师 | 删除自定义模板（被 deck 引用时改回默认并提示） |

响应统一 `{code, data, message}`（平台既有约定）。

## 13. 改造点清单（文件级）

**后端**
- **[已实现 2026-09-29]** `server/src/slides/`：`slides.config.ts`（env/开关）、`deck.schema.ts`（结构+手写校验，**没用 zod**：平台只有 class-validator，嵌套 JSON 手写更直白）、`deck-markdown.ts`（JSON ⇄ MD 投影 + 合并保存）、`template.schema.ts`（内置模板 + 调参校验 + `designToCss`）、`llm.client.ts`（内置 fetch）、`slides.generator.ts`（mock + llm 两阶段）、`slides.service.ts`、`slides.controller.ts`、`slide-templates.controller.ts`、`slides.module.ts`、`slide-deck.entity.ts`、`slide-template.entity.ts`、`dto/slides.dto.ts`
- 新增迁移 `src/migrations/<ts>-SlideDecks.ts`（两张表 + 唯一索引）
- `app.module.ts` 注册 `SlidesModule`；`.env.example` 增加 `SLIDES_GENERATOR/SLIDES_MODEL/SLIDES_MAX_SLIDES/SLIDES_MAX_TOKENS`
- `courses.service.ts`：`readChapter`/`getChapter` 旁挂 `chapterChanged`（或由 slides 模块自行计算，避免耦合）

**前端**
- 新增 `web/src/slides/`：`render.ts`（SlideJson → 自包含 reveal 文档）、`layouts/*.tsx` 或模板字符串、`revealAsset.ts`（`import('reveal.js/dist/reveal.mjs?raw')` 懒加载 + 缓存）、`mdProjection.ts`（slides ⇄ markdown）、`SlideStage.tsx`（iframe 封装：srcdoc、按键转发、演示模式）
- 新增 `web/src/pages/teacher/ChapterSlides.tsx`（或作为 `ChapterEdit.tsx` 的新标签页）
- 改 `web/src/pages/student/ChapterRead.tsx`：顶部「文档 ⇄ 幻灯片」
- 改 `web/src/api/index.ts`、`web/src/types/index.ts`：新接口与类型
- `package.json` 增加 `reveal.js`（仅 `?raw` 内联用，不进主 bundle）
- **不改** `deploy/deploy-web-lab.sh`（A 形态不新增静态文件，这是选它的理由之一）

## 14. 分期

- **v1**：§3–§12 全部；内置 4–5 套模板；模板"档 1"可视化调参；md/json 双视图；两阶段生成 + mock；教师放映 + 跨章节切换；学生端只读切换。
- **v2**：模板"档 2"自由 CSS；同源静态 viewer（可分享独立链接）；多 deck 版本与历史；从章节正文"插入为页"；图片选择器（复用章节已上传图片）。
- **v3**：pptx 导出（**届时再评估**：pptxgenjs 纯 JS 可行，但要注意导出的是"按模板生成的 pptx"，样式还原度低于在线演示）；公式与 Mermaid（渲染需 Chromium → 只能放容器里跑，见 §2）。

## 15. 风险与取舍

| 风险 | 说明 | 缓解 |
|---|---|---|
| reveal 资产内联导致首屏变重 | A 形态把 `reveal.mjs` 内联进 srcdoc | 懒加载（只有进入幻灯片页才拉）+ 浏览器缓存；若嫌重就走 v2 的 B 形态 |
| 双视图 round-trip | MD 视图无法表达全部 JSON 字段 | §7 的"合并保存 + 提示"，且明确不承诺无损 |
| LLM 输出不稳定 | 结构漂移、页数失控 | zod 校验 + 规整 + 上限；失败保留原文供人工修改，不渲染畸形内容 |
| 平台内存红线 | 800M，且无 SSE4.2 | 纯前端渲染（iframe）+ 后端只做 JSON 与调用 API，**绝不引入 Chromium** |
| 模板编辑的安全性 | 自定义 CSS 的外链/泄露 | 过滤规则 + opaque origin 沙箱（§11） |
| 学生端信息泄露 | deck 可能含未发布内容 | 学生只在章节 `published` 时可见 deck（§11） |
