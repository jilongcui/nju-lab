"""参考 Skill：附件（已由平台解析）→ 四节报告 + 指标表 + 越界升级。

只依赖 `handle(state, message, attachments, session)` 这个平台契约，不碰 HTTP、不碰前端。
"""
from __future__ import annotations


def flag_of(item: str, value: float, thresholds: dict) -> str:
    th = thresholds.get(item)
    if not th:
        return "normal"
    if value < th["low"]:
        return "low"
    if value > th["high"]:
        return "high"
    return "normal"


def handle(state, message, attachments, session):
    fmt = state.get("formats") or {}
    thresholds = fmt.get("thresholds") or {}
    warn = (fmt.get("messages") or {}).get("warn", "请尽快由临床医生复核。")

    rows = []
    for att in attachments:
        for row in att.get("rows") or []:
            item, value, unit = row["item"], float(row["value"]), row["unit"]
            rows.append({"item": item, "value": value, "unit": unit,
                         "flag": flag_of(item, value, thresholds)})
    if not rows:
        rows = session.setdefault("rows", [])
    else:
        session["rows"] = rows

    only_abnormal = any("只列异常" in (m.get("fact") or "") for m in state.get("memory") or [])
    abnormal = [r for r in rows if r["flag"] != "normal"]
    listed = abnormal if only_abnormal else rows

    detail = "，".join(f"{r['item']}={r['value']:g}({r['flag']})" for r in listed) or "无"
    texts = {
        "目的": f"把本次上传的 {len(attachments)} 份附件里的检验指标整理成可复核的报告。",
        "方法": "指标表逐行登记 item / value / unit / flag；flag 由 report_format 的参考区间判定。",
        "结果": f"共登记 {len(rows)} 行，其中异常 {len(abnormal)} 行：{detail}。",
        "讨论": "超出参考区间的指标需要临床复核；本报告只汇总数值与出处，不下诊断结论。",
    }
    sections = []
    for spec in fmt.get("sections", []):
        name = spec["name"]
        content = texts.get(name, "")
        while len(content) < spec.get("min_chars", 0):
            content += "（补充说明见指标表与附件原文。）"
        sections.append({"name": name, "content": content})

    escalations = [
        {"record_id": f"ROW{i:02d}", "item": r["item"], "value": r["value"], "message": warn}
        for i, r in enumerate(rows, start=1) if r["flag"] != "normal"
    ]
    reply = (f"已整理：共 {len(rows)} 行，{len(abnormal)} 行超出参考区间"
             + ("（按你的偏好只列异常项）。" if only_abnormal else "。"))
    return {
        "reply": reply,
        "report": {
            "template_used": "report_format.json",
            "sections": sections,
            "metric_rows": listed,
            "counts": {"total": len(rows), "abnormal": len(abnormal), "listed": len(listed)},
        },
        "citations": [{"kind": "kb", "ref": "report_format.json"}],
        "safety": {"escalations": escalations, "refusals": []},
    }
