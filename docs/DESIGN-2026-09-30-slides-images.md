# 幻灯片图片能力设计（2026-09-30）

> 章节幻灯片的图片功能增强：图片上传、图片选择器、4 种新图片版式、LLM 条件配图。
> 功能与现状的活文档是 `docs/SLIDES.md`（§3 版式表）；运行态见 `HANDOFF.md` §9.5a。
> 本文记录**决策与取舍**（一次性的设计快照，后续以 SLIDES.md 为准）。

## 1. 已确认决策（与用户对齐）

1. **新增 4 种图片版式**：`image-full`（全幅大图）、`image-left` / `image-right`（图文并排）、
   `image-grid`（多图网格 1–4 张）；原 `image` 单图页保留。
2. **教师个人图片库**：图片选择器列「本人上传的全部图片」（跨课程复用），
   不给 `StoredFile` 加 courseId、不做数据库迁移。
3. **LLM 条件配图**：章节正文里有 `file:` 插图时，生成器允许选图片版式（url 仅限清单内）；
   正文无图时维持「不生成 image 页」。不让模型无中生有配图。
4. **章节正文图片上传一起做**：章节编辑器加「上传图片」，`MarkdownView` 支持渲染 `file:` 图片。

## 2. 关键约束（来自既有架构，不能破）

- 演示 iframe 是 `sandbox="allow-scripts"`（无 allow-same-origin）的 **opaque origin**：
  `<img>` 带不了 `Authorization` 头也没有 cookie。所有平台图片（`file:<fileId>`）必须在**父窗口**
  带 JWT 取回 → 转 data URL 内联（`web/src/slides/files.ts`）。新版式、选择器缩略图、
  `MarkdownView` 正文插图全部复用这一条管线，**没有任何地方允许外链/相对路径图片**。
- deck.schema 只接受 `file:<uuid>` 形式的图片引用（外链会泄露访问者信息 + 混合内容），
  新版式沿用同一校验（`FILE_REF_RE`）。
- 渲染层断言不变量：整份文档 `<script>` 恰好 2 个（reveal 本体 + 桥接），新版式不得引入第三个。

## 3. 数据模型与 API

- `SlideJson` 新增 `images?: SlideImage[]`（`SlideImage = { url, caption? }`，grid 用，≤4 张超出截断）；
  单图系新版式复用既有 `image` 字段。`slide_decks.slides` 是 json 列，**无需迁移**。
- 版式与内容最低匹配（新增）：`image-full/left/right` 必须有 `image`，`image-grid` 必须有 `images`
  （否则就是空页）；`image-left/right` 的 `bullets` 可空。旧 `image` 版式保持宽松，不追加强校验，
  避免误伤既有 deck 的无关保存。
- **新增 `GET /api/files?kind=image&limit&offset`**：只列**本人**上传的文件（`uploaderId` 过滤），
  `kind=image` 时 `mimeType LIKE 'image/%'`；limit 默认 50、上限 100，按 `createdAt DESC`。
  `StoredFileInfo` 增量补 `mimeType`、`createdAt`。
  选择它而非「课程级图片库」的理由：图片天然跨课程复用（同一教师在多门课用同一套图），
  且不加 courseId 就**零迁移**；文件访问权限维持现状（UUID 能力凭证，deck 里的 fileId 即通行证，
  学生渲染教师 deck 的图天然可行）。
- 上传端点（`POST /api/files`）不动：它与提交物 zip 共用，**不加全局 MIME 白名单**；
  图片类型约束放在各上传入口的 `accept`（png/jpeg/webp/gif/svg；SVG 经 `<img>` 加载不执行脚本，安全）。

## 4. Markdown 投影约定（往返确定性）

- `image` / `image-full`：一行 `![caption](url)`（二者靠指令行 `<!-- .slide: layout=… -->` 区分）。
- `image-left` / `image-right`：图片行 + `- 要点` 行（这两个版式加入 `BULLET_LAYOUTS`）。
- `image-grid`：多张图写成多行 `![caption](url)`（≤4）。
- 无指令兜底（`detectLayout`，只影响手写 MD）：≥2 个图片行 → `image-grid`；单图片行 → `image`；
  **不猜 left/right**（要并排必须显式写指令，保持确定性）。
- `toMarkdown` 每页必发指令行，所以往返逐字段相等（已用临时脚本实测：6 页含全部新版式，
  JSON→MD→JSON 字段级一致；grid 超 4 张 / left 缺图 / 外链均按预期抛带行号的错）。

