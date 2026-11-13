---
name: my-app
description: 我做的一个能对话的东西 —— 解决什么、什么时候该用、什么时候不适用，都写在这里。
---

# 我的应用（交付包说明）

这个文件描述你交付的东西。**代码要你自己写**，这里不提供任何示例实现。

## 交付形态（平台靠它把东西装起来）

```
SKILL.md             ← 这个文件（说清：解决什么问题、什么情况下不适用）
scripts/api.py       ← 你写的 Skill 入口，必须实现 handle()
<你的数据>            ← 你准备的材料，放包根
```

> 这是 **Skill**：平台的 agent 负责循环、会话与附件解析，它会在需要时调用你的 `handle()`。

**`platform_core.py` 是平台库，不是示例代码**（你没有实现的那部分）。它有两个用处：

- `platform_core.call_llm(messages, max_tokens=800)` —— 调模型。**应用容器里没有 key**，
  这个函数会自己走平台代理；在工作台里它回退成直连，所以同一份代码两边都能跑；
- 附件已经被平台解析好了：`attachments[].text` 是正文，`.rows` 是抽出来的数据行。

不想用就自己写（比如在工作台里直接读 `DEEPSEEK_API_KEY` 调 API）—— 随你。

入口约定：

```python
def handle(state, message, attachments, session) -> dict:
    """state / session 由平台给；返回 {"reply": str, "citations": list} 即可。"""
```

## 能力边界（自己填）

- 能答：
- **不能答**：
