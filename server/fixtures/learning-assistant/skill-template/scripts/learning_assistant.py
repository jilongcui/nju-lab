#!/usr/bin/env python3
"""第 19 章（智能体综合实践 · 收官）的**起点空壳**。

> ⚠️ 这一章**没有参考实现**（题目包 `problem/` 里没有 `reference/`）—— 这是**迁移检验**的设计：
> 需求、数据与交付契约都在 `task.md` 里，**怎么实现由你决定**。
> 这个空壳只做两件事：帮你把六份输入读进来、把 `output.json` 的整体结构摆好。
> 五个环节（记忆 / 工具 / 报告 / 引用 / 安全）**全部是 TODO**。

要填的五处（对应 `task.md` 里"必须真的发生"的五件事）：

  ① `write_memory` / `apply_memory`      —— 记忆：按固定句式抽薄弱点，并在后面的提问里应用
  ② `validate_call` / `run_tool_calls`   —— 工具：按 schema 校验（非法要有理由）、路由到本地 mock
  ③ `build_sections`                     —— 技能流程：按模板生成四节报告
  ④ `find_warn_rows` / `build_citations` —— 检索 + 出处：越界行 → 行级引用 + 段级引用
  ⑤ `run_safety`                         —— 安全边界：越界升级（固定话术）+ 要求下诊断的提问拒答

另外 `plot_overview`（画图）与 `compose_notes`（结论）也是 TODO。
已经给出的部分：读六份输入文件、把报告组装成 `output.json` 的骨架、命令行入口。

用法：
  python3 scripts/learning_assistant.py <case目录> <output.json>
"""
from __future__ import annotations

import argparse
import csv
import json
import re
from pathlib import Path

import matplotlib

matplotlib.use("Agg")  # 容器内无显示环境
import matplotlib.pyplot as plt  # noqa: E402

HERE = Path(__file__).resolve().parent
CASES_DIR = HERE.parent.parent / "problem" / "cases"
FIG_DIR = Path("figures")
FIG_NAME = "item_overview.png"

# 提示：薄弱点的固定句式（口径见 task.md）
WEAK_PATTERN = re.compile(r"老是搞混\s*([^\s，。！？、,]+)\s*和\s*([^\s，。！？、,]+)")
# 提示：需要拒答的措辞（口径见 task.md）
REFUSAL_MARKERS = ("直接告诉我", "你直接说")


# ---------------------------------------------------------------- 已给出：读六份输入


def load_case(case_dir: Path) -> dict:
    """读六份输入文件，返回一个字典（`questions` 按 `q_id`、`calls` 按 `call_id` 升序）。"""

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


# ---------------------------------------------------------------- ① TODO：记忆


def write_memory(questions: list[dict]) -> list[dict]:
    """TODO：按固定句式 `我老是搞混 <A> 和 <B>` 抽条目，按命中顺序编号 `MEM01`…

    每条给出 `{entry_id, fact, category: "weak_point"}`（`fact` 的写法见 task.md）。
    提示：后面要判断"应用"，所以你可能需要把 `<A>` / `<B>` 一起存下来（内部字段，写报告前删掉）。
    """
    raise NotImplementedError("TODO ①：写入记忆")


def apply_memory(questions: list[dict], entries: list[dict]) -> list[dict]:
    """TODO：对**写入该条记忆那一轮之后**的提问，若提问里**同时出现** `<A>` 与 `<B>`，记一次应用。

    返回 `[{"question_id", "entry_id"}]`（按 `question_id` 升序）。
    """
    raise NotImplementedError("TODO ①：应用记忆")


# ---------------------------------------------------------------- ② TODO：工具调用


def validate_call(args_raw: str, tool: dict | None) -> tuple[bool, str]:
    """TODO：按 task.md 的顺序（未知工具 → args 不是对象 → 缺必填 → 类型不符，命中即停）
    返回 `(args_valid, rejected_reason)`；合法时理由为空串。"""
    raise NotImplementedError("TODO ②：校验调用")


def execute_call(tool_name: str, args: dict, data: list[dict], passages: list[dict]) -> str:
    """TODO：mock 执行三个工具，返回摘要（三个工具的摘要格式都写死在 task.md 里）。"""
    raise NotImplementedError("TODO ②：mock 执行")


def run_tool_calls(case: dict) -> list[dict]:
    """TODO：对 `case["calls"]` 逐条校验 + 执行，返回
    `[{"call_id", "tool", "args_valid", "status", "rejected_reason", "result_summary"}]`。

    ⚠️ **非法的调用也要出现在结果里**（`status="rejected"` + 非空理由），不要跳过。
    """
    raise NotImplementedError("TODO ②：跑一遍工具调用")


# ---------------------------------------------------------------- ④ TODO：越界与出处


