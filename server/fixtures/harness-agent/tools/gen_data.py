#!/usr/bin/env python3
"""第 19 章（智能体 Harness）实验的造题工具。

**不下发给学生**（`tools/` 是造题工具）。

这一章的应用是「随访助手 harness」：学生要实现的不是一个模型，而是**包住模型的脚手架** ——
循环控制（loop）、记忆分层（working / short / long）、工具层（MCP 风格报文 + 参数校验）、
知识库检索（BM25 + 对照）、安全边界（升级 / 拒答）。所以造题的重点同样是**把口径钉死**：

- **模型是桩**：`plan_stub.json` 给出"模型每轮的决策序列"（`recall` / `tool` / `kb` / `finish`），
  学生实现的 harness 必须**真的循环**执行、把每步观测记进 `trace` —— 于是 trace 逐字段可比，
  判分不依赖真模型的随机输出（沿用 `attention-ablation` 的"输入全部写死"经验）。
- **工具校验四级 + 一级业务检查**：`tool_calls.jsonl` 里**故意混入**未知工具、参数不是对象、
  缺必填、类型错、以及对正常读数要求升级（业务拒绝）—— 学生必须如实记 rejected 并给对错误码。
- **记忆**：固定句式写入 / 更正（旧的置 superseded）/ 遗忘（置 forgotten），
  后面再提到同一对概念时才算"应用" —— 行为性判据。
- **检索对照**：gold 是短精准文档，干扰项是长综述 —— 字符 2-gram 的 TF 余弦会偏向长文档，
  而 BM25 会赢。这个差距由语料结构保证（造数据时就把两端都量出来）。

用法：

  python3 tools/gen_data.py          # 重新生成 problem/cases/case01|case02 的输入文件
  python3 tools/gen_data.py --print  # 只打印统计，不落盘
"""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
CASES_DIR = HERE.parent / "problem" / "cases"

# ---------------------------------------------------------------- 工具名册

TOOLS = {
    "tools": [
        {
            "name": "lookup_record",
            "description": "查某位患者某一指标最近一次检验记录",
            "parameters": {
                "patient_id": {"type": "string", "required": True},
                "item": {"type": "string", "required": True},
            },
        },
        {
            "name": "summarize_metric",
            "description": "算某个指标全部记录的算术平均值",
            "parameters": {
                "item": {"type": "string", "required": True},
                "decimals": {"type": "integer", "required": False},
            },
        },
        {
            "name": "fetch_guideline",
            "description": "取某个指标对应的指南段落号",
            "parameters": {"item": {"type": "string", "required": True}},
        },
        {
            "name": "escalate_value",
            "description": "把一条越界读数登记为升级（只接受越界记录）",
            "parameters": {"record_id": {"type": "string", "required": True}},
        },
    ]
}

WARN_MESSAGE = "该读数超出参考范围，可能为测量误差或病情变化，请尽快由临床医生复核。"

# ---------------------------------------------------------------- case 定义

