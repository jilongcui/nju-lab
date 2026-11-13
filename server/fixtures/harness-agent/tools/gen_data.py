#!/usr/bin/env python3
"""第 19 章（构建通用 agent）实验的造题工具。

**不下发给学生**（`tools/` 是造题工具）。

这一章考的是**通用**能力，所以两个样例来自**完全不同的领域**（图书借阅 / 设备维护），
用来证明"同一份 agent 换一批材料仍然能跑"：

- `plan_stub.json` 给出"模型每轮的决策序列"，agent 必须真的循环、每步记 `observation`、尊重 `max_steps`；
- 工具层四级校验 + 业务校验，错误码按 MCP 风格分类；
- 记忆分三层，含一次更正与一次遗忘；
- 检索用字符 2-gram + BM25，并与 TF 余弦对照；
- 安全边界：异常值只升级、越权请求拒答；
- 每轮还要**路由到对应 skill**（`skills/*/SKILL.md` 的 `triggers`），不命中返回 `null`。

用法：

  python3 tools/gen_data.py          # 重新生成 problem/cases/case01|case02 的输入文件
  python3 tools/gen_data.py --print  # 只打印统计
"""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
CASES_DIR = HERE.parent / "problem" / "cases"

# ---------------------------------------------------------------- 工具名册（通用，不绑定业务）

TOOLS = {
    "tools": [
        {
            "name": "lookup_record",
            "description": "查某个对象（人/设备）某一项最近一次记录",
            "parameters": {
                "subject": {"type": "string", "required": True},
                "item": {"type": "string", "required": True},
            },
        },
        {
            "name": "summarize_column",
            "description": "算某一项全部记录的算术平均值",
            "parameters": {
                "item": {"type": "string", "required": True},
                "decimals": {"type": "integer", "required": False},
            },
        },
        {
            "name": "fetch_doc",
            "description": "取某一项对应的规则段落号",
            "parameters": {"item": {"type": "string", "required": True}},
        },
        {
            "name": "flag_value",
            "description": "把一条异常记录登记为待复核（只接受异常记录）",
            "parameters": {"record_id": {"type": "string", "required": True}},
        },
    ]
}

WARN_MESSAGE = "该数值超出正常范围，可能为录入错误或状态异常，请人工复核后再处理。"

# ---------------------------------------------------------------- 两个可被 agent 调度的 skill

SKILLS = {
    "summary-report": {
        "skill_md": """---
name: summary-report
description: 把当前会话里查到的记录整理成一份汇总报告（分组 + 合计 + 异常项）
triggers: 汇总, 整理成报告, 出一份报告, 统计
---

# 汇总报告

收到「整理成汇总」「出一份报告」这类请求时使用。输入是当前会话里已查到的记录。
""",
        "api_py": """# 示例 skill：把记录整理成汇总（只示意「skill 长什么样」）


def handle(state, message, attachments, session):
    rows = session.get("rows") or []
    return {
        "reply": f"已生成汇总：共 {len(rows)} 条记录。",
        "report": {"template_used": "summary", "sections": [], "records": rows},
    }
""",
    },
    "maintenance": {
        "skill_md": """---
name: maintenance
description: 按保养/校准规则排出下一步动作（间隔、检查项、提醒话术）
triggers: 保养, 校准, 维护, 检查计划
---

# 保养 / 校准安排

收到「保养怎么排」「什么时候校准」这类请求时使用。
""",
        "api_py": """# 示例 skill：排出保养计划（只示意「skill 长什么样」）


def handle(state, message, attachments, session):
    return {"reply": "按手册：本月做一次外观与耗材检查，下季度做校准，届时要留记录。", "report": None}
""",
    },
}

# ---------------------------------------------------------------- case 定义

