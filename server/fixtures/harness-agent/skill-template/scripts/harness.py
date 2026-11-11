#!/usr/bin/env python3
"""第 19 章：随访助手 harness 的**起点骨架**（只有结构，没有答案）。

六个部件各留一个函数，`run_case()` 把它们串起来。你只需要填函数体；
读数据、写文件、画图的胶水已经给好了。

思路：harness 的职责是"把模型的一次决定变成可执行、可核对、可解释的一步"。
所以每个部件都要留下**证据**（trace / 条目表 / 调用记录 / 检索结果），
证据进 `output.json` 才判得了、也才 debug 得动。

用法：
    python3 scripts/harness.py <case目录> <output.json>
"""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")  # 容器内无显示环境
import matplotlib.pyplot as plt  # noqa: E402


# ---------------------------------------------------------------- 读输入（已给好）

def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def read_case(case_dir: Path) -> dict:
    limits = json.loads((case_dir / "limits.json").read_text(encoding="utf-8"))
    with (case_dir / "records.csv").open(encoding="utf-8", newline="") as fh:
        records = list(csv.DictReader(fh))
    for r in records:
        r["value"] = float(r["value"])
    kb = {}
    for path in sorted((case_dir / "kb").glob("*.md")):
        kb[path.stem] = path.read_text(encoding="utf-8")
    return {
        "limits": limits,
        "records": records,
        "kb": kb,
        "tools": json.loads((case_dir / "tools.json").read_text(encoding="utf-8"))["tools"],
        "dialogue": read_jsonl(case_dir / "dialogue.jsonl"),
        "calls": read_jsonl(case_dir / "tool_calls.jsonl"),
        "plan": {t["turn"]: t["steps"] for t in
                 json.loads((case_dir / "plan_stub.json").read_text(encoding="utf-8"))["turns"]},
    }


# ---------------------------------------------------------------- ④ 检索（TODO）

def bm25_rank(query: str, kb: dict[str, str], top_k: int) -> list[str]:
    """返回按 BM25 降序的 passage_id 列表。

    原理一句：把 query 与文档都切成字符 2-gram，按"这个词在本篇常见、在别的篇少见"加权求和，
    再按文档长度做归一化 —— 否则长文档仅因为长就赢。
    最小示例：`grams("血红") == ["血红"]`；`grams("血红蛋白") == ["血红","红蛋","蛋白"]`。
    口径（归一化、k1/b、同分按 id 升序）见 task.md §四，必须逐条对上。
    """
    raise NotImplementedError("TODO: 实现 BM25 排序（口径见 task.md §四）")


def tf_cosine_rank(query: str, kb: dict[str, str], top_k: int) -> list[str]:
    """返回按 TF 余弦降序的 passage_id 列表（**不做 idf、不做长度归一**）。

    原理一句：这就是"朴素做法"——query 与文档的词项向量夹角越小越相关；
    因为没做长度归一，长综述会占便宜，正好用来说明 BM25 的归一化在解决什么问题。
    """
    raise NotImplementedError("TODO: 实现 TF 余弦对照（口径见 task.md §四）")


# ---------------------------------------------------------------- ③ 工具层（TODO）

def validate_call(call: dict, tools: dict, records: list[dict], out_ids: set[str]):
    """四级参数校验 + 一级业务校验，命中即停。

    返回 `(args_valid, rejected_reason, error_code)`。
    原理一句：**先校验再执行** —— 参数不对就调下去，等于把错误变成"看起来成功的脏数据"。
    最小示例：`validate_call({"tool":"nope","args":{}}, tools, records, out_ids)`
    应得 `(False, "unknown_tool", -32601)`。
    """
    raise NotImplementedError("TODO: 实现校验顺序（task.md §3.1 的六级表格）")


def mock_execute(call: dict, records: list[dict], kb: dict[str, str]) -> str:
    """按写死格式返回结果摘要（task.md §3.2 的四行表格）。

    原理一句：mock 的返回值也必须**格式钉死**，否则"执行成功"这件事无法被机器核对。
    """
    raise NotImplementedError("TODO: 实现四个工具的 mock 摘要")


# ---------------------------------------------------------------- ② 记忆（TODO）

def fact_pair(fact: str):
    """从条目 `fact` 里取回 `(A, B)`，例如 `老是搞混 白细胞计数 和 血小板计数` → `(白细胞计数, 血小板计数)`。"""
    raise NotImplementedError("TODO: 解析固定句式")


def apply_memory(entries: list[dict], text: str, turn: int) -> list[dict]:
    """返回本轮**命中应用**的记录 `[{"turn", "entry_id"}]`（只看 active 条目；含「更正：」的轮返回空）。"""
    raise NotImplementedError("TODO: 实现记忆应用判定")


def update_memory(entries: list[dict], text: str, seq: int) -> int:
    """处理遗忘 / 更正 / 写入，返回更新后的自增序号。

    原理一句：更新不是"改一条"，而是**保留历史 + 换状态** ——
    否则"上次记错了"这件事会永远消失，后面就分不清哪条被纠正过。
    """
    raise NotImplementedError("TODO: 实现遗忘（forgotten）/ 更正（superseded + 新建）/ 写入")


# ---------------------------------------------------------------- ① 循环（TODO）

def run_turn(turn: dict, steps: list[dict], ctx: dict) -> tuple[list[dict], str]:
    """执行一轮的决策序列，返回 `(trace 片段, 终止原因)`；终止原因是 `done` 或 `max_steps`。

    原理一句：**循环的价值在观测** —— 每步都要把"看到了什么"写下来，
    否则模型下一步凭什么改计划、出错了又凭什么定位。
    注意 `max_steps` 是**每轮**的硬上限（task.md §二）。
    约定：执行成功的工具名请写进 `ctx["executed"]`（下面的胶水代码要靠它写 short 摘要）。
    """
    raise NotImplementedError("TODO: 实现 loop（四种 action + 截断口径）")


