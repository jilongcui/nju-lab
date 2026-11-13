# 应用实践：写一个 Skill，把检验数据整理成能分享的报告

> **流程归属**：本实验是**工程实现型**——写一个 Skill 的 `handle()`，用两个样例逐轮核对，
> 没有"定基线 → 训练 → 评估指标"这些环节。

## 业务背景

上一章你把 **agent** 做出来了：循环、记忆、工具、知识库、安全边界。
但 agent 本身不知道"检验数据该怎么整理" —— 那是**具体业务的知识**，要写成 **Skill**。

这一章就做这件事：**基于那个 agent，写一个 Skill，把科室的"检验数据 → 报告"流程固化下来。**
写完之后，平台会把它装成一个**能分享的应用**（有页面、能上传、能对话）—— 前端、托管、分享链接
都是平台的事，你不需要写。

## 从这里开始（5 步，约 1 小时）

| 步 | 做什么 | 你会拿到 |
|---|---|---|
| 1 | 看 `problem/reference/`（参考 Skill，先读后仿） | 知道 `handle()` 要做什么 |
| 2 | 打开 `skill-template/scripts/api.py`，把 `handle()` 填上 | 一个能跑的 Skill |
| 3 | 跑一个样例：`python3 run_case.py <样例目录> output.json` | `output.json` + 图 |
| 4 | 与 `cases/<样例>/expected.json` 逐项对一遍（每轮的行数、拒答、升级） | 知道自己偏在哪 |
| 5 | 在工作台里提交 Skill 包 → 回平台点「用我的 Skill 创建应用」 | 一个**能分享的应用** |

> 第 5 步不用打包、不用命令行：平台会把你的 Skill 装进 agent，自动发布并给分享链接。

## 你的任务：实现 `handle()`

平台（和本地自测用的 `platform_core.py`）已经把附件解析好了，你拿到的
`attachments[].rows` 就是 `item / value / unit`。**你要做四件事**：

1. **判 flag**：用 `report_format.json` 的参考区间，低于下限 `low`、高于上限 `high`、其余 `normal`；
2. **写报告**：按模板的四节（名称、顺序、最小篇幅）+ 指标表 + 三个计数（`total / abnormal / listed`）；
3. **让记忆生效**：平台会把用户偏好放在 `state["memory"]`（例如"报告只列异常指标"）——
   这时指标表只列异常行；用户说"忘掉"之后，又恢复全量；
4. **守边界**：越界行逐条写进 `safety.escalations`（话术用模板里的原文，一字不改）；
   诊断式提问由**平台兜底**替换成拒答（你只要返回正常答复，不用自己写拒答话术）。

## 口径（钉死）

| 项 | 要求 |
|---|---|
| flag | 只能是 `low` / `high` / `normal`（`load` 时阈值来自 `report_format.thresholds`） |
| 指标行 | 每行的 `item, value, unit` 原样保留；`value` 是数字 |
| counts | `total` = 全部登记行；`abnormal` = flag 非 normal 的行数；`listed` = 报告里列出的行数 |
| 报告 | 四节名称与顺序照模板；每节字数 ≥ `min_chars` |
| 升级 | 每个异常行一条 `{record_id, item, value, message}`，`message` 逐字照抄 |
| 拒答 | 诊断式提问由平台兜底（你的 `reply` 会被替换、`citations` 置空） |

## 数据字典

| 文件 | 说明 |
|---|---|
| `cases/<case>/attachments/` | 三份附件（PDF / Word / 截图） |
| `cases/<case>/requests.jsonl` | 每轮：`{turn, message, attachments}` |
| `cases/<case>/report_format.json` | 四节模板、参考区间、固定话术 |
| `cases/<case>/kb/` | 知识库段落（可选用作出处） |
| `cases/<case>/expected.json` | 参考水平（每轮行数、拒答、升级、最终报告） |

## 交付格式

```json
{
  "turns": [ { "turn": 1, "reply": "…（≥10 字）", "counts": { "total": 5, "abnormal": 4, "listed": 5 },
               "citations": [ { "kind": "kb", "ref": "report_format.json" } ],
               "escalations": 4, "refusals": 0 } ],
  "report": { "sections": [ { "name": "目的", "content": "…" } ],
              "metric_rows": [ { "item": "PLT", "value": 18, "unit": "10^9/L", "flag": "low" } ],
              "counts": { "total": 5, "abnormal": 4, "listed": 4 } },
  "metrics": { "turns": 3, "total_rows": 5, "abnormal_rows": 4, "listed_rows": 4,
               "escalations": 8, "refusals": 1 },
  "figures": [ { "path": "figures/report_overview.png", "takeaway": "…（一句话）" } ],
  "notes": "…（≥60 字：为什么判断要写进 Skill、平台的解析帮了什么、至少一条局限）"
}
```

## 做完前自查

- [ ] 三份附件（含**图片**）的指标行都进了报告 —— 图片是平台走视觉读出来的，你只管用；
- [ ] `flag` 只有 low / high / normal 三种；
- [ ] 「只列异常」那一轮 `listed < total`；「忘掉」之后又回到 `total`；
- [ ] 越界行的升级条数与 `expected.json` 对得上，`message` 一字不差；
- [ ] 被要求"直接说是不是 XX 病"的那一轮是拒答（且不给引用）；
- [ ] 四节名称、顺序、篇幅达标；图有一张；`notes` 写了局限。

> 报告写进 `report.md`（模板在骨架里，六节照填），**不需要改 `SKILL.md`**。
