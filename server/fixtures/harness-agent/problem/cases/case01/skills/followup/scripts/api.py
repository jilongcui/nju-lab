# 示例 skill：给出随访安排（只示意「skill 长什么样」）


def handle(state, message, attachments, session):
    return {"reply": "建议 3 个月后复查血常规与糖化血红蛋白，并把结果带回门诊。", "report": None}
