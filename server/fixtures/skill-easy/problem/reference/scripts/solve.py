"""参考实现：把"数值 vs 参考区间"的判定下沉成脚本，写 output.json + 一张图。

用法：python3 scripts/solve.py <case目录> <output.json> [--fig-dir figures]
"""
import argparse
import csv
import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

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
    r = ranges.get(item)
    if r is None:
        return {"item": item, "value": float(raw) if raw not in ("", None) else None, "unit": None,
                "flag": "unknown", "critical": False, "reason": "参考区间表里没有该项目，不猜"}
    if raw in ("", None):
        return {"item": item, "value": None, "unit": r["unit"], "flag": "unknown", "critical": False,
                "reason": "报告单上该项没有数值"}
    v = float(raw)
    base = {"item": item, "value": v, "unit": r["unit"]}
    if r["critical_high"] is not None and v >= r["critical_high"]:
        return dict(base, flag="critical_high", critical=True, reason=f"≥ 危急阈值 {r['critical_high']}（闭区间，等于也算）")
    if r["critical_low"] is not None and v <= r["critical_low"]:
        return dict(base, flag="critical_low", critical=True, reason=f"≤ 危急阈值 {r['critical_low']}（闭区间，等于也算）")
    if r["ref_high"] is not None and v > r["ref_high"]:
        return dict(base, flag="high", critical=False, reason=f"高于参考上限 {r['ref_high']}（严格大于）")
    if r["ref_low"] is not None and v < r["ref_low"]:
        return dict(base, flag="low", critical=False, reason=f"低于参考下限 {r['ref_low']}（严格小于）")
    return dict(base, flag="normal", critical=False, reason=f"在参考区间内（{r['ref_low']}~{r['ref_high']}）")


def plot(counts, fig_dir: Path) -> dict:
    fig_dir.mkdir(parents=True, exist_ok=True)
    keys = [f for f in FLAGS if counts.get(f)]
    fig, ax = plt.subplots(figsize=(5.0, 3.6))
    ax.bar(range(len(keys)), [counts[k] for k in keys], color="#4C78A8")
    ax.set_xticks(range(len(keys)), keys, rotation=20)
    ax.set_ylabel("items")
    ax.set_title("Flags per item")
    fig.tight_layout()
    fig.savefig(fig_dir / "flags.png", dpi=110)
    plt.close(fig)
    n_crit = counts.get("critical_high", 0) + counts.get("critical_low", 0)
    return {
        "path": f"{fig_dir.as_posix()}/flags.png",
        "takeaway": f"共判 {sum(counts.values())} 项，其中危急值 {n_crit} 项（必须逐条说出依据阈值）；"
                    f"unknown {counts.get('unknown', 0)} 项是没有区间依据、不许猜的。",
    }


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
        if it["flag"] == "critical_high":
            alerts.append({"item": it["item"], "value": it["value"],
                           "threshold": ranges[it["item"]]["critical_high"], "side": "high"})
        elif it["flag"] == "critical_low":
            alerts.append({"item": it["item"], "value": it["value"],
                           "threshold": ranges[it["item"]]["critical_low"], "side": "low"})
    out = {
        "items": items,
        "critical_alerts": alerts,
        "summary": {"counts": counts, "n_unknown": counts["unknown"]},
        "figures": [plot(counts, Path(a.fig_dir))],
        "notes": (
            f"把 {len(rows)} 行报告单逐项判定：先查参考区间表，表里没有的项目直接判 unknown（不猜）；"
            "再说危急值 —— 危急阈值用**闭区间**，等于阈值也必须报警，宁可多提醒不可漏；"
            "参考区间用严格不等，恰好等于上限算正常。判定全部由脚本给出，模型只负责解释，"
            "这样同一份报告单每次都得到同一个 flag，不会出现「偏高」「略高」两种说法。"
        ),
    }
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