# ---------------------------------------------------------------- ⑤⑥ 安全与答案（TODO）

def scan_safety(records: list[dict], limits: dict) -> list[dict]:
    """扫出全部越界行，按 record_id 升序返回升级条目（固定话术逐字照抄）。"""
    raise NotImplementedError("TODO: 实现越界扫描（task.md §五）")


def build_answer(turn: int, text: str, bm25_top: list[str], executed: list[str]) -> dict:
    """拼一轮的 `{"turn", "answer", "citations"}`；拒答轮 `citations` 为空。"""
    raise NotImplementedError("TODO: 实现答案与出处（task.md §六）")


def plot_overview(trace: list[dict], dialogue: list[dict], fig_dir: Path) -> str:
    """画"每轮步数"柱状图，返回相对路径（图上的标签用英文/ASCII）。"""
    fig_dir.mkdir(parents=True, exist_ok=True)
    turns = [int(t["turn"]) for t in dialogue]
    steps = [sum(1 for s in trace if s["turn"] == t) for t in turns]
    plt.figure(figsize=(6, 3.2))
    plt.bar([f"T{t}" for t in turns], steps, color="#4c72b0")
    plt.title("Steps per turn (harness loop)")
    plt.xlabel("turn")
    plt.ylabel("steps")
    plt.tight_layout()
    path = fig_dir / "harness_overview.png"
    plt.savefig(path, dpi=110)
    plt.close()
    return f"figures/harness_overview.png"


# ---------------------------------------------------------------- 串起来

def run_case(case_dir: Path) -> dict:
    case = read_case(case_dir)
    limits = case["limits"]
    tools = {t["name"]: t for t in case["tools"]}
    out_ids = {r["record_id"] for r in scan_safety(case["records"], limits)}

    entries: list[dict] = []
    seq = 0
    trace: list[dict] = []
    retrieval: list[dict] = []
    applied: list[dict] = []
    answers: list[dict] = []
    short: list[str] = []
    working: list[str] = []
    terminated: list[str] = []

    for turn in case["dialogue"]:
        t = int(turn["turn"])
        text = turn["user"]

        # 1 检索 / 2 记忆应用
        bm25_top = bm25_rank(text, case["kb"], int(limits["top_k"]))
        cos_top = tf_cosine_rank(text, case["kb"], int(limits["top_k"]))
        retrieval.append({"turn": t, "bm25_top3": bm25_top, "cosine_top3": cos_top})
        used = apply_memory(entries, text, t)
        applied.extend(used)

        # 3 loop
        ctx = {
            "turn": t, "tools": tools, "records": case["records"], "kb": case["kb"],
            "out_ids": out_ids, "bm25_top": bm25_top, "used": used,
            "max_steps": int(limits["max_steps"]),
        }
        chunk, reason = run_turn(turn, case["plan"].get(t, []), ctx)
        trace.extend(chunk)
        terminated.append(reason)

        # 4 记忆更新
        seq = update_memory(entries, text, seq)

        # 5 安全 / 6 答案
        answers.append(build_answer(t, text, bm25_top, ctx.get("executed", [])))

        # 7 三层收尾
        working = (working + [f"T{t}: {text[:20]}"])[-int(limits["window"]):]
        short.append(f"T{t}: 步 {len(chunk)} / 工具 {','.join(ctx.get('executed', [])) or '-'} / "
                     f"命中 {bm25_top[0] if bm25_top else '-'}")

    # 工具全量记账
    tool_calls = []
    for call in case["calls"]:
        ok, reason, code = validate_call(call, tools, case["records"], out_ids)
        tool_calls.append({
            "call_id": call["call_id"], "tool": call["tool"], "args_valid": ok,
            "status": "executed" if ok else "rejected", "error_code": code,
            "rejected_reason": reason,
            "result_summary": mock_execute(call, case["records"], case["kb"]) if ok else "",
        })

    safety = {"escalations": scan_safety(case["records"], limits), "refusals": []}
    fig_path = plot_overview(trace, case["dialogue"], Path("figures"))

    return {
        "harness": {
            "turns": len(case["dialogue"]),
            "max_steps": int(limits["max_steps"]),
            "steps_total": len(trace),
            "terminated": terminated,
        },
        "trace": trace,
        "tool_calls": tool_calls,
        "memory": {
            "working": working,
            "short": short,
            "long": {k: [e for e in entries if e.get("state") == k]
                     for k in ("active", "superseded", "forgotten")},
            "applied": applied,
        },
        "retrieval": retrieval,
        "answers": answers,
        "safety": safety,
        "metrics": {
            "top3_diff_turns": [r["turn"] for r in retrieval
                                if r["bm25_top3"] != r["cosine_top3"]],
            "tool_executed": sum(1 for c in tool_calls if c["args_valid"]),
            "tool_rejected": sum(1 for c in tool_calls if not c["args_valid"]),
            "trace_checksum": "TODO",  # 见 task.md §六
        },
        "figures": [{"path": fig_path, "takeaway": "……（一句话结论，数字要与 metrics 自洽）"}],
        "notes": "……（≥60 字：每个部件为什么这么做、BM25 与对照差在哪、至少两条局限）",
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("case_dir", help="题目包里的 cases/case01 之类")
    ap.add_argument("out_path", help="output.json 写到哪里")
    args = ap.parse_args()
    out = run_case(Path(args.case_dir))
    Path(args.out_path).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out_path).write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n",
                                   encoding="utf-8")
    print(f"[ok] {args.case_dir} → {args.out_path}")


if __name__ == "__main__":
    main()
