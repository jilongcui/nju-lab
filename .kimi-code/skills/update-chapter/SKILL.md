---
name: update-chapter
description: 将写好的 Markdown 正文更新到课程平台指定章节（按标题或 ID 定位 chapters 表，写入 content 并回读校验）
type: prompt
whenToUse: 当用户要求把课程内容、章节正文、讲义更新/写入/发布到平台的某一章（如"把它更新到课程章节 X 作为内容"）时
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
```

- 命中 0 个：脚本会列出平台全部章节，与用户核对真实标题后重试；
- 命中多个：脚本列出候选的 UUID，改用 `--id <uuid>` 指定，**绝不猜测写入**；
- 正文文件为空时脚本拒绝写入。

## 完成后向用户报告

- 更新到的课程/章节、原字节数 → 新字节数；
- 若脚本提示该章已有幻灯片 deck：教师端会显示「章节内容已变更」，
  提醒用户到章节页手动重新生成（平台绝不自动重新生成）；
- 正文源文件路径（若在 /tmp 等临时目录，提醒用户是否需要归档）。

## 安全与纪律（必须遵守）

- **凭证零暴露**：DB 口令由脚本通过 `server/.env` 经 dotenv 自行加载；
  禁止 `cat`/复制 `.env`，禁止用 `mysql -p<明文>` 命令行，禁止在回复中打印口令。
- 本 skill 只修改数据库**内容**，不涉及代码；`AGENTS.md` 的
  「禁止直接在部署目录（`server/`）改代码」对代码改动仍然有效。
- 只 `UPDATE chapters.content`；不要动 `status`、`order`、课程归属等其他字段，
  除非用户明确要求。

ARGUMENTS: $ARGUMENTS
