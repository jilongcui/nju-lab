# 示例 skill：排出保养计划（只示意「skill 长什么样」）


def handle(state, message, attachments, session):
    return {"reply": "按手册：本月做一次外观与耗材检查，下季度做校准，届时要留记录。", "report": None}
