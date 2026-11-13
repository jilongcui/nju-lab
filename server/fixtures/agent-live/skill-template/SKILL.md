---
name: equipment-agent
description: 一个能跑的设备维护助手 —— 自己调模型、自己决定下一步、自己调工具、自己记住用户说过的话；换一份台账与手册仍然能跑。
---

# 设备维护助手（你的 agent）

这一章你交付的是**一个真的在跑的 agent**：模型决定下一步，代码负责执行、记账、记住、拦住。

## 你要改的文件

```
agent/loop.py      ← 循环（核心）：问模型 → 解析动作 → 执行 → 观察 → 再问
agent/tools.py     ← 三个工具：query_assets / overdue_assets / search_manual（真读文件）
agent/memory.py    ← 跨轮记忆：写入 / 应用 / 更正
notes.md           ← 取舍与局限（≥80 字，进 output.json 的 notes）
report.md          ← 过程记录
```

**已经给好、不用改**：

```
agent/llm.py       ← 模型客户端：重试、token 记账、调用日志
agent/data.py      ← 读题目包：台账 / 手册 / 限额 / 工具名册
agent/profile.json ← 定制：名字 / 语气 / 签名 / 禁语
scripts/run.py     ← 跑完 6 组对话 → output.json + 图
```

## 能力边界

- 能做：本实验约定形态的材料（`assets.csv` + `kb/*.md` + `tasks/*.jsonl` + `limits.json`）；
  换取一份同结构的台账/手册仍能跑（工具是读文件的，不是写死的）
- 不做：真实设备协议、现场传感器接入、剩余寿命判定（`KB-05` 明确禁止远程下结论）
- 已知失效：台账列名一变就要改 `data.py` 的解析；手册段落过长时 BM25 风格的检索会被长文档带走

## 交付

`output.json`（`agent` / `llm` / `dialogues` / `metrics` / `figures` / `notes`）+ 一张图 + `report.md`。
