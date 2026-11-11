# 智能体 Harness（第 19 章 · 升级版 · 迁移检验）

> 课程《分子医学人工智能理论与实验》**第 19 章《智能体综合实践》**
> （chapter id `8fb368bb-e56a-4cd5-8e93-c0761792ec99`）。
>
> **2026-11-11 升级**：原来的 `learning-assistant`（四环闭环）换成这一版 —— 从"把几件事拼起来"
> 提升到"自己实现 harness 的六个部件"：**循环 / 记忆分层 / 工具（MCP 风格）/ 知识库检索 /
> 安全边界 / 答案与出处**。原项目下架保留（数据与实测记录都在，可回滚）。
>
> 设计与里程碑见 [`docs/PLAN-2026-11-final-chapter-harness.md`](../../../docs/PLAN-2026-11-final-chapter-harness.md)。

## 结构

```
harness-agent/
├── problem/            → problem.zip        题目包（下发给学生；**没有 reference/**）
│   ├── manifest.json   IO 契约（outputFile=output.json、flow=engineering）+ 14 条断言
│   ├── task.md         需求 + 六步流程 + 六个部件的口径 + 交付格式
│   ├── judge.md        语义判据（理由说清 / 检索≠结论 / 安全边界 / 局限）
│   ├── README.md       导学 + 排错表
│   └── cases/case0N/   七份输入（dialogue / records / tools / tool_calls / plan_stub / limits / kb/）
│                       + expected.json
├── skill-template/     → skill-template.zip 学生起点（SKILL.md + report.md + scripts/harness.py 骨架）
├── solution/           ⚠️ 教师侧解答样例（不下发、不打进任何 ZIP）—— 用于复验与标定 expected
├── tools/gen_data.py   造题工具（不下发）
└── README.md
```

## 场景与口径（为什么这样出题）

随访助手要听懂"帮我看下 P001 最近的血小板计数"，自己走完一轮又一轮。**难的不是接模型，
而是包在模型外面的那一层**：谁执行、谁记账、谁记住、谁拦住。

所以题目把"模型"变成**桩**：`plan_stub.json` 给每轮的决策序列（`recall` / `tool` / `kb` / `finish`），
harness 必须真的循环、每步记 `observation`、尊重 `max_steps`。
**输入全部写死 ⇒ 逐字段可比**（沿用 `attention-ablation` 的经验），判分不依赖模型随机输出。

| 部件 | 口径要点 | 判据落点 |
|---|---|---|
| 循环 | 四种 action 的 `observation` 文案逐字钉死；`max_steps` 是**每轮**上限 | `trace` 逐步一致 + `harness.terminated` |
| 工具 | 四级参数校验（`-32601` / `-32602`）+ 业务校验 `not_out_of_range` | 逐条 `[call_id, tool, args_valid, status, error_code, rejected_reason, result_summary]` |
| 记忆 | 写入 / 更正（`superseded`）/ 遗忘（`forgotten`）/ 应用；**含「更正：」的轮不记应用** | 三态条目 + `memory.applied` |
| 检索 | 字符 2-gram + BM25（k1=1.5 / b=0.75）；对照是 TF 余弦（**不做 idf、不做长度归一**） | 逐轮 `bm25_top3` / `cosine_top3` + `top3_diff_turns` |
| 安全 | 越界逐行升级（固定话术逐字）+ 诊断式提问拒答 | `safety.escalations` / `refusals` |
| 出处 | 非拒答轮 `answer` 含 `bm25_top3[0]`，`citations` 一条 `{"kind":"kb","ref"}` | `answers[].citations` |

**防退化两端**：

| 偷懒解 | 被哪条拦住 |
|---|---|
| 不实现循环，直接把 `steps` 当结论抄进 `answers` | "循环真的发生了"（`trace` 非空）+ "终止条件正确" |
| 检索只用 TF 余弦（不做长度归一） | `bm25_top3` 逐轮比对 + `top3_diff_turns` |
| `escalate_value` 一律执行成功 | `not_out_of_range` 计数 ≥1 且必须 rejected |