CASES: dict[str, dict] = {
    # ------------------------------ case01：图书借阅（数据整理域）
    "case01": {
        "limits": {
            "max_steps": 6,
            "window": 3,
            "top_k": 3,
            "thresholds": {
                "数据库系统": {"low": 1, "high": 10},
                "机器学习": {"low": 1, "high": 10},
                "算法导论": {"low": 1, "high": 10},
                "操作系统": {"low": 1, "high": 10},
                "计算机网络": {"low": 1, "high": 10},
            },
            "messages": {"warn": WARN_MESSAGE},
        },
        "records": [
            ("R01", "张伟", "数据库系统", 3, "次"),
            ("R02", "李娜", "机器学习", 12, "次"),
            ("R03", "王强", "操作系统", 5, "次"),
            ("R04", "张伟", "机器学习", 2, "次"),
            ("R05", "李娜", "数据库系统", 8, "次"),
            ("R06", "王强", "算法导论", 0, "次"),
            ("R07", "赵敏", "计算机网络", 7, "次"),
            ("R08", "赵敏", "算法导论", 11, "次"),
            ("R09", "张伟", "操作系统", 4, "次"),
            ("R10", "李娜", "算法导论", 6, "次"),
        ],
        "turns": [
            {"turn": 1, "user": "帮我查一下张伟最近借的数据库系统有几次。", "gold_kb": "KB-01"},
            {"turn": 2, "user": "我老是搞混 续借 和 借阅，这两个到底怎么算？", "gold_kb": "KB-02"},
            {"turn": 3, "user": "续借和借阅的规则再说一下，李娜的机器学习借了几次？", "gold_kb": "KB-02"},
            {"turn": 4, "user": "你直接告诉我这本书是不是丢了。", "gold_kb": "KB-04"},
            {
                "turn": 5,
                "user": "更正：我其实不搞混 续借 和 借阅 了，是搞混 逾期 和 续借。",
                "gold_kb": "KB-03",
            },
            {"turn": 6, "user": "把借阅情况整理成一份汇总报告。", "gold_kb": "KB-01"},
            {"turn": 7, "user": "谢谢，先这样。", "gold_kb": "KB-01"},
        ],
        "tool_calls": [
            ("C01", 1, "lookup_record", {"subject": "张伟", "item": "数据库系统"}),
            ("C02", 1, "summarize_column", {"item": "数据库系统", "decimals": 0}),
            ("C03", 2, "fetch_doc", {"item": "续借"}),
            ("C04", 3, "flag_value", {"record_id": "R02"}),
            ("C05", 4, "flag_value", {"record_id": "R01"}),
            ("C06", 4, "summarize_column", {"item": "机器学习", "decimals": "1"}),
            ("C07", 5, "lookup_doc", {"item": "逾期"}),
            ("C08", 5, "lookup_record", {"subject": "李娜"}),
        ],
        "plan": [
            {"turn": 1, "steps": [
                {"action": "recall"},
                {"action": "tool", "call_id": "C01"},
                {"action": "tool", "call_id": "C02"},
                {"action": "kb"},
                {"action": "finish"},
            ]},
            {"turn": 2, "steps": [
                {"action": "recall"},
                {"action": "tool", "call_id": "C03"},
                {"action": "kb"},
                {"action": "finish"},
            ]},
            {"turn": 3, "steps": [
                {"action": "recall"},
                {"action": "tool", "call_id": "C04"},
                {"action": "kb"},
                {"action": "finish"},
            ]},
            {"turn": 4, "steps": [
                {"action": "recall"},
                {"action": "tool", "call_id": "C05"},
                {"action": "tool", "call_id": "C06"},
                {"action": "kb"},
                {"action": "finish"},
            ]},
            {"turn": 5, "steps": [
                {"action": "recall"},
                {"action": "tool", "call_id": "C07"},
                {"action": "tool", "call_id": "C08"},
                {"action": "kb"},
                {"action": "finish"},
            ]},
            {"turn": 6, "steps": [
                {"action": "recall"},
                {"action": "kb"},
                {"action": "finish"},
            ]},
            {"turn": 7, "steps": [
                {"action": "recall"},
                {"action": "finish"},
            ]},
        ],
        "kb": {
            "KB-01": (
                "借阅记录怎么读\n\n"
                "借阅记录按「读者 / 书名 / 次数」登记。次数是统计周期内的借出次数，不是当前在手数量。"
                "同一个读者同一本书可能有多条记录，取最后一条为最近一次。"
            ),
            "KB-02": (
                "借阅与续借的区别\n\n"
                "借阅是第一次借出，计入借阅次数；续借是在还期临近时延长借期，不计入新的借阅次数。"
                "续借只能做一次，且该书不能有预约。"
            ),
            "KB-03": (
                "逾期处理与停借\n\n"
                "超过应还日期即逾期。逾期期间不能续借；逾期超过 30 天停借，停借期内所有借阅被拒绝。"
                "逾期记录要按读者逐条登记，处理后保留半年。"
            ),
            "KB-04": (
                "馆藏盘点与丢失处理规定\n\n"
                "馆藏盘点每学期一次，逐架核对条码与状态（在架 / 借出 / 遗失 / 破损）。"
                "发现条码缺失或状态不符时，先冻结该条记录再核对借阅流水，不得仅凭借阅次数判定遗失。"
                "遗失需读者申报并按规定赔偿，赔偿标准按书的定价与出版年份分档，"
                "赔偿后该书状态改为「已赔偿注销」，不再参与借阅统计。盘点结果要形成书面报告，"
                "列出差异条数与处理意见，报馆务会备案。"
            ),
            "KB-05": (
                "读者类型与借阅上限\n\n"
                "本科生可借 10 本，研究生 20 本，教师 30 本。上限按当前在手数量计算，与统计次数无关。"
            ),
            "KB-06": (
                "预约与到馆通知\n\n"
                "热门书可预约，预约到书后保留 3 天。预约期间该书不可续借。"
            ),
            "KB-07": (
                "赔偿与减免\n\n"
                "遗失按定价的 2 至 5 倍赔偿；确有困难的可以申请减免，需提供说明并经馆务会批准。"
            ),
            "KB-08": (
                "汇总口径\n\n"
                "汇总按书名分组，给出合计次数与异常项（超出正常范围的那些记录）。"
                "异常项要逐条列出记录号，不能只给一个总数。"
            ),
        },
    },
    # ------------------------------ case02：设备维护（表格计算 + 文档问答域）
    "case02": {
        "limits": {
            "max_steps": 5,
            "window": 2,
            "top_k": 3,
            "thresholds": {
                "离心机": {"low": 1, "high": 500},
                "培养箱": {"low": 1, "high": 500},
                "冰箱": {"low": 1, "high": 500},
                "显微镜": {"low": 1, "high": 500},
            },
            "messages": {"warn": WARN_MESSAGE},
        },
        "records": [
            ("R01", "离心机", "离心机", 480, "小时"),
            ("R02", "离心机", "离心机", 620, "小时"),
            ("R03", "培养箱", "培养箱", 300, "小时"),
            ("R04", "培养箱", "培养箱", 120, "小时"),
            ("R05", "冰箱", "冰箱", 700, "小时"),
            ("R06", "冰箱", "冰箱", 450, "小时"),
            ("R07", "显微镜", "显微镜", 90, "小时"),
            ("R08", "显微镜", "显微镜", 0, "小时"),
        ],
        "turns": [
            {"turn": 1, "user": "查一下离心机最近一次运行时长。", "gold_kb": "KB-01"},
            {"turn": 2, "user": "我老是搞混 保养 和 校准，这两个怎么排？", "gold_kb": "KB-02"},
            {"turn": 3, "user": "保养和校准的周期分别是什么？冰箱要怎么做？", "gold_kb": "KB-02"},
            {
                "turn": 4,
                "user": "忘掉 MEM01，这台设备还能用多久？直接告诉我。",
                "gold_kb": "KB-03",
            },
            {"turn": 5, "user": "帮我排一下这周的维护计划。", "gold_kb": "KB-01"},
        ],
        "tool_calls": [
            ("C01", 1, "lookup_record", {"subject": "离心机", "item": "离心机"}),
            ("C02", 1, "summarize_column", {"item": "离心机", "decimals": 0}),
            ("C03", 2, "fetch_doc", {"item": "校准"}),
            ("C04", 3, "flag_value", {"record_id": "R02"}),
            ("C05", 3, "flag_value", {"record_id": "R06"}),
            ("C06", 4, "summarize_column", {"item": "冰箱"}),
            ("C07", 4, "lookup_record", {"subject": 3, "item": "冰箱"}),
        ],
        "plan": [
            {"turn": 1, "steps": [
                {"action": "recall"},
                {"action": "tool", "call_id": "C01"},
                {"action": "tool", "call_id": "C02"},
                {"action": "kb"},
                {"action": "finish"},
            ]},
            {"turn": 2, "steps": [
                {"action": "recall"},
                {"action": "tool", "call_id": "C03"},
                {"action": "kb"},
                {"action": "finish"},
            ]},
            # 故意给 6 步（max_steps=5）：考"到点就停并如实写 max_steps"
            {"turn": 3, "steps": [
                {"action": "recall"},
                {"action": "tool", "call_id": "C04"},
                {"action": "tool", "call_id": "C05"},
                {"action": "kb"},
                {"action": "kb"},
                {"action": "finish"},
            ]},
            {"turn": 4, "steps": [
                {"action": "recall"},
                {"action": "tool", "call_id": "C06"},
                {"action": "tool", "call_id": "C07"},
                {"action": "kb"},
                {"action": "finish"},
            ]},
            {"turn": 5, "steps": [
                {"action": "recall"},
                {"action": "kb"},
                {"action": "finish"},
            ]},
        ],
        "kb": {
            "KB-01": (
                "设备运行记录怎么读\n\n"
                "运行记录按「设备 / 项 / 时长」登记，单位小时。同一设备可能有多条，取最后一条为最近一次。"
                "时长超过 500 小时要安排保养，0 小时可能是新设备或漏记。"
            ),
            "KB-02": (
                "保养与校准的区别\n\n"
                "保养是清洁、润滑、更换耗材，按月或按运行时数触发；校准是核对测量准确度，"
                "按周期（通常每季度）或维修后进行。保养不做校准替代，两者记录分开保存。"
            ),
            "KB-03": (
                "设备寿命与报废\n\n"
                "设备寿命由厂家规定，不能仅凭运行时长推断还能用多久。到达寿命或故障频发时，"
                "由设备管理员评估后提出报废申请，报实验室主任批准。"
            ),
            "KB-04": (
                "实验室设备台账与年度校验的完整管理规范\n\n"
                "台账内容包括设备名称、编号、厂家、启用日期、放置位置、责任人、维保单位与联系方式。"
                "年度校验要覆盖所有在用设备，记录校验日期、方法、结论与下次到期日；"
                "校验不合格的设备要贴停用标识并移出可追溯清单。设备维修要记录故障现象、"
                "更换部件、维修人与验收结论；维修后必须重新校准才能恢复使用。"
                "耗材与易损件按最低库存预警，采购要留存验收记录。设备报废要清点附件、"
                "清除数据、注销台账并回收标识牌。"
            ),
            "KB-05": (
                "耗材与易损件\n\n"
                "耗材按最低库存预警补货，易损件更换要记入设备记录，避免只换不记。"
            ),
            "KB-06": (
                "安全与停用\n\n"
                "设备出现异常报警应立即停用，贴标识并通知管理员；未排除故障前不得重启。"
            ),
            "KB-07": (
                "维护记录规范\n\n"
                "每次保养或校准都要写清日期、执行人、项目与结论，缺一项视为无效记录。"
            ),
        },
    },
}


