---
name: agent-app-studio-solution
description: 教师侧解答样例（不下发）：可分享智能体应用的完整 core + 改过的前端，用于证明题目可解与判据不误杀。
---

# 可分享的智能体应用（教师侧解答样例）

> ⚠️ **不随题目包下发**：`solution/` 与 `problem/` 平级，`(cd problem && zip …)` 永远带不上它。

## 结构

| 文件 | 作用 |
|---|---|
| `harness/api.py` | 六个函数：`load` / `plan_step` / `build_report` / `build_answer` / `refusal` / `scan_safety` |
| `harness/run.py` | 胶水（与题目包下发的**逐字节相同**），`--regen-expected` 也在这里 |
| `app_host.py` | 应用宿主（与题目包下发的**逐字节相同**） |
| `web/` | **改过的前端**：主色换成 `#1f9d78`、标题改成「门诊数据整理助手」、加了「下载报告 JSON」 |
| `app.json` | 元信息（`theme.accent=#1f9d78`，与 `theme.css` 一致） |

## 三种附件、两条通道

| 类型 | 实现 | 通道 |
|---|---|---|
| PDF | 找 `stream…endstream` → 正则抽 `(...) Tj` → 反转义（**零依赖**） | `text` |
| DOCX | `zipfile` 读 `word/document.xml` → 每个 `<w:p>` 拼 `<w:t>`（**零依赖**） | `text` |
| 图片 | 调 `deepseek-flash` 的 `image_url`（data URI）读图 → 容错正则抽成 `item,value,unit` | `vision` |

> 视觉调用实测口径：`temperature=0`、`reasoning_effort="none"`、`max_tokens=800`。
> **原始输出格式会漂**（`PLT, 18, …` / `PLT,18,…`），所以 `checksum` 只对**结构化行**算 —— 实测 3/3 一致。

## 实测数值（2026-11-11 二次实测：图片走视觉，`nju-lab-verify:0.2.0-rc.2-pkg6`）

| case | 轮数/步数 | terminated | 工具 exec/rej | 指标行 total/abnormal/listed | 视觉 | 记忆 | web 哈希（vs 模板） |
|---|---|---|---|---|---|---|---|
| case01 | 3 / 13 | 全 `done` | 1 / 1 | 5 / 4 / **4** | `scan.png` 1 行（`c482e7ae14a4`） | active `MEM01` | `4fc2116779f23330` vs `f09358ec6ae858a5` |
| case02 | 3 / 12 | `done` / **`max_steps`** / `done` | 1 / 2 | 5 / 4 / **5** | `photo.png` 1 行（`e9cf731d3940`） | forgotten `MEM01` | 同上 |

- 图片行真的进了指标表：case01 的 `HGB 88`（low）、case02 的 `GLU 9.1`（high）；
- case01 的偏好生效：`listed=4`（`HGB 142` 正常被过滤）；
- case02 的 T3 忘掉偏好：`listed=5`（`HGB 145` 正常重新列出）—— 记忆真的改变输出的行为性证据；
- case02 的 T2 故意给 6 步（`max_steps=5`）→ 记 `max_steps`；
- 视觉稳定性：同一张图连跑 3 次，图片 `checksum` 与 `trace_checksum` **完全一致**。

## 运行（**复验只需要这一条命令**）

```sh
# 当前工作目录里就是 case 的输入文件（dialogue.jsonl / records.csv / kb/ …）
python3 skill/harness/run.py . output.json
```

- **不要改 `harness/` 下的任何文件**（`run.py` 是胶水、`api.py` 是参考实现）：判据是逐字段比对，
  自己重写实现几乎一定会在某处偏一位（2026-11-11 实测：一次 `NameError` 让复验 agent 转而自己实现，
  case01 检索 top3 偏一位 → 16/17）。
- 跑完**必须确认当前目录出现 `output.json`**（判据只认它）；同时会生成 `figures/app_report_overview.png`。
- 本地想看两个 case：

```sh
python3 harness/run.py ../problem/cases/case01 /tmp/c1.json
python3 harness/run.py ../problem/cases/case02 /tmp/c2.json
```

