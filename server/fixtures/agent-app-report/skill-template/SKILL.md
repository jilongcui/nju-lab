---
name: agent-app-report
description: 把检验附件（PDF / Word / 截图）整理成一份能复核的报告；适用于"附件 → 结构化指标 → 报告"，不适用于诊断结论与真实 PDF 全格式解析。
---

# 附件 → 报告（你的方案 · 入门档）

这一档只做一件事：**把三份附件读成结构化的指标行，按口径出报告**。
不要求前端、不要求发布 —— 那是同章「提高档」的事。

## 你要改的文件

```
harness/api.py     ← 只改这里：parse_attachment() 与 build_report() 两个 TODO
harness/run.py     ← 胶水（不用改）
app_host.py        ← 宿主（不用改；图片视觉调用由它负责）
```

## 能力边界

- 能处理：本实验约定形态的附件（未压缩内容流的 PDF、标准 DOCX、PNG 截图）与 `report_format.json` 那套模板；
- **不处理**：真实世界里带压缩流 / 中文字体的 PDF、扫描件 OCR、复杂表格版面；
- **不承担**：诊断结论 —— 超出参考区间只提示复核。

## 交付

`output.json`（`attachments` / `report` / `metrics` / `figures` / `notes`）+ 一张图 + `report.md`。
口径见题目包 `task.md`，参考实现在 `problem/reference/`（先读后仿）。
