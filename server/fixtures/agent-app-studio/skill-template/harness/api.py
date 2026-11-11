"""你的 harness core（**只改这个文件**）。

`harness/run.py` 会把 case 目录里的材料喂给下面这几个函数，再把结果汇总成 `output.json`；
`app_host.py` 在平台上把同一套 core 包成 Web 应用（`/api/chat`）。所以**同一份代码**既能自测、也能上线。

口径全部在 `task.md` 里（哪一步做什么、字段怎么写）；这里只留结构与你该做的判断。

```python
state = load(app_dir)                     # 读 app.json / 主题 / 支持的附件类型
obs   = plan_step(state, step, ctx)       # 执行决策序列的一步，返回 observation
report = build_report(state, ctx)         # 按 report_format.json 成文
answer = build_answer(state, t, text, ctx)# 一轮的回复与出处
no     = refusal(state, t, text)          # 拒答话术（诊断式提问）
esc    = scan_safety(state, rows, fmt)    # 超出参考区间的行
```
"""
from __future__ import annotations

import json
from pathlib import Path


def load(app_dir: Path) -> dict:
    """读 `app.json`（标题、主题、入口、支持的附件类型、可见性），返回给宿主/胶水用的元信息。

    原理一句：应用元信息要**能被机器读**，否则"主题改过""支持 pdf"这些事只能靠人眼看。
    """
    raise NotImplementedError("TODO: 读 app.json 并返回 dict（字段见 task.md §一）")


def plan_step(state: dict, step: dict, ctx: dict) -> str:
    """执行决策序列的一步，返回写进 `trace.observation` 的字符串。

    四种 action 的口径见 task.md §二：
    - `recall`  → `记忆命中：<偏好条目 id 用逗号连；没有就 ->`
    - `parse`   → `解析 {文件名}：{行数} 行（{chars} 字）`，并把结果写进 `ctx["parsed"]` / `ctx["rows"]`
    - `tool`    → 调 `ctx["calls_by_id"]` 里那条调用：合法执行、非法写 `rejected:<reason>`
    - `kb`      → `检索命中：{ctx["kb_top"] 用逗号连}`
    - `finish`  → `完成`

    解析是这一章的核心：PDF 抽未压缩内容流里的 `Tj` 文本、DOCX 解 zip 读 `word/document.xml`、
    图片只登记尺寸。**不要引入第三方库**（环境里没有 `pypdf` / `python-docx`）。
    """
    raise NotImplementedError("TODO: 实现四种 action（task.md §二）")


def build_report(state: dict, ctx: dict) -> dict:
    """按 `ctx["formats"]` 生成报告：四节 + 指标表 + 计数。

    关键判断：**偏好记忆生效时只列异常行**（`ctx["preferences"]` 里有「报告只列异常指标」）。
    原理一句：报告要逐字段可复核 —— 节名与顺序照模板、指标表按登记顺序、flag 由参考区间判。
    """
    raise NotImplementedError("TODO: 实现报告（task.md §三）")


def build_answer(state: dict, turn: int, message: str, ctx: dict) -> dict:
    """一轮的 `{"reply", "citations"}`：reply ≥10 字且带出处，citations 用 `{"kind","ref"}`。"""
    raise NotImplementedError("TODO: 实现回复与出处（task.md §三）")


def refusal(state: dict, turn: int, message: str) -> dict:
    """诊断式提问的拒答：`{"turn", "reply", "reason"}`，reason ≥10 字。"""
    raise NotImplementedError("TODO: 实现拒答话术（task.md §五）")


def scan_safety(state: dict, rows: list[dict], fmt: dict) -> list[dict]:
    """返回超出参考区间的行：`{"record_id","item","value","message"}`（按登记顺序）。

    原理一句：**只升级不解释** —— 读数可能是测错的，助手不做判断。
    """
    raise NotImplementedError("TODO: 实现越界扫描（task.md §五）")
