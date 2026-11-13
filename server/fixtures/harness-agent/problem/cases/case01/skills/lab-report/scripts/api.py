# 示例 skill：把检验记录整理成四节报告（只示意「skill 长什么样」）


def handle(state, message, attachments, session):
    rows = session.get("rows") or []
    return {
        "reply": f"已按科室模板生成报告：共 {len(rows)} 条记录。",
        "report": {"template_used": "dept-template", "sections": [], "records": rows},
    }