## 5. LLM 条件配图（prompt v4）

- **素材提取**：`extractChapterImages()` 用正则 `!\[([^\]]*)\]\((file:<uuid>)\)` 从章节正文提取
  `{fileId, caption?}` 清单（去重、跳过外链与非 file 引用），随 `DeckSource` 注入生成器。
  `sourceHash` 不用改——清单派生自正文，正文变 hash 变。
- **prompt**：大纲规则 4 变条件分支（无图维持禁令原文；有图允许 5 种图片版式、一份 deck ≤3 页、
  不为配图硬凑页）；清单（fileId + 图注）同时进大纲与扩写的 user prompt；
  扩写契约补 `image` / `images` 字段与「照抄 fileId、禁止改写一个字符」的硬要求。
- **防幻觉闸（不靠模型自觉）**：扩写逐页校验时，`image.url` / `images[].url` 必须 ∈ 清单，
  否则抛错 → 走既有「丢该页 + 大纲骨架兜底」路径；骨架把图片系版式降级为 bullets
  （`SKELETON_DEGRADE_LAYOUTS`）。教师手工插图不经过生成器，不受此限。
- **纪律**：`SLIDES_PROMPT_VERSION` v3 → v4（否则 sourceHash 命中旧缓存）。

## 6. 教师端交互

- **章节正文**（`ChapterEdit`）：「上传图片」按钮 → `POST /api/files` → 光标处插入
  `![文件名去扩展名](file:<id>)`；`MarkdownView` 扫 marked 输出里的 `src="file:…"` →
  鉴权取回 → data URL 替换（教师预览与学生阅读共用此组件，一次改动两端生效）。
- **幻灯片编辑页**（`ChapterSlides`）：编辑区工具条「插入图片页」（5 种版式下拉）与「换图」
  （当前页是单图系版式时可用；JSON 模式结构化判断，MD 模式看页块里有没有图片行）。
- **图片选择器**（`ImagePickerDrawer`）：上传新图（传完自动选中）+ 本人图片缩略图网格
  （分页 24/页；缩略图 objectURL 会话级缓存）；grid 插页时多选（2–4 张，按点选顺序）。
- **落地**（`web/src/slides/imageActions.ts`，纯函数）：JSON 模式 parse → splice → stringify；
  MD 模式按与 server `splitPages` 同规则切页后文本 splice（重 join 分隔符统一为 `\n\n---\n\n`，
  与 `toMarkdown` 一致）。**都只改编辑区文本**，教师预览后点「保存内容」才生效
  （后端 `normalizeSlides` 再校验一遍，双保险）。
- 明确不做（v1）：grid 页内逐张换图的图形化（文本编辑兜底）、deck 保存时 fileId 存在性校验
  （避免误伤既有 deck 的无关保存）、上传限流。

## 7. 渲染与防溢出

- `image-full`：`max-height: 72vh` + `object-fit: contain`（教学图保信息完整，宁留白不裁切）。
- `image-left/right`：flex 图 45% / 文 55%（`deck-split-right` 反向），图限高 58vh，文复用要点卡片。
- `image-grid`：CSS grid（2 张两列 / 3 张三列 / 4 张 2×2），2 张限高 48vh、3/4 张限高 28vh。
- 权重缩档：单图系沿用 image +200（bullets 另计），grid 按 `60 + 110×张数` 计，
  超重点页仍触发 `deck-fit-2/3`（4 张网格页实测落 `deck-fit-2`）。

## 8. 验证记录

- `server` / `web` `npm run build`（tsc）通过；
- `node web/tools/assert-render.mjs` **27 项全绿**（新增：5 种图片版式 DOM、grid 格数、
  grid 缩档、取不到图的占位回退）；
- MD 往返临时脚本（跑完即删）：全部新版式 JSON→MD→JSON 逐字段相等 + 错误路径按预期抛错；
- `imageActions` 临时脚本（跑完即删）：JSON/MD 两种落地 13 项断言（插入位次、网格多图行、
  换图保 caption、无图片行追加、无指令/--- 混排切页与 server 同规则）；
- `extractChapterImages` 实测：去重、跳过外链/非 file 引用、空清单；
- 浏览器端全链路（上传 → 选择器 → 放映；LLM 真实生成配图）随部署后 `verify-slides.mjs` +
  `review-decks.mjs` 回归（部署走 §HANDOFF 常规流程）。