CASES: dict[str, dict] = {
    "case01": {
        "limits": {
            "max_steps": 6,
            "window": 3,
            "top_k": 3,
            "thresholds": {
                "血小板计数": {"low": 100, "high": 300},
                "白细胞计数": {"low": 3.5, "high": 10},
                "血红蛋白": {"low": 110, "high": 160},
                "糖化血红蛋白": {"low": 0, "high": 7.0},
            },
            "messages": {"warn": WARN_MESSAGE},
        },
        "records": [
            ("R01", "P001", "血小板计数", 128, "10^9/L"),
            ("R02", "P001", "血小板计数", 18, "10^9/L"),
            ("R03", "P002", "血小板计数", 210, "10^9/L"),
            ("R04", "P001", "白细胞计数", 9.0, "10^9/L"),
            ("R05", "P002", "白细胞计数", 12.5, "10^9/L"),
            ("R06", "P001", "血红蛋白", 118, "g/L"),
            ("R07", "P002", "血红蛋白", 96, "g/L"),
            ("R08", "P001", "糖化血红蛋白", 7.2, "%"),
            ("R09", "P002", "糖化血红蛋白", 8.9, "%"),
            ("R10", "P002", "白细胞计数", 11.0, "10^9/L"),
        ],
        # 每轮：user 消息 + gold 段落（gold 只用于判 hit，写进 expected）
        "turns": [
            {
                "turn": 1,
                "user": "帮我看下 P001 最近的血小板计数，顺便说说这个指标低到什么程度要当回事。",
                "gold_kb": "KB-01",
            },
            {
                "turn": 2,
                "user": "我老是搞混 白细胞计数 和 血小板计数，这两个到底各看什么？",
                "gold_kb": "KB-02",
            },
            {
                "turn": 3,
                "user": "P002 的白细胞计数和血小板计数都查一下，这两个指标一起看，趋势上要注意什么？",
                "gold_kb": "KB-05",
            },
            {
                "turn": 4,
                "user": "你直接告诉我 P002 是不是感染了，别绕。",
                "gold_kb": "KB-02",
            },
            {
                "turn": 5,
                "user": "更正：我其实不搞混 白细胞计数 和 血小板计数 了，是搞混 糖化血红蛋白 和 血红蛋白。",
                "gold_kb": "KB-06",
            },
        ],
        "tool_calls": [
            ("C01", 1, "lookup_record", {"patient_id": "P001", "item": "血小板计数"}),
            ("C02", 1, "summarize_metric", {"item": "血小板计数", "decimals": 0}),
            ("C03", 2, "fetch_guideline", {"item": "白细胞计数"}),
            ("C04", 3, "escalate_value", {"record_id": "R02"}),
            ("C05", 4, "escalate_value", {"record_id": "R06"}),
            ("C06", 4, "summarize_metric", {"item": "血红蛋白", "decimals": "1"}),
            ("C07", 5, "lookup_guideline", {"item": "糖化血红蛋白"}),
            ("C08", 5, "lookup_record", {"patient_id": "P002"}),
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
        ],
        "kb": {
            "KB-01": (
                "血小板计数参考范围与处理\n\n"
                "血小板计数成人参考范围约 100 至 300（10^9/L）。低于 100 需要复查血常规，"
                "排除采血凝块与抗凝剂影响。低于 30 属于危急值，出血风险明显升高，"
                "应立即联系临床医生并安排复查。血小板计数高到 300 以上时要结合炎症、"
                "缺铁与脾功能一起看。"
            ),
            "KB-02": (
                "白细胞计数看什么\n\n"
                "白细胞计数成人参考范围约 3.5 至 10（10^9/L）。升高常见于细菌感染、"
                "应激与糖皮质激素使用；降低常见于病毒感染、药物抑制与血液系统疾病。"
                "白细胞计数单独一项不能判断感染，要结合中性粒细胞比例、症状与体温。"
            ),
            "KB-03": (
                "血细胞分析仪的检测原理综述\n\n"
                "血细胞分析仪通过电阻抗法与流式细胞术对血细胞逐项计数，"
                "可报告白细胞计数、红细胞计数、血红蛋白、血小板计数等十余项参数。"
                "不同厂家的仪器在鞘流聚焦、光学通道与鞘液配方上差异较大，"
                "血小板计数在低值区间尤其容易受小红细胞与细胞碎片干扰，"
                "血红蛋白测定的比色法在脂血与黄疸样本中也可能出现偏差。"
                "仪器的日常质控包括本底计数、携带污染率与室内质控品测定，"
                "校准周期与试剂批号变更都需要完整记录，样本采集时的抗凝剂类型、"
                "采血量与混匀方式同样会影响血小板计数与白细胞计数的稳定性。"
                "实验室应建立复检规则，把仪器报警、历史差值超限与危急值一并纳入审核流程。"
            ),
            "KB-04": (
                "血红蛋白与贫血分级\n\n"
                "血红蛋白成人参考范围约 110 至 160 g/L。低于 110 提示贫血，"
                "90 至 110 为轻度，60 至 90 为中度，低于 60 为重度。"
                "贫血要结合红细胞平均体积、铁代谢与网织红细胞判断类型，"
                "单看血红蛋白只能说明程度，不能说明原因。"
            ),
            "KB-05": (
                "血小板计数与白细胞计数联合解读\n\n"
                "感染与炎症时白细胞计数常升高，而血小板计数可能升高（反应性血小板增多）"
                "也可能下降（消耗性减少）。两者同时下降要警惕脓毒症与弥散性血管内凝血，"
                "两者同时升高多见于慢性炎症与缺铁。所以联合解读时要看变化趋势，"
                "而不是只看单次结果。"
            ),
            "KB-06": (
                "糖化血红蛋白反映什么\n\n"
                "糖化血红蛋白反映过去 8 至 12 周的平均血糖水平，参考上限常取 7.0%（%）。"
                "超过上限提示血糖控制不佳。它不受当天进食影响，"
                "但贫血、血红蛋白病与近期输血会让结果失真，此时应改用糖化血清蛋白或连续血糖监测。"
                "血红蛋白与糖化血红蛋白一起看，可以区分「控制不佳」与「贫血导致的假性改善」。"
            ),
            "KB-07": (
                "检验前准备、样本采集与流转的完整操作规范\n\n"
                "检验前阶段包括患者准备、申请单核对、采血器具选择、体位与止血带时间控制，"
                "任何一步不规范都可能让结果偏移。样本采集后要在规定时间内送检，"
                "血常规样本室温放置过久会使血小板计数偏低、白细胞计数偏高；"
                "溶血、脂血与黄疸样本需要在报告上标注并说明干扰。"
                "实验室信息系统应记录采样时间、接收时间与报告时间，"
                "危急值要按制度逐级通报并登记，登记内容包括患者标识、项目、结果、"
                "通报人与接收人。质控失控时要暂停报告并回溯上一批样本。"
            ),
            "KB-08": (
                "危急值报告与登记制度\n\n"
                "危急值是指提示患者可能处于生命危险状态的检验结果。"
                "出现危急值应当立即复查，复查一致后按制度通报临床，并登记通报时间与接收人。"
                "登记本与信息系统记录要一致，交接班时要核对未闭环的危急值。"
            ),
        },
    },
    "case02": {
        "limits": {
            "max_steps": 4,
            "window": 2,
            "top_k": 3,
            "thresholds": {
                "血红蛋白": {"low": 120, "high": 160},
                "糖化血红蛋白": {"low": 0, "high": 7.0},
                "白细胞计数": {"low": 3.5, "high": 10},
            },
            "messages": {"warn": WARN_MESSAGE},
        },
        "records": [
            ("R01", "P003", "血红蛋白", 132, "g/L"),
            ("R02", "P003", "血红蛋白", 101, "g/L"),
            ("R03", "P003", "糖化血红蛋白", 8.4, "%"),
            ("R04", "P004", "血红蛋白", 145, "g/L"),
            ("R05", "P004", "糖化血红蛋白", 6.1, "%"),
            ("R06", "P004", "白细胞计数", 5.2, "10^9/L"),
            ("R07", "P003", "白细胞计数", 3.1, "10^9/L"),
            ("R08", "P004", "血红蛋白", 118, "g/L"),
        ],
        "turns": [
            {
                "turn": 1,
                "user": "我老是搞混 糖化血红蛋白 和 血红蛋白，先帮我查一下 P003 的血红蛋白。",
                "gold_kb": "KB-01",
            },
            {
                "turn": 2,
                "user": "P003 的糖化血红蛋白和血红蛋白一起看下，我总觉得这两个记不住。",
                "gold_kb": "KB-03",
            },
            {
                "turn": 3,
                "user": "忘掉 MEM01，这两个我记住了。换一个：P004 的血红蛋白轻度下降，要不要紧？",
                "gold_kb": "KB-02",
            },
        ],
        "tool_calls": [
            ("C01", 1, "lookup_record", {"patient_id": "P003", "item": "血红蛋白"}),
            ("C02", 1, "summarize_metric", {"item": "糖化血红蛋白", "decimals": 1}),
            ("C03", 2, "fetch_guideline", {"item": "糖化血红蛋白"}),
            ("C04", 2, "escalate_value", {"record_id": "R02"}),
            ("C05", 2, "escalate_value", {"record_id": "R04"}),
            ("C06", 3, "summarize_metric", {"item": "血红蛋白"}),
            ("C07", 3, "lookup_record", {"patient_id": 3, "item": "血红蛋白"}),
        ],
        "plan": [
            {"turn": 1, "steps": [
                {"action": "recall"},
                {"action": "tool", "call_id": "C01"},
                {"action": "kb"},
                {"action": "finish"},
            ]},
            # 这一轮的决策序列**故意超过 max_steps**（3）：harness 必须按上限截断并记 max_steps
            {"turn": 2, "steps": [
                {"action": "recall"},
                {"action": "tool", "call_id": "C03"},
                {"action": "tool", "call_id": "C04"},
                {"action": "tool", "call_id": "C05"},
                {"action": "kb"},
                {"action": "finish"},
            ]},
            {"turn": 3, "steps": [
                {"action": "recall"},
                {"action": "tool", "call_id": "C06"},
                {"action": "tool", "call_id": "C07"},
                {"action": "finish"},
            ]},
        ],
        "kb": {
            "KB-01": (
                "血红蛋白看什么\n\n"
                "血红蛋白反映携氧能力，成人参考范围约 120 至 160 g/L。"
                "低于 120 提示贫血，要结合红细胞平均体积与铁代谢找原因。"
            ),
            "KB-02": (
                "血红蛋白轻度下降怎么处理\n\n"
                "血红蛋白轻度下降先复查，确认不是采血或输液稀释造成的。"
                "复查仍低时查铁蛋白、叶酸与维生素 B12，并结合饮食与月经史。"
                "没有症状的轻度贫血不需要输血，但要定期随访。"
            ),
            "KB-03": (
                "糖化血红蛋白与血红蛋白一起看\n\n"
                "糖化血红蛋白反映过去 8 至 12 周平均血糖，参考上限常取 7.0%。"
                "贫血时红细胞寿命改变，糖化血红蛋白可能被低估或高估，"
                "所以糖尿病患者的血红蛋白与糖化血红蛋白要一起看，"
                "才能分清血糖控制不佳与贫血导致的假性改善。"
            ),
            "KB-04": (
                "糖尿病实验室监测的完整方案综述\n\n"
                "糖尿病的实验室监测包括空腹血糖、餐后血糖、糖化血红蛋白、"
                "尿微量白蛋白、血脂与肝肾功能。糖化血红蛋白的检测方法有"
                "高效液相色谱、免疫比浊与酶法，不同方法在血红蛋白变异体存在时结果差异明显。"
                "血红蛋白变异体、缺铁性贫血、溶血性贫血与近期输血都会影响糖化血红蛋白的解读，"
                "临床上需要结合血红蛋白、红细胞平均体积、网织红细胞与铁代谢综合判断。"
                "监测频率通常按控制情况每三到六个月一次，治疗调整期可缩短到三个月。"
                "实验室要记录检测方法、批号与质控结果，保证同一患者的历史结果可比。"
                "门诊还要评估依从性、低血糖风险、体重与血压，糖化血红蛋白只是其中一项。"
                "对于妊娠期、儿童与老年人，糖化血红蛋白的目标值需要个体化调整，"
                "血红蛋白偏低时更要谨慎解读糖化血红蛋白，避免把贫血当成血糖改善。"
                "实验室信息系统应保留原始报告与复检记录，便于回溯方法学变更带来的漂移。"
                "总结起来，糖化血红蛋白与血红蛋白、红细胞平均体积、网织红细胞要一起看，"
                "糖化血红蛋白的解读离不开血红蛋白，血红蛋白的异常又会反过来影响糖化血红蛋白，"
                "所以糖化血红蛋白和血红蛋白这两项在糖尿病随访里必须同时评估。"
            ),
            "KB-05": (
                "贫血与血糖控制的门诊随访流程\n\n"
                "门诊随访时先看症状与体征，再看检验结果，最后才调整方案。"
                "随访记录要写清本次主诉、用药变更、检验结果与下次复查时间。"
                "患者教育要落到具体动作，例如怎么记录饮食、什么时候复查。"
            ),
            "KB-06": (
                "检验结果互认与样本流转\n\n"
                "不同医院的检验结果互认需要方法学可比、质控合格与样本类型一致。"
                "样本流转环节要记录采集、运送、接收与检测时间，"
                "超过稳定时限的样本应拒收或备注。"
            ),
            "KB-07": (
                "血常规与生化项目的组合筛查\n\n"
                "健康体检常用血常规、肝肾功能、血脂与血糖组合筛查。"
                "组合筛查的异常结果需要按项目分别处理，不能用一个结论概括。"
            ),
        },
    },
}


def print_stats(name: str, case: dict) -> None:
    th = case["limits"]["thresholds"]
    out_of_range = [
        r for r in case["records"]
        if r[3] < th[r[2]]["low"] or r[3] > th[r[2]]["high"]
    ]
    print(f"[{name}] turns={len(case['turns'])} records={len(case['records'])} "
          f"kb={len(case['kb'])} calls={len(case['tool_calls'])} "
          f"out_of_range={[r[0] for r in out_of_range]} "
          f"max_steps={case['limits']['max_steps']}")


def write_case(case_dir: Path, case: dict) -> None:
    case_dir.mkdir(parents=True, exist_ok=True)

    with (case_dir / "dialogue.jsonl").open("w", encoding="utf-8") as fh:
        for t in case["turns"]:
            fh.write(json.dumps({"turn": t["turn"], "user": t["user"]}, ensure_ascii=False) + "\n")

    with (case_dir / "records.csv").open("w", encoding="utf-8", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(["record_id", "patient_id", "item", "value", "unit"])
        for record_id, patient_id, item, value, unit in case["records"]:
            writer.writerow([record_id, patient_id, item, f"{value:g}", unit])

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
