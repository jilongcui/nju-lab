"""**发布成应用时的入口**（第 19 章的收尾）。

`scripts/harness.py` 是"用 case 驱动"的完整 agent（判据看它）；这个文件是**平台调用**的适配器：
平台把一轮请求交给它（附件已解析、知识库已给），它用同一套部件回应。

    handle(state, message, attachments, session) -> {"reply", "report", "citations", "safety"}

平台侧（`server/apps-image/platform/`）负责：静态页、上传、会话持久化、模型代理、诊断式提问兜底。
你只管：**路由 skill → 用工具/知识库/记忆 → 成文 → 守边界**。
"""
from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "scripts"))
import harness  # noqa: E402  （复用 agent 的部件：校验 / mock 执行 / 检索 / 越界扫描）


def load_local_skills() -> list[dict]:
    return harness.load_skills(HERE.parent)


SKILLS = load_local_skills()


def rows_to_records(attachments: list[dict]) -> list[dict]:
    """把平台解析好的附件行转成 agent 内部的"检验记录"。"""
    records = []
    for att in attachments:
        for i, row in enumerate(att.get("rows") or [], start=1):
            records.append({
                "record_id": f"R{len(records) + 1:02d}",
                "patient_id": "P001",
                "item": row["item"],
                "value": float(row["value"]),
                "unit": row["unit"],
            })
    return records


def handle(state, message, attachments, session):
    records = rows_to_records(attachments)
    if records:
        session["rows"] = records
    records = session.get("rows") or []

    # ① 路由：先决定"该不该用某个 skill"（不中就不硬凑）
    skill_name = harness.route_skill(message, SKILLS)
    if skill_name:
        skill = next(s for s in SKILLS if s["name"] == skill_name)
        spec = harness  # 复用 loader
        import importlib.util
        module_spec = importlib.util.spec_from_file_location(f"skill_{skill_name}", skill["api"])
        module = importlib.util.module_from_spec(module_spec)
        module_spec.loader.exec_module(module)  # type: ignore[union-attr]
        out = module.handle(state, message, attachments, session) or {}
        return {
            "reply": out.get("reply", f"已交给 skill {skill_name} 处理。"),
            "report": out.get("report"),
            "citations": out.get("citations", []),
            "safety": out.get("safety", {"escalations": [], "refusals": []}),
        }

    # ② 没有命中 skill：走 agent 自己的部件（检索 + 越界扫描 + 记忆）
    kb = state.get("kb") or {}
    bm25_top = harness.bm25_rank(message, kb, int((state.get("limits") or {}).get("top_k", 3))) if kb else []
    warn = ((state.get("formats") or {}).get("messages") or {}).get("warn",
                                                                   "该指标超出参考范围，请尽快由临床医生复核。")
    thresholds = ((state.get("formats") or {}).get("thresholds") or {})
    escalations = []
    for i, row in enumerate(records, start=1):
        flag = "normal"
        th = thresholds.get(row["item"])
        if th:
            flag = "low" if row["value"] < th["low"] else "high" if row["value"] > th["high"] else "normal"
        if flag != "normal":
            escalations.append({"record_id": row["record_id"], "item": row["item"],
                                "value": row["value"], "message": warn})
    memory = [m.get("fact") for m in (state.get("memory") or [])]
    top1 = bm25_top[0] if bm25_top else None
    reply = f"已处理：{len(records)} 条记录，{len(escalations)} 条超出参考区间"
    if memory:
        reply += f"（已参考你的偏好：{'；'.join(memory)}）"
    reply += "。"
    return {
        "reply": reply,
        "report": None,
        "citations": [{"kind": "kb", "ref": top1}] if top1 else [],
        "safety": {"escalations": escalations, "refusals": []},
    }
