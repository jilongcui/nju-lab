"""造题 + 生成参考值（**不下发**）：社区卫生站血压随访单表。

固定数据，可重跑（逐字节相同）。运行：
    python3 tools/gen_cases.py          # 生成 cases/case01|case02 的 visits.csv 与 expected.json
"""
import csv
import json
import statistics
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
CASES = HERE / "problem" / "cases"

DEPTS = ["全科", "心内科", "内分泌科", "肾内科"]

# 固定数据：case01 20 行（分布干净），case02 24 行（有人随访多次、有人血压偏高）
ROWS = {
    "case01": [
        ("V001", "P01", "2026-03-02", "全科", 128, 82),
        ("V002", "P02", "2026-03-02", "心内科", 152, 96),
        ("V003", "P03", "2026-03-03", "全科", 136, 88),
        ("V004", "P04", "2026-03-03", "内分泌科", 144, 90),
        ("V005", "P05", "2026-03-04", "肾内科", 118, 76),
        ("V006", "P06", "2026-03-04", "心内科", 160, 100),
        ("V007", "P07", "2026-03-05", "全科", 132, 84),
        ("V008", "P08", "2026-03-05", "内分泌科", 138, 86),
        ("V009", "P09", "2026-03-06", "肾内科", 146, 92),
        ("V010", "P10", "2026-03-06", "全科", 124, 80),
        ("V011", "P01", "2026-03-20", "全科", 130, 84),
        ("V012", "P02", "2026-03-20", "心内科", 148, 94),
        ("V013", "P11", "2026-03-21", "内分泌科", 142, 88),
        ("V014", "P12", "2026-03-21", "全科", 126, 82),
        ("V015", "P13", "2026-03-22", "肾内科", 154, 98),
        ("V016", "P14", "2026-03-22", "心内科", 120, 78),
        ("V017", "P15", "2026-03-23", "全科", 134, 86),
        ("V018", "P16", "2026-03-23", "内分泌科", 150, 94),
        ("V019", "P17", "2026-03-24", "肾内科", 122, 80),
        ("V020", "P18", "2026-03-24", "全科", 140, 90),
    ],
    "case02": [
        ("V001", "P01", "2026-04-01", "全科", 138, 88),
        ("V002", "P01", "2026-04-15", "全科", 142, 90),
        ("V003", "P01", "2026-04-29", "全科", 136, 86),
        ("V004", "P02", "2026-04-01", "心内科", 158, 98),
        ("V005", "P02", "2026-04-15", "心内科", 150, 94),
        ("V006", "P03", "2026-04-02", "内分泌科", 146, 92),
        ("V007", "P04", "2026-04-02", "肾内科", 120, 78),
        ("V008", "P05", "2026-04-03", "全科", 132, 84),
        ("V009", "P05", "2026-04-17", "全科", 128, 82),
        ("V010", "P06", "2026-04-03", "心内科", 162, 102),
        ("V011", "P07", "2026-04-04", "内分泌科", 140, 88),
        ("V012", "P08", "2026-04-04", "肾内科", 144, 90),
        ("V013", "P09", "2026-04-05", "全科", 126, 80),
        ("V014", "P10", "2026-04-05", "心内科", 148, 96),
        ("V015", "P10", "2026-04-19", "心内科", 152, 98),
        ("V016", "P11", "2026-04-06", "内分泌科", 134, 86),
        ("V017", "P12", "2026-04-06", "肾内科", 118, 76),
        ("V018", "P13", "2026-04-07", "全科", 130, 82),
        ("V019", "P14", "2026-04-07", "心内科", 156, 100),
        ("V020", "P15", "2026-04-08", "内分泌科", 142, 90),
        ("V021", "P16", "2026-04-08", "肾内科", 124, 80),
        ("V022", "P17", "2026-04-09", "全科", 136, 88),
        ("V023", "P18", "2026-04-09", "心内科", 150, 94),
        ("V024", "P19", "2026-04-10", "全科", 128, 82),
    ],
}


def expected_for(rows):
    high = sorted({r[1] for r in rows if r[4] >= 140 or r[5] >= 90})
    by_dept = {}
    for r in rows:
        by_dept[r[3]] = by_dept.get(r[3], 0) + 1
    dept_list = [{"department": d, "n": n} for d, n in by_dept.items()]
    dept_list.sort(key=lambda x: (-x["n"], x["department"]))
    avg = round(statistics.fmean(r[4] for r in rows), 1)
    twice = sorted({r[1] for r in rows if sum(1 for x in rows if x[1] == r[1]) >= 2})
    return {
        "n_rows": len(rows),
        "query_results": {
            "q1_high_bp": high,
            "q2_by_department": dept_list,
            "q3_avg_systolic": avg,
            "q4_followup_twice": twice,
        },
    }


def main():
    for name, rows in ROWS.items():
        case = CASES / name
        case.mkdir(parents=True, exist_ok=True)
        with (case / "visits.csv").open("w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(["visit_id", "patient_id", "visit_date", "department", "systolic", "diastolic"])
            w.writerows(rows)
        (case / "expected.json").write_text(
            json.dumps(expected_for(rows), ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        print(f"{name}: {len(rows)} 行 → visits.csv + expected.json")


if __name__ == "__main__":
    main()
