---
name: generic-agent
description: 一个通用 agent（循环 / 记忆 / 工具 / 知识库 / 边界 / 调度 skill）；换一批材料仍能跑，不绑定任何具体业务。
---

# 通用 agent（你的方案）

这一章你交付的是**运行时**，不是某个业务助手：它要能处理"任意一张记录表 + 一份规则文档 + 一批调用"，
并且**换一批材料仍然能跑**（两个样例来自不同领域就是来检验这件事的）。

## 你要改的文件

```
scripts/harness.py     ← 只改这里：循环 / 记忆 / 工具 / 检索 / 边界 / skill 路由
agent/api.py           ← 平台入口（发布成应用时用；下一章你交的是 Skill，那才是应用）
agent/profile.json     ← agent 的定制：名字 / 语气 / 签名 / 禁语（中性示例，可改成任意业务）
report.md              ← 过程记录（六节照填）
```

## 能力边界

- 能处理：本实验约定形态的材料（记录表 + 规则文档 + 工具名册 + 决策序列 + 限额 + `skills/`）
- **不处理**：具体业务口径（那是下一章 Skill 的事）、真实 MCP 服务、真实大模型（决策序列是桩）
- 已知失效情形：换一套指标名/阈值要改 `limits.json`；skill 的 `triggers` 写得太宽会误路由

## 交付

`output.json`（`harness` / `trace` / `tool_calls` / `memory` / `retrieval` / `answers` / `safety` /
`metrics` / `figures` / `notes`）+ 一张图 + `report.md` + 一份 `agent/profile.json`。
