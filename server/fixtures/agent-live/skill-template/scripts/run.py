#!/usr/bin/env python3
"""跑完所有任务，产出 output.json + 一张图。**这个文件不用改。**

用法：
    python3 scripts/run.py --tasks <题目包>/tasks --out output.json
    python3 scripts/run.py --tasks <题目包>/tasks --out output.json --only T1_lookup
"""
from __future__ import annotations

import argparse
import json
import sys
import traceback
from pathlib import Path

SKILL_ROOT = Path(__file__).resolve().parents[1]
if str(SKILL_ROOT) not in sys.path:
    sys.path.insert(0, str(SKILL_ROOT))

import matplotlib  # noqa: E402

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

from agent.data import Packet, load_tasks  # noqa: E402
from agent.llm import LlmClient  # noqa: E402
from agent.loop import Ctx, run_dialogue  # noqa: E402
from agent.memory import Memory  # noqa: E402


def find_problem_dir(tasks_arg: str) -> Path:
    """--tasks 可以指 tasks/ 目录，也可以直接指题目包根。"""
    path = Path(tasks_arg).resolve()
    if path.name == "tasks":
        return path.parent
    if (path / "tasks").is_dir():
        return path
    raise SystemExit(f"--tasks 指向的地方既不是 tasks/ 也不是题目包根：{path}")


def read_notes() -> str:
    """notes 写在 SKILL 根的 notes.md 里（没有它，产出会缺 notes 字段）。"""
    path = SKILL_ROOT / "notes.md"
    if path.exists():
        return path.read_text(encoding="utf-8").strip()
    return "TODO：在 SKILL 根的 notes.md 里写你的取舍与局限（≥80 字）。"


def draw_figure(tool_counts: dict[str, int], figures_dir: Path) -> dict:
    """每组对话的工具调用次数（英文标签：容器里没有中文字体）。"""
    figures_dir.mkdir(parents=True, exist_ok=True)
    name = "tools_by_dialogue.png"
    labels = list(tool_counts)
    values = [tool_counts[k] for k in labels]
    fig, ax = plt.subplots(figsize=(8, 4), dpi=150)
    ax.bar(range(len(labels)), values, color="#3b7ddd")
    ax.set_xticks(range(len(labels)))
    ax.set_xticklabels(labels, rotation=20, ha="right", fontsize=8)
    ax.set_ylabel("tool calls")
    ax.set_title("Tool calls per dialogue")
    for i, v in enumerate(values):
        ax.text(i, v, str(v), ha="center", va="bottom", fontsize=8)
    fig.tight_layout()
    fig.savefig(figures_dir / name)
    plt.close(fig)
    return {
        "name": f"figures/{name}",
        "takeaway": f"tool calls by dialogue (total {sum(values)}); 0 means the agent answered without any tool",
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tasks", required=True, help="题目包的 tasks/ 目录（或题目包根）")
    ap.add_argument("--out", default="output.json")
    ap.add_argument("--only", default=None, help="只跑名字里含这个子串的一组（调试用）")
    args = ap.parse_args()

    problem_dir = find_problem_dir(args.tasks)
    packet = Packet(problem_dir)
    profile = json.loads((SKILL_ROOT / "agent" / "profile.json").read_text(encoding="utf-8"))
    client = LlmClient()

    dialogues = []
    tool_counts: dict[str, int] = {}
    for name, turns in load_tasks(problem_dir, args.only):
        print(f"[run] {name} ({len(turns)} turns) ...", flush=True)
        client.current["dialogue"] = name
        memory = Memory()
        ctx = Ctx(client=client, packet=packet, memory=memory, profile=profile)
        result = run_dialogue(turns, ctx)
        dialogues.append({
            "task": name,
            "terminated": result.get("terminated", []),
            "turns": result.get("turns", []),
            "memory": result.get("memory", memory.snapshot([])),
        })
        tool_counts[name] = sum(
            1
            for t in result.get("turns", [])
            for s in t.get("steps", [])
            if s.get("action") == "tool"
        )
        print(f"[done] {name}: {len(result.get('turns', []))} turns, {tool_counts[name]} tool calls", flush=True)

    all_turns = [t for d in dialogues for t in d["turns"]]
    metrics = {
        "dialogues": len(dialogues),
        "turns": len(all_turns),
        "tool_calls": sum(tool_counts.values()),
        "tool_errors": sum(
            1
            for t in all_turns
            for s in t.get("steps", [])
            if s.get("action") == "tool" and s.get("error") is True
        ),
        "llm_calls": len(client.calls),
        "refusals": sum(1 for t in all_turns if t.get("refused") is True),
    }

    figures = [draw_figure(tool_counts, SKILL_ROOT / "figures")]
    out = {
        "agent": {
            "name": profile.get("display_name") or "agent",
            "model": client.model,
            "max_steps_per_turn": int(packet.limits.get("max_steps_per_turn") or 0),
        },
        "llm": {"total_calls": len(client.calls), "calls": client.calls},
        "dialogues": dialogues,
        "metrics": metrics,
        "figures": figures,
        "notes": read_notes(),
    }
    out_path = Path(args.out).resolve()
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")

    print("\n=== summary ===")
    for k, v in metrics.items():
        print(f"{k:12s} {v}")
    print(f"output.json  {out_path}")
    print(f"figure       {figures[0]['name']}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception:  # noqa: BLE001 - 让学生一眼看到是哪一步炸的
        traceback.print_exc()
        raise SystemExit(1)
