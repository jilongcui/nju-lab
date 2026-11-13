"""你的 Skill（**只改这个文件**）。

平台（或本地自测的 `platform_core.py`）已经把附件解析成 `attachments[].rows`，
你只需要实现 `handle()`：**判断 → 成文 → 边界**。

    def handle(state, message, attachments, session):
        state["formats"]  # report_format.json（四节模板、参考区间、固定话术）
        state["memory"]   # 平台记下的偏好（例如"报告只列异常指标"）
        attachments       # [{"name","kind","via","rows":[{"item","value","unit"}]}]
        return {"reply", "report", "citations", "safety"}

口径见题目包 `task.md`；参考实现在 `problem/reference/`（先读后仿）。
"""
from __future__ import annotations


def flag_of(item: str, value: float, thresholds: dict) -> str:
    """参考区间 → flag：低于下限 low、高于上限 high、其余 normal。

    这个已经给好了（机械判断，不该占你时间）。
    """
    th = thresholds.get(item)
    if not th:
        return "normal"
    if value < th["low"]:
        return "low"
    if value > th["high"]:
        return "high"
    return "normal"


def handle(state, message, attachments, session):
    """TODO：把附件里的指标行整理成四节报告。

    步骤（对应 task.md 的"四件事"）：
    1. 收集 `attachments[].rows`，用 `flag_of()` 判 flag；没有新附件时用 `session["rows"]`；
    2. 看 `state["memory"]` 里有没有"报告只列异常指标" → 决定 `metric_rows` 是全部还是只列异常；
    3. 按 `state["formats"]["sections"]` 拼四节（名称、顺序、最小篇幅都要对）；
    4. 越界行进 `safety.escalations`（话术用 `formats.messages.warn`，一字不改）；
       诊断式提问交给平台兜底（你返回正常答复即可，平台会替换成拒答）。
    """
    raise NotImplementedError("TODO: 实现 handle（参考 problem/reference/scripts/api.py）")
