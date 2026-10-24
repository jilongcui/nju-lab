"""你的方案：把 visits.csv 导进 SQLite → 四条 SQL → 写 output.json + 一张图。

**代码里的 TODO 才是你要改的地方**（文档 `SKILL.md` 不用改）。
用法：python3 scripts/solve.py <case目录> <output.json> [--fig-dir figures]
"""
import argparse
import csv
import json
import sqlite3
from pathlib import Path

DDL = """
CREATE TABLE visits (
  visit_id   TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL,
  visit_date TEXT NOT NULL,
  department TEXT NOT NULL,
  systolic   INTEGER NOT NULL,
  diastolic  INTEGER NOT NULL
)
"""


def build(case_dir: Path) -> tuple[sqlite3.Connection, list[dict]]:
    db = sqlite3.connect(":memory:")
    db.execute(DDL)
    with (case_dir / "visits.csv").open(encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    # TODO: 把 rows 逐行 INSERT 进 visits（注意 systolic/diastolic 要转成 int）
    return db, rows


def run_queries(db: sqlite3.Connection) -> dict:
    # TODO: 四条查询（口径与排序见 task.md）
    #   q1: 收缩压 >= 140 或 舒张压 >= 90 的 patient_id，DISTINCT + ORDER BY
    #   q2: 各科室 COUNT(*)，ORDER BY n DESC, department ASC
    #   q3: AVG(systolic)，round(..., 1)
    #   q4: GROUP BY patient_id HAVING COUNT(*) >= 2，ORDER BY patient_id
    return {"q1_high_bp": [], "q2_by_department": [], "q3_avg_systolic": 0.0, "q4_followup_twice": []}


def plot(q2: list[dict], fig_dir: Path) -> dict:
    # TODO: 画各科室随访次数柱状图；轴标签用英文（复验镜像没有中文字体），中文写进 takeaway
    fig_dir.mkdir(parents=True, exist_ok=True)
    return {"path": f"{fig_dir.as_posix()}/by_department.png", "takeaway": ""}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("case_dir")
    ap.add_argument("out")
    ap.add_argument("--fig-dir", default="figures")
    a = ap.parse_args()

    db, rows = build(Path(a.case_dir))
    results = run_queries(db)
    out = {
        "schema": {
            "table": "visits",
            "columns": [
                ["visit_id", "TEXT"], ["patient_id", "TEXT"], ["visit_date", "TEXT"],
                ["department", "TEXT"], ["systolic", "INTEGER"], ["diastolic", "INTEGER"],
            ],
            "primary_key": ["visit_id"],
        },
        "loaded": {"rows": len(rows)},
        "query_results": results,
        "figures": [plot(results["q2_by_department"], Path(a.fig_dir))],
        "notes": "",
    }
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
