"""造 case01 / case02 的检验报告单、参考区间表，并标定 expected.json（可重跑；不下发）。

口径（与 problem/task.md 一致）：
  · 危急值用**闭区间**：value >= critical_high → critical_high；value <= critical_low → critical_low
  · 参考区间用**严格不等**：value > ref_high → high；value < ref_low → low
  · 区间表里没有的项目 / 数值为空 → unknown（不许猜）
  · 某一侧阈值为空 → 该侧不判
判定顺序：危急高 → 危急低 → 偏高 → 偏低 → 正常。
"""
import csv
import json
from pathlib import Path

RANGES = [
    # item, unit, ref_low, ref_high, critical_low, critical_high
    ("ALT", "U/L", 7, 40, "", 500),
    ("AMY", "U/L", 28, 100, "", 300),
    ("CA", "mmol/L", 2.11, 2.52, 1.6, 3.5),
    ("CREA", "umol/L", 44, 106, "", 530),
    ("CRP", "mg/L", 0, 8, "", 100),
    ("GLU", "mmol/L", 3.9, 6.1, 2.8, 22.2),
    ("HBA1C", "%", 4.0, 6.0, "", ""),
    ("HGB", "g/L", 115, 150, 70, ""),
    ("K", "mmol/L", 3.5, 5.3, 2.8, 6.2),
    ("LDL", "mmol/L", "", 3.4, "", ""),
    ("PLT", "10^9/L", 125, 350, 30, 1000),
    ("TBIL", "umol/L", 5, 21, "", 340),
    ("TSH", "mIU/L", 0.35, 4.94, "", ""),
    ("WBC", "10^9/L", 3.5, 9.5, 1.5, 30),
]

CASES = {
    "case01": [
        ("K", 6.2), ("K", 5.3), ("GLU", 2.8), ("GLU", 6.5), ("HBA1C", 5.4),
        ("ALT", 620), ("CREA", 40), ("HGB", 68), ("WBC", 9.5), ("FT4", 12),
    ],
    "case02": [
        ("PLT", 30), ("CA", 3.5), ("LDL", 3.4), ("TSH", 0.35), ("CRP", 8), ("TBIL", 21),
        ("AMY", 300), ("WBC", 1.5), ("HBA1C", ""), ("K", 6.1), ("GLU", 22.2), ("XX", 1.0),
    ],
}


def load_ranges(rows):
    out = {}
    for item, unit, lo, hi, clo, chi in rows:
        out[item] = {
            "unit": unit,
            "ref_low": float(lo) if lo != "" else None,
            "ref_high": float(hi) if hi != "" else None,
            "critical_low": float(clo) if clo != "" else None,
            "critical_high": float(chi) if chi != "" else None,
        }
    return out


def judge(item, value, ranges):
    r = ranges.get(item)
    if r is None:
        return {"item": item, "value": float(value) if value != "" else None,
                "flag": "unknown", "critical": False}
    if value is None or value == "":
        return {"item": item, "value": None, "flag": "unknown", "critical": False}
    v = float(value)
    if r["critical_high"] is not None and v >= r["critical_high"]:
        return {"item": item, "value": v, "flag": "critical_high", "critical": True}
    if r["critical_low"] is not None and v <= r["critical_low"]:
        return {"item": item, "value": v, "flag": "critical_low", "critical": True}
    if r["ref_high"] is not None and v > r["ref_high"]:
        return {"item": item, "value": v, "flag": "high", "critical": False}
    if r["ref_low"] is not None and v < r["ref_low"]:
        return {"item": item, "value": v, "flag": "low", "critical": False}
    return {"item": item, "value": v, "flag": "normal", "critical": False}


def run(rows, ranges):
    items = [judge(item, value, ranges) for item, value in rows]
    flags = ["normal", "high", "low", "critical_high", "critical_low", "unknown"]
    counts = {f: sum(1 for it in items if it["flag"] == f) for f in flags}
    alerts = []
    for it in items:
        if it["flag"] == "critical_high":
            alerts.append({"item": it["item"], "value": it["value"],
                           "threshold": ranges[it["item"]]["critical_high"], "side": "high"})
        elif it["flag"] == "critical_low":
            alerts.append({"item": it["item"], "value": it["value"],
                           "threshold": ranges[it["item"]]["critical_low"], "side": "low"})
    return {
        "n_rows": len(rows),
        "n_judged": sum(1 for it in items if it["flag"] != "unknown"),
        "items": items,
        "critical_alerts": alerts,
        "summary": {"counts": counts, "n_unknown": counts["unknown"]},
    }


def main():
    root = Path(__file__).resolve().parent.parent / "problem" / "cases"
    ranges = load_ranges(RANGES)
    for name, rows in CASES.items():
        d = root / name
        d.mkdir(parents=True, exist_ok=True)
        with (d / "reference_ranges.csv").open("w", encoding="utf-8", newline="") as f:
            w = csv.writer(f)
            w.writerow(["item", "unit", "ref_low", "ref_high", "critical_low", "critical_high"])
            w.writerows(RANGES)
        with (d / "report.csv").open("w", encoding="utf-8", newline="") as f:
            w = csv.writer(f)
            w.writerow(["item", "value"])
            w.writerows(rows)
        (d / "expected.json").write_text(json.dumps({k: run(rows, ranges)[k] for k in ("items", "critical_alerts", "summary")},
                                                    ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print("写出", name)


if __name__ == "__main__":
    main()
