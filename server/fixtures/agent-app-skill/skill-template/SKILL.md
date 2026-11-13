---
name: lab-report-skill
description: 把检验附件整理成四节报告 + 指标表（含「只列异常」偏好与越界升级）；适用于"附件 → 报告"的业务流程，不适用于诊断结论。
---

# 检验数据 → 报告（你的 Skill）

平台已经提供了 agent（循环、记忆、工具、知识库、安全兜底）与附件解析。**你只写业务**：
`scripts/api.py` 的 `handle()` —— 判断、成文、守边界。

## 你要改的文件

```
skill-template/
├── SKILL.md               ← 能力边界（这一节平台不检查，但请如实写）
├── scripts/api.py         ← **只改这里**：handle()
├── run_case.py            ← 本地自测驱动（不用改）
├── platform_core.py       ← 平台 harness 的等价物（不用改，供本地自测）
├── report_format.json     ← 报告口径（四节 / 参考区间 / 话术）
└── report.md              ← 过程记录（六节照填）
```

## 能力边界

- 能处理：本实验约定形态的附件（未压缩内容流 PDF、标准 DOCX、PNG 截图；图片由平台走视觉读出）
- **不处理**：真实带压缩流/中文的 PDF、复杂表格版面、手写体
- **不承担**：诊断结论 —— 越界只提示复核，诊断式提问由平台兜底拒答

## 交付

`output.json`（`turns` / `report` / `metrics` / `figures` / `notes`）+ 一张图 + `report.md`。
在平台上提交这个 Skill 包后，回「我的应用」点「用我的 Skill 创建应用」即可得到可分享的应用。
