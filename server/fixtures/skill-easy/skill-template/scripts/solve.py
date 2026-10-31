"""你的方案：把检验判定写成脚本，写 output.json + 一张图。

**代码里的 TODO 才是你要改的地方**（文档 `SKILL.md` 不用改）。
用法：python3 scripts/solve.py <case目录> <output.json> [--fig-dir figures]
"""
import argparse
import csv
import json
from pathlib import Path

FLAGS = ["normal", "high", "low", "critical_high", "critical_low", "unknown"]


def load_case(case_dir: Path):
    with (case_dir / "reference_ranges.csv").open(encoding="utf-8") as f:
        ranges = {}
        for r in csv.DictReader(f):
            num = lambda s: float(s) if s not in ("", None) else None  # noqa: E731
            ranges[r["item"]] = {
                "unit": r["unit"],
                "ref_low": num(r["ref_low"]),
                "ref_high": num(r["ref_high"]),
                "critical_low": num(r["critical_low"]),
                "critical_high": num(r["critical_high"]),
            }
    with (case_dir / "report.csv").open(encoding="utf-8") as f:
        rows = [(r["item"], r["value"]) for r in csv.DictReader(f)]
    return ranges, rows


def judge(item, raw, ranges):
    # TODO: 按 task.md 的七条顺序判定，返回 {item, value, unit, flag, critical, reason}
    #   1) 区间表没有该项目 → unknown（不许猜）  2) 空值 → unknown
    #   3) value >= critical_high → critical_high  4) value <= critical_low → critical_low
    #   5) value > ref_high → high  6) value < ref_low → low  7) 其余 → normal
    return {"item": item, "value": None, "unit": None, "flag": "unknown", "critical": False, "reason": ""}


def plot(counts, fig_dir: Path) -> dict:
    # TODO: 画各类 flag 项数柱状图；轴标签用英文（复验镜像没有中文字体），中文写进 takeaway
    fig_dir.mkdir(parents=True, exist_ok=True)
    return {"path": f"{fig_dir.as_posix()}/flags.png", "takeaway": ""}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("case_dir")
    ap.add_argument("out")
    ap.add_argument("--fig-dir", default="figures")
    a = ap.parse_args()

    ranges, rows = load_case(Path(a.case_dir))
    items = [judge(item, raw, ranges) for item, raw in rows]
    counts = {f: sum(1 for it in items if it["flag"] == f) for f in FLAGS}
    alerts = []
    for it in items:
        # TODO: 抽危急值（带 threshold 与 side：high / low）
        pass
    out = {
        "items": items,
        "critical_alerts": alerts,
        "summary": {"counts": counts, "n_unknown": counts["unknown"]},
        "figures": [plot(counts, Path(a.fig_dir))],
        "notes": "",
    }
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
