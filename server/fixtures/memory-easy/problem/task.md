# 入门实验：给随访助手加一张记忆表（记忆 · 容易）

> **流程归属（给引导用的提示）**：本实验是**工程实现型**——按题目口径写一段确定性代码、
> 用两个 case 逐字段核对，**没有"定基线 → 训练 → 评估指标"这些环节**。六步见下面「实验流程」，
> 第 3 步是"按口径写实现"，第 5 步是"边界用例自测"，不要拿机器学习的流程来带。

## 业务背景

随访助手要学会"记住"。记忆不是聊天记录，而是一张**记忆表**：每条记一件事，带**类别**和**状态**。
状态只有三种：

- `active` —— 现在有效，检索能取到；
- `superseded` —— 被更新过，**留着但不再命中**（要追溯"当时系统以为是什么"）；
- `forgotten` —— 已遗忘，也不再命中。

本章正文讲过四个操作：**写入 / 检索 / 更新 / 遗忘**。其中最容易被写错的是两个：
**更新不是删除**（旧条目要留成 `superseded`）、**遗忘只处理 `active`**（已作废的条目不重复处理）。

## 你的任务

读 case 目录里的两个文件，按顺序执行操作，把每一步之后的表、每次检索的结果、最终状态写进 `output.json`，
再画一张「每一步三种状态各有多少条」的堆叠柱状图。

| 文件 | 内容 |
|---|---|
| `memory_seed.json` | 初始记忆表（每条：`id, patient, fact, kind, status`） |
| `ops.jsonl` | 每行一个操作：`{"op":"store"|"update"|"forget"|"retrieve", ...}` |

**四个操作的口径（写死）**

1. **写入 `store`**：把 `item` **追加**到表末尾，不改任何旧条目；
2. **更新 `update`**：找到 `id` 对应条目 ——
   - 它必须是 `active`：把它的状态改成 `superseded`，再追加一条新条目
     `{id: "<旧id>v2", patient: 沿用, fact: 新的, kind: 沿用, status: "active"}`；
   - 它**不是** `active`（已作废/已遗忘）：**跳过**，表不变，也不要产生 `v2` 条目；
3. **遗忘 `forget`**：只把 `active` 的条目改成 `forgotten`；非 `active` 的不动；
4. **检索 `retrieve`**：取 `patient` 相同 **且** `status == "active"` **且** `kind` 在 `kinds` 里的条目，
   按 **`id` 升序**；未知患者返回空数组。

## 实验流程（六步）

| 步 | 做什么 | 产出 |
|---|---|---|
| ① 看清需求 | 三种状态的含义、update / forget 的边界 | 心里有数 |
| ② 看数据 | 种子里有几条、有没有已作废的、操作序列覆盖了哪四类 | 心里有数 |
| ③ 实现四操作 | 按口径逐个实现（注意"追加"而不是"覆盖"） | `snapshots` |
| ④ 每次检索 | 检索前先按 `status == "active"` 过滤 | `retrievals` |
| ⑤ 收尾核对 | 最终三种状态各几条、被遗忘的是否真的取不到 | `final` |
| ⑥ 写结论 | 更新与遗忘的差别、哪条边界最容易写错 | `report.md` |

## 交付格式

**`output.json`**（写在工作目录下）：

```json
{
  "snapshots": [
    { "step": 1, "op": "store", "rows": [{ "id": "M01", "status": "active" }] }
  ],
  "retrievals": [
    { "op_id": "o2", "patient": "P001", "kinds": ["过敏", "用药"], "ids": ["M02", "M03"] }
  ],
  "final": {
    "counts": { "active": 4, "superseded": 1, "forgotten": 1 },
    "rows": [{ "id": "M01", "patient": "P001", "fact": "……", "kind": "检验", "status": "active" }]
  },
  "figures": [{ "path": "figures/status_per_step.png", "takeaway": "……（一句话：更新是作废旧条，不是删掉）" }],
  "notes": "……（≥40 字：更新与遗忘的区别、哪条边界最容易错）"
}
```

- `snapshots` 每个操作一条，`step` 从 **1** 开始，`rows` 按表内顺序（追加顺序）；
- `retrievals` 只在 `op == retrieve` 时出现，`op_id` 用该操作的步号（`o2`、`o4`…）；
- `final.counts` **三个键都要有**（没有的记 0）。

## 怎么算完成（验收标准）

1. **两个 case 都跑通**：`snapshots` / `retrievals` / `final` 与 `cases/<case>/expected.json` **逐字段一致**；
2. **三条边界不能错**：
   - 更新一条已 `superseded` 的条目 → 表不变、**不能**出现 `M02v2`；
   - 遗忘一条已 `superseded` 的条目 → 仍保持 `superseded`，不能变成 `forgotten`；
   - 被遗忘（`forgotten`）的过敏记录，**后来的检索必须取不到**它；
3. 图能打开、`takeaway` 与 `final.counts` 自洽；
4. 结论与踩坑记下来——报告会由工具整理进 `report.md`，**不需要改 `SKILL.md`**。

判据全文见 `judge.md`。
