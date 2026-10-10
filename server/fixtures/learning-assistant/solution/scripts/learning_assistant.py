#!/usr/bin/env python3
"""第 19 章（智能体综合实践：分子医学学习助手）的**教师侧解答样例**。

> ⚠️ **这份文件不随题目包下发**。它放在实验目录根下的 `solution/`（不在 `problem/` 里），
> 作用是两份**机器证明**：
> 1. **题目可解**：拿它跑一遍平台复验（`--skill /p/solution --problem /p/problem.zip`）应 2/2 通过；
> 2. **判据不误杀**：`expected.json` 由它算出来（口径钉死 ⇒ 结果唯一确定）。
>
> 学生拿到的是 `skill-template/`（只有 `SKILL.md` 与 TODO 空壳），**没有**这份实现 ——
> 这是本章作为**收官·迁移检验**的设计（见 `docs/EXPERIMENT-DESIGN-FRAMEWORK.md` §3.5 与
> `docs/PLAN-2026-10-experiment-roadmap.md` §6 第 9 项）。

它把"五个必须发生"串成一个最小闭环：

  ① **记忆读写**   —— 从提问里按钉死句式抽出学生的薄弱点，在后面同时提到这两个概念的提问上应用；
  ② **工具调用**   —— 按 `tools.json` 的 schema 校验 `tool_calls.csv` 的每个请求（非法如实记 rejected），
                      合法调用路由到本地 mock 实现并给出写死格式的结果摘要；
  ③ **技能流程**   —— 按 `report_template.json` 生成"目的 / 方法 / 结果 / 讨论"四节报告；
  ④ **检索 + 出处** —— 越界行引用到行级（`experiment_data.csv:R02`）、解释引用到段级（`passages.csv:P-02`）；
  ⑤ **安全边界**   —— 越界读数触发升级 + 固定话术；要求"直接下诊断"的提问触发拒答。

用法：

  python3 scripts/learning_assistant.py <case目录> <output.json>   # 单个 case
  python3 scripts/learning_assistant.py --regen-expected           # 重算 expected.json（教师侧）

  # 教师侧复验（应 2/2 通过）
  docker run --rm --env-file server/.env --memory 2g -e VERIFY_REASONING_EFFORT=low -e VERIFY_MAX_CASES=0 \
    -v "$PWD/server/fixtures/learning-assistant:/p:ro" -v "$PWD/.verify-scratch/out:/outputs" \
    nju-lab-verify:0.2.0-rc.2-pkg6 --skill /p/solution --problem /p/problem.zip \
    --out /outputs/learning-assistant.json --timeout-ms 300000
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import statistics
import tempfile
from pathlib import Path

import matplotlib

matplotlib.use("Agg")  # 容器内无显示环境
import matplotlib.pyplot as plt  # noqa: E402

HERE = Path(__file__).resolve().parent
CASES_DIR = HERE.parent.parent / "problem" / "cases"
FIG_DIR = Path("figures")
FIG_NAME = "item_overview.png"

# 记忆抽取口径：固定句式「我老是搞混 <A> 和 <B>」（口径写死在 task.md）
WEAK_PATTERN = re.compile(r"老是搞混\s*([^\s，。！？、,]+)\s*和\s*([^\s，。！？、,]+)")
# 拒答口径：提问里出现下面任一措辞，就不给诊断结论（口径写死在 task.md）
REFUSAL_MARKERS = ("直接告诉我", "你直接说")


# ---------- 读数据 ----------


def load_case(case_dir: Path) -> dict:
    def read_csv(name: str) -> list[dict]:
        with (case_dir / name).open(encoding="utf-8", newline="") as fh:
            return [dict(r) for r in csv.DictReader(fh)]

    questions = read_csv("questions.csv")
    questions.sort(key=lambda r: r["q_id"])
    data = read_csv("experiment_data.csv")
    passages = read_csv("passages.csv")
    calls = read_csv("tool_calls.csv")
    calls.sort(key=lambda r: r["call_id"])
    tools = json.loads((case_dir / "tools.json").read_text(encoding="utf-8"))
    template = json.loads((case_dir / "report_template.json").read_text(encoding="utf-8"))
    return {
        "questions": questions,
        "data": data,
        "passages": passages,
        "calls": calls,
        "tools": {t["name"]: t for t in tools["tools"]},
        "template": template,
    }


# ---------- ① 记忆：写入与应用 ----------


def write_memory(questions: list[dict]) -> list[dict]:
    """按固定句式抽薄弱点；每条给出 `{entry_id, fact, category, source_q_id}` 与解析出的两个概念。"""
    entries: list[dict] = []
    for question in questions:
        match = WEAK_PATTERN.search(question["question"])
        if not match:
            continue
        first, second = match.group(1), match.group(2)
        entries.append(
            {
                "entry_id": f"MEM{len(entries) + 1:02d}",
                "fact": f"老是搞混 {first} 和 {second}",
                "category": "weak_point",
                "source_q_id": question["q_id"],
                "_terms": (first, second),
            }
        )
    return entries


def apply_memory(questions: list[dict], entries: list[dict]) -> list[dict]:
    """应用口径：**只考虑写入该条记忆那一轮之后**的提问；提问里**同时出现**两个概念就记一次应用。"""
    order = {q["q_id"]: i for i, q in enumerate(questions)}
    applied = []
    for entry in entries:
        first, second = entry["_terms"]
        for question in questions:
            if order[question["q_id"]] <= order[entry["source_q_id"]]:
                continue
            if first in question["question"] and second in question["question"]:
                applied.append({"question_id": question["q_id"], "entry_id": entry["entry_id"]})
    return sorted(applied, key=lambda x: (x["question_id"], x["entry_id"]))


# ---------- ② 工具调用：校验 + 路由 + mock 执行 ----------


def type_ok(value, declared: str) -> bool:
    if declared == "string":
        return isinstance(value, str)
    if declared == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    return True


def validate_call(args_raw: str, tool: dict | None) -> tuple[bool, str]:
    """钉死的校验顺序：未知工具 → args 不是对象 → 缺必填 → 类型不符；命中即停。"""
    if tool is None:
        return False, "unknown_tool"
    try:
        args = json.loads(args_raw)
    except json.JSONDecodeError:
        return False, "invalid_args"
    if not isinstance(args, dict):
        return False, "invalid_args"
    for name, spec in tool["parameters"].items():
        if spec.get("required") and name not in args:
            return False, "missing_required"
    for name, value in args.items():
        spec = tool["parameters"].get(name)
        if spec is None:
            continue  # 多余参数：忽略
        if not type_ok(value, spec["type"]):
            return False, "type_mismatch"
    return True, ""


def execute_call(tool_name: str, args: dict, data: list[dict], passages: list[dict]) -> str:
    """mock 执行：三个工具的返回摘要格式都写死在 task.md 里。"""
    if tool_name == "mean_of_column":
        column = args["column"]
        values = [float(row["value"]) for row in data if row["item"] == column]
        decimals = args.get("decimals", 0)
        return f"{column} 均值 {round(statistics.fmean(values), decimals)}"
    if tool_name == "plot_histogram":
        return f"{args['column']} 直方图 bins={args['bins']}"
    if tool_name == "fetch_reference":
        item = args["item"]
        ids = sorted(p["passage_id"] for p in passages if p["item"] == item)
        return f"{item} 的参考段落 {ids[0]}"
    raise ValueError(f"unhandled tool: {tool_name}")


def run_tool_calls(case: dict) -> list[dict]:
    out = []
    for call in case["calls"]:
        tool = case["tools"].get(call["tool"])
        valid, reason = validate_call(call["args"], tool)
        summary = ""
        if valid:
            summary = execute_call(call["tool"], json.loads(call["args"]), case["data"], case["passages"])
        out.append(
            {
                "call_id": call["call_id"],
                "tool": call["tool"],
                "args_valid": valid,
                "status": "executed" if valid else "rejected",
                "rejected_reason": reason,
                "result_summary": summary,
            }
        )
    return out


# ---------- ④ 检索 + 出处 ----------


def warn_rows(case: dict) -> list[dict]:
    out = []
    for row in case["data"]:
        rule = case["template"]["thresholds"].get(row["item"])
        if not rule:
            continue
        value = float(row["value"])
        if ("low" in rule and value < rule["low"]) or ("high" in rule and value > rule["high"]):
            out.append({"row_id": row["row_id"], "item": row["item"], "value": value})
    return sorted(out, key=lambda r: r["row_id"])


def build_citations(warned: list[dict], passages: list[dict]) -> list[dict]:
    """口径：先全部 data 引用（按 row_id 升序），再全部 passage 引用（item 升序、每个 item 取段落号最小）。"""
    citations = [{"kind": "data", "ref": f"experiment_data.csv:{r['row_id']}"} for r in warned]
    for item in sorted({r["item"] for r in warned}):
        ids = sorted(p["passage_id"] for p in passages if p["item"] == item)
        citations.append({"kind": "passage", "ref": f"passages.csv:{ids[0]}"})
    return citations


# ---------- ③ 技能流程：按模板生成报告 ----------


def build_sections(case: dict, warned: list[dict], calls: list[dict], entries: list[dict]) -> list[dict]:
    names = [s["name"] for s in case["template"]["sections"]]
    items = sorted({row["item"] for row in case["data"]})
    rejected = [c for c in calls if not c["args_valid"]]
    warn_text = "、".join(f"{r['item']} {r['value']:g}" for r in warned) or "无"
    content = {
        "目的": (
            f"用 {len(case['data'])} 行实验数据（指标：{'、'.join(items)}）练习「读数据 → 算统计 → 看异常 → 写结论」"
            "这条链路，并在过程中把学生的薄弱点记下来、在后续提问里用上。"
        ),
        "方法": (
            f"先按 {len(case['data'])} 行数据算各指标均值，再把每行读数与警戒线逐行比对，"
            f"把越界行挑出来；然后用本地工具做统计与画图（共 {len(calls)} 次调用，其中 "
            f"{len(rejected)} 次因参数不合法被拒绝），最后按模板成文。"
        ),
        "结果": (
            f"共发现 {len(warned)} 行越界读数：{warn_text}。"
            "越界行已逐行引用到出处（行号级）。这些读数只说明「这一行超出了警戒线」，"
            "不代表任何诊断结论；需要先复核原始数据与测量过程。"
        ),
        "讨论": (
            "越界读数最常见的两种原因是「真异常」与「测量或样本问题」：前者提示需要进一步检查，"
            "后者提示先复核再判断。本实验引用的段落正好解释了这两条路径。"
            "另外要说明三条局限：本地 mock 工具不是真实 MCP 服务、报告文本不是大模型生成的、"
            f"记忆只是本地条目表（共 {len(entries)} 条）而不是真正的记忆服务。"
        ),
    }
    return [{"name": name, "content": content[name]} for name in names]


# ---------- ⑤ 安全边界 ----------


def run_safety(case: dict, warned: list[dict]) -> dict:
    messages = case["template"]["messages"]
    refusals = [
        {
            "question_id": q["q_id"],
            "reason": "提问要求直接给出诊断结论，而诊断必须由医师结合完整病史与检查作出，助手不越界。",
        }
        for q in case["questions"]
        if any(marker in q["question"] for marker in REFUSAL_MARKERS)
    ]
    escalations = [
        {"row_id": r["row_id"], "item": r["item"], "value": r["value"], "message": messages["warn"]}
        for r in warned
    ]
    return {"refusals": refusals, "escalations": escalations}


# ---------- 画图与结论 ----------


def plot_overview(case: dict, warned: list[dict], fig_root: Path) -> dict:
    fig_dir = fig_root / FIG_DIR
    fig_dir.mkdir(parents=True, exist_ok=True)
    items = sorted({row["item"] for row in case["data"]})
    means = [statistics.fmean([float(r["value"]) for r in case["data"] if r["item"] == item]) for item in items]
    over = [sum(1 for r in warned if r["item"] == item) for item in items]

    # 图上的标签必须是 ASCII（镜像里没有中文字体），中文的对应关系写在 takeaway 里
    labels = [f"item {i + 1}" for i in range(len(items))]
    mapping = "；".join(f"item {i + 1}={item}" for i, item in enumerate(items))

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(9.2, 3.8))
    ax1.barh(labels, means, color="#1565c0")
    ax1.set_xlabel("mean value")
    ax1.set_title("Mean per item")
    ax2.barh(labels, over, color="#c62828")
    ax2.set_xlabel("out-of-range rows")
    ax2.set_title("Out-of-range rows per item")
    fig.tight_layout()
    fig.savefig(fig_dir / FIG_NAME, dpi=110)
    plt.close(fig)

    takeaway = (
        f"左侧是各指标均值、右侧是越界行数（共 {len(warned)} 行）："
        + "、".join(f"{r['item']} {r['value']:g}" for r in warned)
        + f"。指标编号：{mapping}。均值看整体水平，越界行才是个体需要复核的对象 —— "
        "两者必须分开看，否则会把异常平均掉。"
    )
    return {"path": f"{FIG_DIR}/{FIG_NAME}", "takeaway": takeaway}


def compose_notes(case: dict, calls: list[dict], warned: list[dict], entries: list[dict], applied: list[dict]) -> str:
    executed = [c for c in calls if c["args_valid"]]
    rejected = [c for c in calls if not c["args_valid"]]
    return (
        "四环都是「真的发生」的，不是摆设：① 记忆：从提问里按固定句式抽出 "
        f"{len(entries)} 条薄弱点条目（{entries[0]['fact'] if entries else '无'}），"
        f"并在后面的提问里应用了 {len(applied)} 次；② 工具：{len(calls)} 次调用里 "
        f"{len(executed)} 次通过 schema 校验并真的路由到本地 mock 执行、"
        f"{len(rejected)} 次因 "
        + "、".join(sorted({c["rejected_reason"] for c in rejected}))
        + " 被如实记为 rejected（**失败也要如实记录**，这才是工具调用的正确姿势）；"
        f"③ 技能：报告按模板生成四节（目的 / 方法 / 结果 / 讨论），每节都写到最小篇幅以上；"
        f"④ 出处：{len(warned)} 行越界读数逐行引用到行号级、解释引用到段落级。"
        "安全边界触发了两处：越界读数走升级 + 固定话术（不是照答），要求「直接下诊断」的提问被拒答 —— "
        "这两条比「跑通」更重要，因为医学场景里答错一句的代价远大于答不出来。"
        "局限要正视：本实验的「工具」是本地 mock（**不是真正的 MCP 服务**）、「编排」是自己的脚本"
        "（不是 LangGraph 这类框架）、「报告」是按模板拼的（**没有接大模型生成**）、"
        "「记忆」是本地条目表（不是 mem0 这类记忆服务）—— 环境无外网，这些都得用本地等价物代替；"
        "所以本实验验证的是「四环能不能自己接起来 + 边界守不守得住」，不是「工程方案是否上生产」。"
        "另外，检索与引用都只做到「字面与行级」，没有任何语义理解："
        "换一种问法就可能引用错段落，这一点必须写进使用说明。"
    )


# ---------- 单 case ----------


def run_case(case_dir: Path, fig_root: Path | None = None) -> tuple[dict, dict]:
    case = load_case(case_dir)
    fig_root = fig_root or Path(".")

    entries = write_memory(case["questions"])
    applied = apply_memory(case["questions"], entries)
    calls = run_tool_calls(case)
    warned = warn_rows(case)
    citations = build_citations(warned, case["passages"])
    safety = run_safety(case, warned)
    sections = build_sections(case, warned, calls, entries)

    out_entries = [{k: v for k, v in e.items() if not k.startswith("_")} for e in entries]
    key_facts = {
        "n_warn_rows": len(warned),
        "warn_row_ids": [r["row_id"] for r in warned],
        "n_call_executed": sum(1 for c in calls if c["args_valid"]),
        "n_call_rejected": sum(1 for c in calls if not c["args_valid"]),
        "weak_point": "/".join(entries[0]["_terms"]) if entries else "",
    }
    out = {
        "report": {"template_used": "report_template.json", "sections": sections},
        "tool_calls": calls,
        "memory": {"written": out_entries, "applied": applied},
        "citations": citations,
        "safety": safety,
        "key_facts": key_facts,
        "figures": [plot_overview(case, warned, fig_root)],
        "notes": compose_notes(case, calls, warned, entries, applied),
    }

    expected = {
        "note": (
            "参考水平（不是标准答案）：本章是**迁移检验**型任务 —— 学生只拿到需求与交付契约，"
            "没有参考实现（见 README「为什么不下发参考实现」）。这份 expected 由**教师侧**的解答样例"
            "（`solution/`，不下发）算出，用于证明「题目可解 + 判据不误杀」："
            "工具调用的校验与 mock 结果、越界行、引用、安全边界、key_facts 都是口径钉死后的确定值；"
            "报告文本与答案措辞**不在判据里**（只判篇幅与语义）。"
        ),
        "n_questions": len(case["questions"]),
        "tool_calls": [
            [c["call_id"], c["tool"], c["args_valid"], c["status"], c["rejected_reason"], c["result_summary"]]
            for c in calls
        ],
        "memory": {
            "written": [[e["entry_id"], e["fact"], e["category"]] for e in out_entries],
            "applied": [[a["question_id"], a["entry_id"]] for a in applied],
        },
        "citations": [[c["kind"], c["ref"]] for c in citations],
        "safety": {
            "refusal_question_ids": [r["question_id"] for r in safety["refusals"]],
            "escalations": [[e["row_id"], e["item"], e["message"]] for e in safety["escalations"]],
            "warn_message": case["template"]["messages"]["warn"],
        },
        "key_facts": key_facts,
        "section_names": [s["name"] for s in case["template"]["sections"]],
        "section_min_chars": [s["min_chars"] for s in case["template"]["sections"]],
    }
    return out, expected


def run_case_to_file(case_dir: Path, out_path: Path) -> None:
    out, _ = run_case(case_dir, Path("."))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[ok] {case_dir.name} → {out_path}")


def regen_expected() -> None:
    for case_dir in sorted(p for p in CASES_DIR.iterdir() if p.is_dir()):
        with tempfile.TemporaryDirectory() as tmp:
            _, expected = run_case(case_dir, Path(tmp))
        path = case_dir / "expected.json"
        path.write_text(json.dumps(expected, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"[regen] {path}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("case_dir", nargs="?")
    ap.add_argument("out_path", nargs="?")
    ap.add_argument("--regen-expected", action="store_true")
    args = ap.parse_args()

    if args.regen_expected:
        regen_expected()
        return
    if not args.case_dir or not args.out_path:
        ap.error("需要 <case目录> <output.json>，或用 --regen-expected")
    run_case_to_file(Path(args.case_dir), Path(args.out_path))


if __name__ == "__main__":
    main()
