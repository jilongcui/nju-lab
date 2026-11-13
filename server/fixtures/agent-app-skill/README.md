# 应用实践：写一个 Skill，把检验数据整理成能分享的报告（第 20 章 · medium）

> 课程《分子医学人工智能理论与实验》**第 20 章**（`order=20`）。
> **2026-11-13 重构**：按用户口径 —— 第 19 章学生做 **agent**（到此为止）；
> 第 20 章基于它**构建 Skill** 完成具体业务流程；**"变成可分享的应用"由平台负责**。
> 旧的 `agent-app-studio`（要求改前端 + 跑 publish）与 `agent-app-report`（写 core 函数）已**下架**。

## 分工（本章的核心）

| 谁 | 负责什么 |
|---|---|
| **平台**（`server/apps-image/platform/`） | agent 运行时（循环/记忆/工具/知识库/安全兜底）、附件解析（PDF/Word/**图片走视觉**）、托管与发布、分享链接、教师管理 |
| **学生**（本实验） | **Skill**：`SKILL.md` + `scripts/api.py` 的 `handle()` —— 业务判断与成文 |

学生不写 core、不写前端、不跑打包发布命令。

## 结构

```
agent-app-skill/
├── problem/            → problem.zip（下发）
│   ├── manifest.json   10 条断言（flow=engineering）
│   ├── task.md         从这里开始 5 步 + handle 四件事 + 口径 + 自查
│   ├── judge.md        语义判据
│   ├── README.md       导学 + 排错
│   ├── cases/case0{1,2}/  attachments（pdf+docx+png）/ requests.jsonl / report_format / kb / brief / expected
│   └── reference/      **参考 Skill（先读后仿）**：SKILL.md + scripts/api.py + run_case.py + platform_core.py
├── skill-template/     → 学生起点：SKILL.md + scripts/api.py（handle TODO）+ run_case.py + platform_core.py + report.md
└── README.md
```

## 实测（2026-11-13，`nju-lab-verify:0.2.0-rc.2-pkg6`）

| case | 轮数 | 每轮 listed | 拒答 | 升级 | 说明 |
|---|---|---|---|---|---|
| case01 | 3 | 5 / **4** / 4 | 1 | 4 / 4 / 0 | 第 2 轮说「报告只列异常指标」→ 行集由 5 降到 4 |
| case02 | 3 | **4** / 5 / 5 | 1 | 4 / 4 / 0 | 第 1 轮就带偏好（4），第 2 轮「忘掉 MEM01」→ 恢复 5 |

- 三份附件由**平台**解析：PDF/DOCX 自解，图片走视觉（`HGB 88 low` / `GLU 9.1 high`）；
- `expected.json` 由 `problem/reference/run_case.py --regen-expected` 生成（**同一镜像**）；
- `--check` 通过（10 条断言）。

## 平台侧（已实现并实测）

- 镜像 `nju-lab-app-runtime:0.2.0` 内置平台 harness；`entrypoint` 认两种产物形态（skill 模式 / 完整产物模式）；
- `POST /api/apps/from-submission`：取本人已提交的 Skill 包 → 装成应用 → 自动发布 → 返回 `shareKey`；
- 前端「我的应用」→「**用我的 Skill 创建应用**」；
- 端到端实测：提交 → 一键建应用 → 匿名分享页 200 → 匿名对话带三份附件 → `5 行 / 4 异常` + 升级。

## 平台字段文案（建项目时用）

- **title**：应用实践：写一个 Skill，把检验数据整理成能分享的报告
- **difficulty**：`medium`
- **rubric**：业务口径正确 40 / 边界守得住 30 / 应用可用 30
- **unlockRule**：`{type:"none"}`（收官章不锁）
