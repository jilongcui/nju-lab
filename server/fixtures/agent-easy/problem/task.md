# 入门实验：写一个四环随访助手（智能体 · 容易）

## 业务背景

社区卫生站有几位长期随访的糖尿病患者。护士每天要做三样活：**看数据**（检验值、在用什么药）、
**做判断**（这次该不该提醒、提醒到什么程度）、**动手**（发出消息、把这次沟通记下来）。

现在把这件事交给一个**规则版智能体**：它要能听懂一句"帮我看下 P001 这次要不要复查"，
自己走完 **感知 → 决策 → 行动 → 记忆** 四环。本章正文讲过，四环里只有"决策"用到模型才叫智能体；
这个入门实验先**全部用规则实现**，目的是让你亲手看清每一环到底在干什么、数据怎么流动。

数据就在 case 目录里：

| 文件 | 内容 |
|---|---|
| `patients.csv` | `patient_id,name,hba1c,last_visit,drugs`（case01 5 人 / case02 4 人） |
| `requests.txt` | 每行一句请求（case01 6 条 / case02 5 条） |
| `memory_seed.json` | 运行前的记忆（case01 为空；case02 里已有 P001 的接触记录） |

## 你的任务

实现四个函数（`perceive` / `decide` / `act` / `remember`），把每一环的结果写进 `output.json`，
再画一张「各类动作的条数」柱状图。**口径全部写死，不要自己发挥**——顺序和字段都算分。

**① 感知（perceive）**

- 在请求文本里找**第一个**形如 `P` + 三位数字的子串作为患者号；找不到记 `null`；
- 文本里含"复查"→ `intent = "复查"`，否则 `intent = "一般咨询"`。

**② 决策（decide）**：今天固定为 `2026-10-01`；`days_since_visit = 2026-10-01 减 last_visit 的天数`。
按**从上到下第一个命中**的规则取动作：

| 顺序 | 条件 | action |
|---|---|---|
| 1 | 请求里没有患者号 | `invalid_request` |
| 2 | 患者号不在 `patients.csv` 里 | `unknown_patient` |
| 3 | `hba1c >= 9.0` | `urgent` |
| 4 | `days_since_visit >= 90` **且** `hba1c >= 7.0` | `recall` |
| 5 | `days_since_visit >= 180` | `annual` |
| 6 | 其余 | `none` |

**③ 行动（act）**：消息模板**逐字**照抄，只替换尖括号里的值：

- 正常决策：`[<action>] <name>：上次联系 <last_contact>，HbA1c <hba1c>。`
- 无患者号：`[invalid_request] 请求里没有患者号：<请求原文>`
- 患者不存在：`[unknown_patient] 未找到患者 <pid>`

`last_contact` 取**处理本条请求之前**的记忆里的值，没有记录就写 `未联系`。

**④ 记忆（remember）**：只有正常决策才写记忆：
`memory[pid] = {"last_contact": "2026-10-01", "last_action": <action>}`。
`invalid_request` / `unknown_patient` **不写记忆**。

## 实验流程（六步）

| 步 | 做什么 | 产出 |
|---|---|---|
| ① 看清需求 | 六条决策规则的**先后顺序**、消息模板、记忆写不写的边界 | 心里有数 |
| ② 看数据 | 几位患者、各自 hba1c 与上次复查日、请求里有哪些坑（无患者号 / 患者不存在） | 心里有数 |
| ③ 写感知 | 取患者号 + 判断意图 | `perceive` |
| ④ 写决策与行动 | 按优先级出动作、按模板出消息 | `decisions` / `messages` |
| ⑤ 写记忆 | 同一次运行里第二条 P001 应该能读到第一条写下的时间 | `memory_after` |
| ⑥ 写结论 | 说清哪一环最容易错、哪一环值得换成模型 | `report.md` |

## 交付格式

**`output.json`**（写在工作目录下）：

```json
{
  "perceive": [{ "req_id": "r1", "pid": "P001", "intent": "复查" }],
  "decisions": [{ "req_id": "r1", "pid": "P001", "action": "recall", "days_since_visit": 108 }],
  "messages": [{ "req_id": "r1", "text": "[recall] 张阿姨：上次联系 未联系，HbA1c 8.2。" }],
  "memory_after": { "P001": { "last_contact": "2026-10-01", "last_action": "recall" } },
  "counts": { "recall": 1, "urgent": 1, "annual": 1, "none": 1, "unknown_patient": 1, "invalid_request": 1 },
  "figures": [{ "path": "figures/actions.png", "takeaway": "……（一句话：哪类动作最多）" }],
  "notes": "……（≥40 字：六条规则里哪条最容易写错、记忆为什么要在同一次运行内生效）"
}
```

- 数组**按请求顺序**（`r1`、`r2`…），`decisions` 里的 `days_since_visit` 是**数字**或 `null`；
- `counts` 里**出现过的动作都要有键**；
- 图至少 1 张，`path` 与实际落点一致。

## 怎么算完成（验收标准）

1. **两个 case 都跑通**：`perceive` / `decisions` / `messages` / `memory_after` / `counts`
   与 `cases/<case>/expected.json` **逐字段一致**；
2. **边界不能错**：`invalid_request`、`unknown_patient` 两条**没有写进 `memory_after`**；
   case02 里第二条 P001 的"上次联系"应是 `2026-10-01`（第一条写下的），不是种子里的 `2026-08-01`；
3. 图能打开、`takeaway` 与 `counts` 自洽；
4. 结论与踩坑记下来——报告会由工具整理进 `report.md`，**不需要改 `SKILL.md`**。

判据全文见 `judge.md`。
