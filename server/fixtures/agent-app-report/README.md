# 入门实验：附件 → 报告（第 20 章 · easy 档）

> 课程《分子医学人工智能理论与实验》**第 20 章**（`order=20`）的**入门档**，
> 与同章「提高档」`agent-app-studio` 配套：这一档只做 **core**（附件 → 报告），
> **不要求前端、不要求发布**；想做成"能分享的小应用"再去做提高档。

## 为什么加这一档（2026-11-11 用户拍板）

提高档（`agent-app-studio`，hard）要同时做：三类附件解析 + 四节报告 + 记忆改变行集 + 安全边界 +
零依赖前端 + 发布分享。新手从第一分钟就面对全部要求，容易卡住。所以拆出这一档：

| | easy（本包） | hard（`agent-app-studio`） |
|---|---|---|
| 附件 | PDF / Word / 图片 → 指标行 | 同 |
| 报告 | 四节 + 指标表 + flag + 计数 | 同 |
| 记忆 / 安全 | — | 偏好改变行集、越界升级、拒答 |
| 前端 | — | 零依赖 `web/`，主题可改，**不许交模板** |
| 发布分享 | — | `publish_app.py` → 平台「我的应用」→ 分享链接 |
| 参考实现 | **随包下发**（先读后仿） | 不给（迁移检验，教师侧 `solution/`） |
| 断言 | 9 条 | 17 条 |

## 结构

```
agent-app-report/
├── problem/            → problem.zip（下发）
│   ├── manifest.json   9 条断言（flow=engineering）
│   ├── task.md         从这里开始 5 步 + 口径 + 交付格式 + 自查清单
│   ├── judge.md        语义判据（说清理由 / 不越界 / 正视局限）
│   ├── README.md       导学 + 排错
│   ├── cases/case0{1,2}/  attachments（pdf+docx+png）/ report_format / brief / expected
│   └── reference/      **参考实现（先读后仿）**：harness/api.py + harness/run.py + app_host.py
├── skill-template/     → skill-template.zip（起点：SKILL.md + report.md + 两个 TODO + 胶水 + 宿主）
├── tools/              造题说明（数据来自 agent-app-studio 的同一套样例）
└── README.md
```

## 实测（2026-11-11，`nju-lab-verify:0.2.0-rc.2-pkg6`）

| case | 附件（pdf/docx/image） | 指标行 total/abnormal | 说明 |
|---|---|---|---|
| case01 | 3（`report.pdf` / `metrics.docx` / `scan.png`） | 5 / 4 | 图片走视觉，抽出 `HGB 88 low` |
| case02 | 3（`lab.pdf` / `note.docx` / `photo.png`） | 5 / 4 | 图片抽出 `GLU 9.1 high` |

- `expected.json` 由 `problem/reference/harness/run.py --regen-expected` 生成（**同一镜像**）；
- 参考实现随包下发，学生可以"先读后仿"；`--check` 通过（9 条断言）。

## 平台口径（2026-11-11 起，两档一致）

- **成绩只看平台应用/报告**，不再要求把 Skill 包提交到「我的提交」；
- 第 19 / 20 章**不再跑自动复验**（`evalConfig` 已清空），成绩由教师按 rubric 评；
- 「我的应用」发布 + 分享链接是第 20 章的主交付（easy 档不涉及）。