def find_warn_rows(case: dict) -> list[dict]:
    """TODO：按 `report_template.json` 的 `thresholds` 逐行判断越界，返回
    `[{"row_id", "item", "value"}]`（按 `row_id` 升序）。"""
    raise NotImplementedError("TODO ④：找越界行")


def build_citations(warned: list[dict], passages: list[dict]) -> list[dict]:
    """TODO：先全部 data 引用（按 `row_id` 升序），再全部 passage 引用
    （item 去重后按字符串升序，每个 item 取 `passage_id` 最小的那条）。格式见 task.md。"""
    raise NotImplementedError("TODO ④：生成出处")


# ---------------------------------------------------------------- ③ TODO：报告


def build_sections(case: dict, warned: list[dict], calls: list[dict], entries: list[dict]) -> list[dict]:
    """TODO：按 `report_template.json` 的 `sections`（名称与顺序）生成四节，
    每节 `content` 长度不低于对应的 `min_chars`。正文怎么写随你，但要建立在前面的结果上。"""
    raise NotImplementedError("TODO ③：生成报告四节")


# ---------------------------------------------------------------- ⑤ TODO：安全边界


def run_safety(case: dict, warned: list[dict]) -> dict:
    """TODO：返回 `{"refusals": [{"question_id", "reason"}], "escalations": [{"row_id", "item", "value", "message"}]}`。

    - 拒答：提问里出现 `REFUSAL_MARKERS` 任一措辞 → 该提问进 `refusals`，`reason` ≥10 字；
    - 升级：每个越界行一条，`message` **一字不改**地抄模板的 `messages.warn`。
    """
    raise NotImplementedError("TODO ⑤：安全边界")


# ---------------------------------------------------------------- 其余 TODO


def plot_overview(case: dict, warned: list[dict], fig_root: Path) -> dict:
    """TODO：画"各指标均值 + 越界行数"（存 `figures/item_overview.png`），返回 `{"path", "takeaway"}`。

    ⚠️ 图上的标签必须是 **ASCII**（镜像里没有中文字体）：用 `item 1` / `item 2` … 这类编号，
    并在 `takeaway` 里用中文写清"编号 → 指标名"的对应（中文写在 JSON 文本里是安全的）。
    """
    raise NotImplementedError("TODO：画图")


def compose_notes(case: dict, calls: list[dict], warned: list[dict], entries: list[dict], applied: list[dict]) -> str:
    """TODO：写 ≥60 字的结论。要点（见 task.md 与 judge.md）：

      - 记忆 / 工具 / 报告 / 引用 / 安全边界**每一环为什么这么做**
      - "检索结果 ≠ 结论"（引用只说明出处，不等于诊断）
      - **至少两条**真实的局限（mock 工具不是真 MCP、报告没接大模型生成、
        本地条目表不是 mem0、字面/行级检索的天花板……）
    """
    raise NotImplementedError("TODO：结论")


# ---------------------------------------------------------------- 已给出：组装与入口


def run_case(case_dir: Path, fig_root: Path | None = None) -> dict:
    case = load_case(case_dir)
    fig_root = fig_root or Path(".")

    entries = write_memory(case["questions"])
    applied = apply_memory(case["questions"], entries)
    calls = run_tool_calls(case)
    warned = find_warn_rows(case)
    citations = build_citations(warned, case["passages"])
    safety = run_safety(case, warned)
    sections = build_sections(case, warned, calls, entries)

    return {
        "report": {"template_used": "report_template.json", "sections": sections},
        "tool_calls": calls,
        "memory": {
            "written": [{k: v for k, v in e.items() if not k.startswith("_")} for e in entries],
            "applied": applied,
        },
        "citations": citations,
        "safety": safety,
        "key_facts": {
            "n_warn_rows": len(warned),
            "warn_row_ids": [r["row_id"] for r in warned],
            "n_call_executed": sum(1 for c in calls if c["args_valid"]),
            "n_call_rejected": sum(1 for c in calls if not c["args_valid"]),
            "weak_point": "/".join(entries[0]["_terms"]) if entries else "",
        },
        "figures": [plot_overview(case, warned, fig_root)],
        "notes": compose_notes(case, calls, warned, entries, applied),
    }


def run_case_to_file(case_dir: Path, out_path: Path) -> None:
    out = run_case(case_dir, Path("."))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[ok] {case_dir.name} → {out_path}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("case_dir", nargs="?")
    ap.add_argument("out_path", nargs="?")
    args = ap.parse_args()
    if not args.case_dir or not args.out_path:
        ap.error("需要 <case目录> <output.json>")
    run_case_to_file(Path(args.case_dir), Path(args.out_path))


if __name__ == "__main__":
    main()