## 出题时的实测依据（2026-11-11，`nju-lab-verify:0.2.0-rc.2-pkg6`）

| case | 轮数 | 总步数 | `terminated` | 工具 executed/rejected | 记忆三态 | top3 不同的轮次 | `trace_checksum` |
|---|---|---|---|---|---|---|---|
| case01 | 5 | 23 | 全 `done` | 4 / 4 | 1 / 1 / 0 | `[1,2,3,4]` | `106c1be2c1b6` |
| case02 | 3 | 12 | `done` / **`max_steps`** / `done` | 5 / 2 | 0 / 0 / 1 | `[1,3]` | `ed407ae57a69` |

- 两个 case 合起来覆盖四类失败：`unknown_tool` / `missing_required` / `type_mismatch` / `not_out_of_range`；
- case02 第 2 轮**故意给 6 步**（`max_steps=4`）→ 专考"到点就停并把原因写出来"；
- case02 的 `top3_diff_turns=[1,3]` 由语料结构保证：最长的综述 `KB-04` 在 TF 余弦下被顶到第一，
  BM25 因为长度归一没被带走 —— 造数据时就把两端都量过。

## 自检与复验

```sh
cd server/fixtures/harness-agent
rm -f problem.zip skill-template.zip
(cd problem && zip -qr ../problem.zip .) && (cd skill-template && zip -qr ../skill-template.zip .)
docker run --rm -v "$PWD:/p:ro" nju-lab-verify:0.2.0-rc.2-pkg6 \
  --check --skill /p/skill-template.zip --problem /p/problem.zip

cd /home/ubuntu/nju-lab && mkdir -p .verify-scratch/out
docker run --rm --env-file server/.env --memory 2g -e VERIFY_REASONING_EFFORT=low -e VERIFY_MAX_CASES=0 \
  -v "$PWD/server/fixtures/harness-agent:/p:ro" -v "$PWD/.verify-scratch/out:/outputs" \
  nju-lab-verify:0.2.0-rc.2-pkg6 --skill /p/solution --problem /p/problem.zip \
  --out /outputs/harness-agent.json --timeout-ms 300000
```

实测（2026-11-11）：`--check` 退出码 0（14 条断言、依赖齐）；复验 **2/2 通过**
（case01 `score=1.0`、case02 `score=0.95`，两 case 硬性 **14/14**）。

## 项目字段文案（建项目时用）

- **title**：应用实验：给随访助手写一个 harness（循环 / 记忆分层 / 工具 / 知识库）
- **difficulty**：`medium`
- **content**（学生详情页首屏）：
  > 随访助手要能听懂"看一下这个病人的血小板计数"，自己查记录、查指南、必要时报警。
  > 这一章不接大模型，而是让你写**包在模型外面的那一层**：循环、记忆三层、工具校验、
  > 知识库检索、安全边界。交一份 `output.json` 与一张图。
- **objectives**：看懂 harness 与模型的分工；把"每步观测"落成可核对的 `trace`；
  用状态机管理记忆的写入/更正/遗忘；按 MCP 风格给工具错误码；用 BM25 与对照说明检索取舍。
- **background**：正文第 19 章（四模块 + 三阶段）在实验里换成本地等价物：
  `mem0` → 本地条目表、MCP 服务 → 本地 mock 工具、LangChain-LangGraph → 自己的编排脚本。
- **description**：六步流程；③ 搭六个部件 ④ 逐轮核对 ⑤ 边界自测（截断轮 / 遗忘条目 / 要求升级 / 要求诊断）。
- **evalConfig**：`{model: "deepseek-flash", reasoningEffort: "low", timeoutSeconds: 600}`
- **rubric**：复验通过率 50 / 边界与踩坑记录 30 / 语义判据 20
