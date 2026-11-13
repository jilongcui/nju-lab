#!/usr/bin/env python3
"""本地自测驱动（**不用改**）：用平台 harness 的等价物（`platform_core.py`）跑一遍 case。

    python3 run_case.py <case目录> <output.json>
    python3 run_case.py --regen-expected        # 教师侧：重算 expected.json

平台上跑的是同一套逻辑（`server/apps-image/platform/`）—— 所以这里跑通，发布后就该是这个效果。
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import tempfile
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

HERE = Path(__file__).resolve().parent
FIG = "report_overview.png"


def load_skill():
    spec = importlib.util.spec_from_file_location("student_skill", HERE / "scripts" / "api.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)  # type: ignore[union-attr]
    if not hasattr(module, "handle"):
        raise SystemExit("Skill 里没有 handle()：入口是 handle(state, message, attachments, session)")
    return module


def build_state(case_dir: Path) -> dict:
    state: dict = {"report": None, "kb": {}, "limits": {}}
    fmt = case_dir / "report_format.json"
    if fmt.exists():
        state["report"] = json.loads(fmt.read_text(encoding="utf-8"))
    kb_dir = case_dir / "kb"
    if kb_dir.is_dir():
        state["kb"] = {p.stem: p.read_text(encoding="utf-8") for p in sorted(kb_dir.glob("*.md"))}
    return state


def run_case(case_dir: Path, fig_dir: Path) -> dict:
    import platform_core  # 与平台同一份：附件解析 / 视觉 / 记忆 / 安全兜底

    skill = load_skill()
    state = build_state(case_dir)
    session: dict = {"turn": 0, "memory": [], "history": []}
    att_dir = case_dir / "attachments"
    requests = [json.loads(line) for line in (case_dir / "requests.jsonl").read_text(
        encoding="utf-8").splitlines() if line.strip()]

    turns = []
    last_report = None
    for req in requests:
        files = []
        for name in req.get("attachments") or []:
            path = att_dir / name
            kind = "pdf" if path.suffix == ".pdf" else "docx" if path.suffix == ".docx" else "image"
            files.append({"name": name, "kind": kind, "path": str(path), "size": path.stat().st_size})
        session["turn"] = int(req["turn"])
        # 平台侧记忆：用户说"报告只列异常指标"就记一条；说"忘掉 MEMxx"就遗忘
        if "报告只列异常指标" in req["message"]:
            platform_core.remember(session, "报告只列异常指标")
        for token in ("MEM01", "MEM02"):
            if f"忘掉 {token}" in req["message"]:
                platform_core.forget(session, token)
        state["memory"] = platform_core.active_memory(session)
        result = platform_core.run_turn(skill, state, req["message"], files, session)
        if result.get("report"):
            last_report = result["report"]
        turns.append({
            "turn": req["turn"], "message": req["message"],
            "reply": result.get("reply", ""),
            "counts": (result.get("report") or {}).get("counts"),
            "citations": result.get("citations", []),
            "escalations": len((result.get("safety") or {}).get("escalations", [])),
            "refusals": len((result.get("safety") or {}).get("refusals", [])),
        })

    plot(turns, fig_dir)
    return {
        "turns": turns,
        "report": last_report,
        "metrics": {
            "turns": len(turns),
            "total_rows": (last_report or {}).get("counts", {}).get("total", 0),
            "abnormal_rows": (last_report or {}).get("counts", {}).get("abnormal", 0),
            "listed_rows": (last_report or {}).get("counts", {}).get("listed", 0),
            "escalations": sum(t["escalations"] for t in turns),
            "refusals": sum(t["refusals"] for t in turns),
        },
        "figures": [{"path": f"figures/{FIG}", "takeaway": "每轮指标行数与答复长度（英文轴，便于无中文字体的环境出图）。"}],
        "notes": ("时间紧时先保证「每轮都有答复、报告四节齐全」；再补「只列异常」的偏好与越界升级。"
                  "局限：附件解析由平台完成，本 Skill 只负责判断与成文；真实报告还需要人工复核与签名。"),
    }


def plot(turns: list[dict], fig_dir: Path) -> None:
    fig_dir.mkdir(parents=True, exist_ok=True)
    labels = [f"T{t['turn']}" for t in turns]
    listed = [(t["counts"] or {}).get("listed", 0) for t in turns]
    plt.figure(figsize=(6, 3.2))
    plt.bar(labels, listed, color="#4c72b0")
    plt.title("Listed metric rows per turn")
    plt.xlabel("turn")
    plt.ylabel("rows")
    plt.tight_layout()
    plt.savefig(fig_dir / FIG, dpi=110)
    plt.close()


def cases_dir() -> Path:
    """`problem/reference/` 下用 `../cases`；学生骨架 `skill-template/` 下用 `../problem/cases`。"""
    for cand in (HERE.parent / "cases", HERE.parent / "problem" / "cases"):
        if cand.is_dir():
            return cand
    raise SystemExit("找不到 problem/cases")


def regen_expected() -> None:
    cases = cases_dir()
    for case_dir in sorted(p for p in cases.iterdir() if p.is_dir()):
        with tempfile.TemporaryDirectory() as tmp:
            out = run_case(case_dir, Path(tmp))
        fmt = json.loads((case_dir / "report_format.json").read_text(encoding="utf-8"))
        report = out["report"] or {}
        expected = {
            "turn_replies": len(out["turns"]),
            "turn_counts": [t["counts"] for t in out["turns"]],
            "turn_refusals": [t["refusals"] for t in out["turns"]],
            "turn_escalations": [t["escalations"] for t in out["turns"]],
            "report": {
                "section_names": [s["name"] for s in report.get("sections", [])],
                "section_min_chars": [s["min_chars"] for s in fmt["sections"]],
                "metric_rows": report.get("metric_rows", []),
                "counts": report.get("counts"),
            },
            "metrics": out["metrics"],
        }
        (case_dir / "expected.json").write_text(
            json.dumps(expected, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"[regen] {case_dir / 'expected.json'}")


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
    out = run_case(Path(args.case_dir), Path("figures"))
    Path(args.out_path).write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[ok] {args.case_dir} → {args.out_path}")


if __name__ == "__main__":
    main()
