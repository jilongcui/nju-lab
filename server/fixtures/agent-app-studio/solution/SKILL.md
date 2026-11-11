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

## 三个零依赖解析器

| 类型 | 实现 | 注意 |
|---|---|---|
| PDF | 找 `stream…endstream` → 正则抽 `(...) Tj` → 反转义 | 本实验的 PDF 是**未压缩内容流 + ASCII**（造题时就这么生成） |
| DOCX | `zipfile` 读 `word/document.xml` → 每个 `<w:p>` 拼 `<w:t>` | 不处理 `w:tbl`（表格不在口径里） |
| PNG | 读 `IHDR` 得宽高 | 不做像素识别 |

## 实测数值（2026-11-11，`nju-lab-verify:0.2.0-rc.2-pkg6`）

| case | 轮数/步数 | terminated | 工具 exec/rej | 指标行 total/abnormal/listed | 记忆 | web 哈希（vs 模板） |
|---|---|---|---|---|---|---|
| case01 | 3 / 13 | 全 `done` | 1 / 1 | 4 / 3 / **3** | active `MEM01` | `4fc2116779f23330` vs `f09358ec6ae858a5` |
| case02 | 3 / 12 | `done` / **`max_steps`** / `done` | 1 / 2 | 4 / 3 / **4** | forgotten `MEM01` | 同上 |

- case01 的偏好生效：`listed=3`（`HGB 142` 正常被过滤）；
- case02 的 T3 忘掉偏好：`listed=4`（`HGB 145` 正常重新列出）—— 这是"记忆真的改变输出"的行为性证据；
- case02 的 T2 故意给 6 步（`max_steps=5`）→ 记 `max_steps`。

## 运行

```sh
# 本地（仓库里跑两个 case）
python3 harness/run.py ../problem/cases/case01 ./output.json

# 复验环境：case 的输入文件**就在当前工作目录**（没有 cases/ 子目录），本 Skill 被复制到 skill/
python3 skill/harness/run.py . output.json

APP_DIR=. python3 app_host.py          # 浏览器里看：http://127.0.0.1:9200
```