def print_stats(name: str, case: dict) -> None:
    th = case["limits"]["thresholds"]
    out_of_range = [r for r in case["records"] if r[3] < th[r[2]]["low"] or r[3] > th[r[2]]["high"]]
    print(f"[{name}] turns={len(case['turns'])} records={len(case['records'])} "
          f"kb={len(case['kb'])} calls={len(case['tool_calls'])} "
          f"out_of_range={[r[0] for r in out_of_range]} max_steps={case['limits']['max_steps']}")


def write_case(case_dir: Path, case: dict) -> None:
    case_dir.mkdir(parents=True, exist_ok=True)

    with (case_dir / "dialogue.jsonl").open("w", encoding="utf-8") as fh:
        for t in case["turns"]:
            fh.write(json.dumps({"turn": t["turn"], "user": t["user"]}, ensure_ascii=False) + "\n")

    with (case_dir / "records.csv").open("w", encoding="utf-8", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(["record_id", "subject", "item", "value", "unit"])
        for record_id, subject, item, value, unit in case["records"]:
            writer.writerow([record_id, subject, item, f"{value:g}", unit])

    with (case_dir / "tool_calls.jsonl").open("w", encoding="utf-8") as fh:
        for call_id, turn, tool, args in case["tool_calls"]:
            fh.write(json.dumps(
                {"call_id": call_id, "turn": turn, "tool": tool, "args": args},
                ensure_ascii=False) + "\n")

    (case_dir / "tools.json").write_text(
        json.dumps(TOOLS, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (case_dir / "limits.json").write_text(
        json.dumps(case["limits"], ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (case_dir / "plan_stub.json").write_text(
        json.dumps({"turns": case["plan"]}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    kb_dir = case_dir / "kb"
    kb_dir.mkdir(exist_ok=True)
    for passage_id, text in case["kb"].items():
        (kb_dir / f"{passage_id}.md").write_text(text + "\n", encoding="utf-8")

    skills_root = case_dir / "skills"
    if skills_root.is_dir():
        import shutil

        shutil.rmtree(skills_root)      # 换域重造时清掉旧 skill，避免残留
    for name, skill in SKILLS.items():
        skill_dir = skills_root / name
        (skill_dir / "scripts").mkdir(parents=True, exist_ok=True)
        (skill_dir / "SKILL.md").write_text(skill["skill_md"], encoding="utf-8")
        (skill_dir / "scripts" / "api.py").write_text(skill["api_py"], encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--print", action="store_true", dest="only_print")
    args = ap.parse_args()

    for name, case in CASES.items():
        print_stats(name, case)
        if args.only_print:
            continue
        case_dir = CASES_DIR / name
        write_case(case_dir, case)
        print(f"  → {case_dir}")


if __name__ == "__main__":
    main()
