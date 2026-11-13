---
name: equipment-agent
description: 设备维护助手 —— 能对话地回答"这台设备该不该保养、手册怎么要求"。具体怎么做由实现者决定。
---

# 设备维护助手（你的包）

这个文件是你交付包的说明；**代码要你自己写**。

## 交付形态（平台靠它把东西装起来）

```
SKILL.md             ← 这个文件
agent/api.py         ← 你写的入口，必须实现 handle()
assets.csv           ← 台账（从题目包拷）
kb/                  ← 维护手册（从题目包拷）
limits.json          ← 周期与基准日（从题目包拷）
tools.json           ← 工具名册（从题目包拷；用不用随你）
```

入口约定：

```python
def handle(state, message, attachments, session) -> dict:
    """state / session 由平台给；返回 {"reply": str, "citations": list} 即可。"""
```

## 能力边界

- 能答：台账查询、保养周期与逾期、手册条款
- **不能答**：设备剩余寿命、能不能继续用 —— 必须拒答，并把话题引回可查的内容（见 `KB-05`）
