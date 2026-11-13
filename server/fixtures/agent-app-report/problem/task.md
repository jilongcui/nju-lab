# 入门实验：把附件整理成一份能复核的报告

> **流程归属**：本实验是**工程实现型**——按题目口径写一段确定性代码，用两个样例逐字段核对，
> **没有"定基线 → 训练 → 评估指标"这些环节**。

## 从这里开始（约 30 分钟）

| 步 | 做什么 | 你会拿到 |
|---|---|---|
| 1 | 看 `problem/reference/` 里的参考实现（这一档**给示范**，先读后仿） | 知道要写哪几个函数 |
| 2 | 打开 `skill-template/harness/api.py`，把两个 TODO 填上 | 一份能跑的脚本 |
| 3 | 跑一个样例：`python3 harness/run.py <样例目录> output.json` | `output.json` + 图 |
| 4 | 与 `cases/<样例>/expected.json` 逐项对一遍 | 知道自己偏在哪 |
| 5 | 把结论与踩坑写进 `report.md` | 过程记录 |

## 业务背景

门诊把三份材料丢给护士，让她"整理成报告"：一份系统导出的 PDF、一份 Word 补录、一张手机拍的检验单截图。
她现在的做法是照着屏幕一条条敲进模板 —— 慢，而且很容易漏掉超参考区间的那一行。

你要写的是那个"帮忙整理"的脚本：**把附件读成结构化的指标行，按固定口径出报告**。

## 你的任务

写一个脚本（放在 `harness/api.py` 的两个函数里），对任意一份同结构的输入产出 `output.json`：

1. **解析附件**（`parse_attachment`）：
   - PDF：抽未压缩内容流里的文本（`(...) Tj`），一行一条；
   - Word（`.docx`）：解 zip 读 `word/document.xml`，每个 `<w:p>` 拼成一行；
   - 图片：**没有文本层** —— 交给宿主的 `app_host.vision_extract()` 让视觉模型读出来；
   - 三类都要标 `via`：前两类 `text`，图片 `vision`。
2. **出报告**（`build_report`）：按 `report_format.json` 的四节（名称、顺序、最小篇幅）
   + 指标表（`item / value / unit / flag`）+ 三个计数（`total / abnormal / listed`）。
3. **画一张图**：每份附件抽出的行数（胶水代码已给，标题用英文）。

## 口径（钉死）

- **只登记**形如 `ITEM,VALUE,UNIT` 的行（三项、第二项是数字）；`备注:` 之类忽略；
- `flag`：低于参考下限 `low`、高于上限 `high`、其余 `normal`（`report_format.thresholds`）；
- `chars`：文本类附件所有行长度之和；**图片写 0**（它没有文本层）；
- `rows`：该附件登记的行数；
- 指标表顺序：按**文件名升序**逐个附件、附件内按行序（胶水代码已排好）。

## 数据字典

| 文件 | 说明 |
|---|---|
| `cases/<case>/attachments/` | 三份附件（pdf / docx / png） |
| `cases/<case>/report_format.json` | 四节模板、指标表列、参考区间 |
| `cases/<case>/brief.md` | 本次任务的简报（用大白话说这批材料是什么） |
| `cases/<case>/expected.json` | 参考水平（自查用） |

## 交付格式

```json
{
  "attachments": [ { "name": "report.pdf", "kind": "pdf", "via": "text", "rows": 3, "chars": 56 } ],
  "report": {
    "template_used": "report_format.json",
    "sections": [ { "name": "目的", "content": "……（≥ 模板的 min_chars）" } ],
    "metric_rows": [ { "item": "PLT", "value": 18, "unit": "10^9/L", "flag": "low" } ],
    "counts": { "total": 5, "abnormal": 4, "listed": 5 }
  },
  "metrics": { "attachments_parsed": 3, "total_rows": 5, "abnormal_rows": 4 },
  "figures": [ { "path": "figures/attachments_overview.png", "takeaway": "……（一句话）" } ],
  "notes": "……（≥60 字：为什么先解析成行、flag 为什么必须按区间判、至少一条局限）"
}
```

## 做完前自查

- [ ] 三份附件都解析到了（PDF / Word / 图片各一），图片的 `via` 是 `vision`；
- [ ] 指标表行数与 `expected.json` 一致，`flag` 没有 `unknown` 之类的自造值；
- [ ] `counts.total` = 各附件 `rows` 之和；`counts.abnormal` 与指标表里数出来的一致；
- [ ] 四节名称、顺序、篇幅都对得上模板；
- [ ] 图有一张，`takeaway` 里的数字与 `counts` 自洽；
- [ ] `notes` 写了至少一条真实局限（例如"真实 PDF 有压缩流，本实验是约定形态"）。

> 报告会由工具整理进 `report.md`，**不需要改 `SKILL.md`**。
