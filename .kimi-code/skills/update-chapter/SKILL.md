---
name: update-chapter
description: 将写好的 Markdown 正文更新到课程平台指定章节，也可修改章节标题（按标题或 ID 定位 chapters 表，写入并回读校验）；正文改完后还负责重新生成并核验该章幻灯片 deck
type: prompt
whenToUse: 当用户要求把课程内容、章节正文、讲义更新/写入/发布到平台的某一章，或修改某章标题（如"把它更新到课程章节 X 作为内容"、"把 X 章标题改为 Y"）时；正文改完用户要求"一并重新生成幻灯片/deck"时也走本 skill
arguments:
  - title
  - file
---

# 更新课程章节正文

本平台（NestJS + TypeORM + MySQL）的章节正文存在 `chapters.content`（TEXT）列。
课程、章节元信息分别在 `courses` / `chapters` 表，章节经 `courseId` 关联课程。
本 skill 用随附脚本 `${KIMI_SKILL_DIR}/update-chapter.cjs` 完成「定位 → 写入 → 回读校验」。

## 前置检查

1. **正文必须是学生视角的成品 Markdown**：去掉对话痕迹（如"下面是为这一章写的内容"）、
   去掉写作说明/元信息；平台直接渲染 `Chapter.content`，且它是章节幻灯片的生成素材
   （见 `docs/SLIDES.md`），正文质量直接决定幻灯片质量。
2. 章节标题以平台现有数据为准；用户给的标题可能是简称，先用预览模式确认。

## 操作步骤

```bash
# ① 预览定位（不写库）；标题精确匹配，失败自动退化为模糊搜索并列出候选
node ${KIMI_SKILL_DIR}/update-chapter.cjs --title "$title"

# ② 唯一命中后写入并回读校验（affectedRows / 长度 / 首尾片段）
node ${KIMI_SKILL_DIR}/update-chapter.cjs --title "$title" --file "$file"

# ③ 修改章节标题（可与 --file 同用，一次改标题 + 正文）
node ${KIMI_SKILL_DIR}/update-chapter.cjs --title "旧标题" --new-title "新标题"
```

- 命中 0 个：脚本会列出平台全部章节，与用户核对真实标题后重试；
- 命中多个：脚本列出候选的 UUID，改用 `--id <uuid>` 指定，**绝不猜测写入**；
- 正文文件为空时脚本拒绝写入；
- 改名时若**同一课程内已有同名章节**，脚本拒绝执行（防止 --title 定位失效），需换个标题或先与用户确认。

## 正文更新之后：重新生成并核验章节幻灯片 deck

平台**不会**因为正文变了就自动重生成 deck（见 `docs/SLIDES.md` §2：教师手动触发）。
脚本写库成功后会提示「该章已存在幻灯片 deck」，此时：

- **默认**：提醒用户到教师端章节页点「重新生成」；
- **用户明确要求代做时**：按下面四步走 —— 用平台自己的 HTTP 接口（等价于教师页点生成），
  **不要另写生成逻辑、不要手改 `slide_decks` 表**。

凭证用平台教师账号取 token（账号表见 `HANDOFF.md` 的「测试账号」；**禁止在回复里打印口令**）。
下例中 `B=http://127.0.0.1:3100/api`，`C=<chapterId>`。

```bash
TOKEN=$(curl -s -X POST "$B/auth/login" -H 'Content-Type: application/json' \
  -d '{"username":"<教师账号>","password":"<口令>"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["accessToken"])')

# ① 触发生成（异步：立即返回 status=generating，随后轮询）
curl -s -X POST "$B/chapters/$C/slides/generate" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{}'

# ② 轮询到 ready / failed（每 6s 一次，最多等 9 分钟）
curl -s "$B/chapters/$C/slides" -H "Authorization: Bearer $TOKEN"

# ③ 有「兜底页」就单页重生成（index 从 0 开始；同步返回，通常 5~15s）
curl -s -X POST "$B/chapters/$C/slides/regenerate-page" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"index":1,"instruction":"本页是目录页：给出 3~4 个分节（每个一句话），并补一段可照读的口播讲稿（4~7 句）。"}'
```

**核验判据**（逐页看，别只看 `warnings` —— 单页重生成会把 `warnings` 覆盖成本次结果）：

| 检查项 | 合格标准 |
|---|---|
| `status` | `ready` |
| 页数 | 8~20 页（本课程长正文一般是 17~20 页） |
| 每页内容块 | 除封面外 `blocks.length ≥ 1`（`toc` / `section` 页天然只有 1 块） |
| 每页正文字符数 | `JSON.stringify(blocks).length ≥ 60`；`section` 分节页天然只有一句导语（≥ 40 即可）；低于该值且 `notes` 为空 ⇒ 基本是「计划骨架兜底」 |
| 讲稿 | 每页 `notes.length > 0`（含封面） |
| `warnings` | 不含「内容缺失，已用计划骨架兜底」「缺少讲稿」「第 N 页：第 1 页没有可用内容块，已跳过」；「讲稿正文里出现『学员/学生』」也算不合格（`[ …… ]` 内的备课提示除外，见下） |

**已知坑**：

- 整份生成的第一批扩写偶尔整体丢失（表现为第 2~4 页 `notes=0`、`body<60`），用 `regenerate-page` 逐页补即可；
- 响应是 `{code:0, data:{deck}}`，把它当 `data.slides` 用会拿到 `undefined`；
- `index` 是 **0 基**；`regenerate-page` 是**同步**调用，与整份生成共用频次护栏
  **20 次/小时/课程**（`SLIDES_GENERATE_PER_HOUR`），批量修页时注意别撞 429；
- 封面 `blocks=0` 是正常的，不要当成缺内容去"补"；
- 讲稿里的 `[ 让学员先自己想一下 ]` 这类**备课提示**是平台支持的格式（`docs/SLIDES.md` §5.3），
  不算"面向讲者"；只有 `[ ]` **之外**的正文出现「学员/学生」才需要改。

## 完成后向用户报告

- 更新到的课程/章节、原字节数 → 新字节数；
- 若脚本提示该章已有幻灯片 deck：默认提醒用户到章节页手动重新生成（平台绝不自动重新生成）；
  用户要求代做时按上一节走，并报告：哪几章重新生成过、页数、修了哪几页兜底页、核验是否全绿；
- 正文源文件路径（若在 /tmp 等临时目录，提醒用户是否需要归档）。

## 安全与纪律（必须遵守）

- **凭证零暴露**：DB 口令由脚本通过 `server/.env` 经 dotenv 自行加载；
  禁止 `cat`/复制 `.env`，禁止用 `mysql -p<明文>` 命令行，禁止在回复中打印口令。
- 本 skill 只修改数据库**内容**，不涉及代码；`AGENTS.md` 的
  「禁止直接在部署目录（`server/`）改代码」对代码改动仍然有效。
- 本 skill 只 `UPDATE chapters` 的 `content` / `title` 字段（`title` 仅在用户明确要求改名时）；
  不要动 `status`、`order`、课程归属等其他字段，除非用户明确要求。

ARGUMENTS: $ARGUMENTS
