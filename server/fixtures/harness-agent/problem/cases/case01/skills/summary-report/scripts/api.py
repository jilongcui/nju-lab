# 示例 skill：把记录整理成汇总（只示意「skill 长什么样」）


def handle(state, message, attachments, session):
    rows = session.get("rows") or []
    return {
        "reply": f"已生成汇总：共 {len(rows)} 条记录。",
        "report": {"template_used": "summary", "sections": [], "records": rows},
    }
