"""参考实现：把 visits.csv 导进 SQLite，用四条 SQL 回答医生的问题，写 output.json + 一张图。

用法：python3 scripts/solve.py <case目录> <output.json> [--fig-dir figures]
"""
import argparse
import csv
import json
import sqlite3
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

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
    db.executemany(
        "INSERT INTO visits VALUES (?, ?, ?, ?, ?, ?)",
        [(r["visit_id"], r["patient_id"], r["visit_date"], r["department"], int(r["systolic"]), int(r["diastolic"])) for r in rows],
    )
    return db, rows


def run_queries(db: sqlite3.Connection) -> dict:
    q1 = [r[0] for r in db.execute(
        "SELECT DISTINCT patient_id FROM visits WHERE systolic >= 140 OR diastolic >= 90 ORDER BY patient_id"
    )]
    q2 = [{"department": d, "n": n} for d, n in db.execute(
        "SELECT department, COUNT(*) AS n FROM visits GROUP BY department ORDER BY n DESC, department ASC"
    )]
    q3 = round(db.execute("SELECT AVG(systolic) FROM visits").fetchone()[0], 1)
    q4 = [r[0] for r in db.execute(
        "SELECT patient_id FROM visits GROUP BY patient_id HAVING COUNT(*) >= 2 ORDER BY patient_id"
    )]
    return {"q1_high_bp": q1, "q2_by_department": q2, "q3_avg_systolic": q3, "q4_followup_twice": q4}


# 复验镜像没有中文字体（HANDOFF 记过这个坑）：图里的轴标签一律英文，中文只放 takeaway
DEPT_EN = {"全科": "General", "心内科": "Cardiology", "内分泌科": "Endocrinology", "肾内科": "Nephrology"}


def plot(q2: list[dict], fig_dir: Path) -> dict:
    fig_dir.mkdir(parents=True, exist_ok=True)
    labels = [DEPT_EN.get(d["department"], d["department"]) for d in q2]
    values = [d["n"] for d in q2]
    fig, ax = plt.subplots(figsize=(4.6, 3.6))
    ax.bar(range(len(labels)), values, color="#4C78A8")
    ax.set_xticks(range(len(labels)), labels, rotation=20)
    ax.set_ylabel("visits")
    ax.set_title("Visits by department")
    fig.tight_layout()
    fig.savefig(fig_dir / "by_department.png", dpi=110)
    plt.close(fig)
    top = q2[0]
    total = sum(values)
    return {
        "path": f"{fig_dir.as_posix()}/by_department.png",
        "takeaway": f"{top['department']} 的随访次数最多（{top['n']} 次，占 {top['n'] / total:.0%}）。",
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("case_dir")
    ap.add_argument("out")
    ap.add_argument("--fig-dir", default="figures")
    a = ap.parse_args()

    db, rows = build(Path(a.case_dir))
    results = run_queries(db)
    fig = plot(results["q2_by_department"], Path(a.fig_dir))
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
        "figures": [fig],
        "notes": (
            f"把 {len(rows)} 行随访记录导入 SQLite 单表（主键 visit_id），四条查询分别是："
            "q1 用 WHERE 过滤加 DISTINCT 去重；q2 用 GROUP BY 聚合后按次数降序、科室名升序排；"
            "q3 用 AVG 取平均并保留 1 位小数；q4 用 GROUP BY + HAVING COUNT(*) >= 2 找随访两次以上的人。"
            f"血压超标的患者有 {len(results['q1_high_bp'])} 人，平均收缩压 {results['q3_avg_systolic']}；"
            "最容易写错的是 q2 的排序（次数相同的科室要按名字升序，否则结果顺序对不上）。"
        ),
    }
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
