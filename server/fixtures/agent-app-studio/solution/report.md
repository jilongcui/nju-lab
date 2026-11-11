# 实测档案（教师侧解答样例）

> 随 `solution/` 保留、不下发。学生侧的过程记录模板见 `skill-template/report.md`。

## 1. 自测概况

- 实现：`solution/harness/api.py`（六个函数 + 图片走视觉）+ `solution/web/`（改过的前端）
- 运行环境：`nju-lab-verify:0.2.0-rc.2-pkg6`（与平台复验同镜像）
- 自测时间：2026-11-11

## 2. 各 case 的结果

| case | 附件（pdf/docx/image） | 指标行（total / abnormal / listed） | 工具（executed / rejected） | 是否达标 |
|---|---|---|---|---|
| case01 | 3（pdf+docx+png，图片走视觉 1 行） | 5 / 4 / 4 | 1 / 1 | 是 |
| case02 | 3（pdf+docx+png，图片走视觉 1 行） | 5 / 4 / 5 | 1 / 2 | 是 |

## 3. 对照做法（偷懒解）

- 不解析附件、直接把 PDF 文本贴进报告：指标表为空、`flag` 无从判，报告断言直接 fail；
- 直接交模板：`app.web_sha256` 等于基线，被"前端真的改过"抓住；
- 偏好不生效（报告按全量行出）：case01 的 `listed` 会变成 4，与 expected 的 3 不符。

## 4. 踩坑记录

1. 报告要用**本轮记忆更新之后**的偏好：一开始在轮初算偏好，导致"忘掉 MEM01"那一轮仍过滤；
2. 图片的 `checksum` 不能对文件字节或**模型原始输出**算 —— 视觉输出的空格/换行会漂；
   口径是"先抽成 `item,value,unit` 行，再对规范化行文本算哈希"（实测 3/3 一致）；
3. 视觉调用的 `max_tokens` 给小了（如 20）会被思维链吃光、`content` 为空；给 800 + `reasoning_effort: none` 稳定；
3. PDF 的 `chars` 只算抽出来的文本行，把 `stream`/`endstream` 之类也算进去就会对不上；
4. `web_sha256` 必须按"相对路径升序 + 路径 + \0 + 内容 + \0"算，少喂一个 `\0` 就对不上。

## 5. 结论

最容易错的是"报告口径"：行集、flag、四节篇幅三处任一错位，后面全错。
附件解析本身不难，难的是**约定形态**要写清楚 —— 否则学生写的解析器与造题时的生成器对不上。

## 6. 产出图

- `figures/app_report_overview.png`：每轮步数与最终指标行数（case02 第 2 轮被 `max_steps` 截断）。
