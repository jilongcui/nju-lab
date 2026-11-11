---
name: harness-agent-solution
description: 教师侧解答样例（不下发）：随访助手 harness 的完整实现，用于证明题目可解与判据不误杀。
---

# 随访助手 harness（教师侧解答样例）

> ⚠️ **本目录不随题目包下发**（`solution/` 与 `problem/` 平级，打包命令 `(cd problem && zip …)`
> 永远不会带上它）。它的两个用途：
> 1. **题目可解**：`docker run … --skill /p/solution --problem /p/problem.zip` 应 2/2 通过；
> 2. **判据不误杀**：`problem/cases/*/expected.json` 由它算出（口径钉死 ⇒ 结果唯一确定）。

## 六个部件与代码位置

| 部件 | 函数 | 要点 |
|---|---|---|
| 检索 | `bm25_rank` / `tf_cosine_rank` | 字符 2-gram；BM25 做长度归一，余弦**不做** —— 对照的差距就是这么来的 |
| 工具 | `validate_call` / `mock_execute` | 四级参数校验（`-32601` / `-32602`）+ 一级业务校验（`not_out_of_range`） |
| 记忆 | `fact_pair` / `new_entry` + 主流程里的更新段 | 写入 / 更正（`superseded`）/ 遗忘（`forgotten`）/ 应用 |
| 循环 | 主流程里的 `for index, step in enumerate(steps[:max_steps])` | 四种 action + 每步 observation + `max_steps` 截断 |
| 安全 | 主流程里的 `refusals` 与 `escalations` | 越界逐行升级（固定话术）、诊断式提问拒答 |
| 答案 | 主流程里的 `answers.append(...)` | 非拒答轮带一条 `kb` 出处 |

## 实测数值（2026-11-11，`nju-lab-verify:0.2.0-rc.2-pkg6`）

| case | 轮数 | 总步数 | terminated | 工具 executed/rejected | 记忆 | 检索 top3 不同的轮次 | trace_checksum |
|---|---|---|---|---|---|---|---|
| case01 | 5 | 23 | 全 `done` | 4 / 4 | active `MEM02`、superseded `MEM01` | `[1,2,3,4]` | `106c1be2c1b6` |
| case02 | 3 | 12 | `done` / **`max_steps`** / `done` | 5 / 2 | forgotten `MEM01` | `[1,3]` | `ed407ae57a69` |

- case01 失败分布：`not_out_of_range` 1 / `type_mismatch` 1 / `unknown_tool` 1 / `missing_required` 1；
- case02 的**第 2 轮故意给 6 步**（`max_steps=4`）—— 用来考"到点就停并把原因如实写出来"；
- case02 的 `top3_diff_turns=[1,3]`：TF 余弦把最长的综述 `KB-04` 顶到第一位，BM25 因为长度归一没被带走。

## 运行

```sh
# 单 case
python3 scripts/harness.py ../problem/cases/case01 ./output.json

# 重算 expected（**必须与复验同一个镜像**）
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/w" --entrypoint python3 \
  nju-lab-verify:0.2.0-rc.2-pkg6 /w/scripts/harness.py --regen-expected
```
