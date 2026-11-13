---
name: my-app
description: 我做的一个能对话的东西 —— 解决什么、什么时候该用、什么时候不适用，都写在这里。
---

# 我的应用（交付包说明）

这个文件描述你交付的东西。**代码要你自己写**，这里不提供任何示例实现。

## 交付形态（平台靠它把东西装起来）

```
SKILL.md             ← 这个文件（说清：解决什么问题、什么情况下不适用）
agent/api.py         ← 你写的入口（或 scripts/api.py），必须实现 handle()
<你的数据>            ← 你准备的材料，放包根
```

入口约定：

```python
def handle(state, message, attachments, session) -> dict:
    """state / session 由平台给；返回 {"reply": str, "citations": list} 即可。"""
```

## 能力边界（自己填）

- 能答：
- **不能答**：
