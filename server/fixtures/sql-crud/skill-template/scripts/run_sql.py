#!/usr/bin/env python3
"""实验一（关系数据库）的**起点骨架**：把你的实现写在标了 TODO 的地方。

结构已经搭好，与 `problem/reference/scripts/run_sql.py` 的函数划分**完全一致** ——
先跑通它、读懂它的输出，再回来把自己的 TODO 填掉。

要填的三处：
  ① `clean_table`   —— 清洗口径（task.md 的 6 条，顺序不能反）
  ② `apply_corrections` —— 按更正单做 DELETE / UPDATE / INSERT，并记录被外键拒绝的条数
  ③ `run_queries`   —— 三表 JOIN / GROUP BY / HAVING 回答三个临床问题

用法：
  python3 scripts/run_sql.py <case目录> <output.json>     # 单个 case（图写到当前目录的 figures/）
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sqlite3
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

HBA1C_ITEM = "HbA1c"
HBA1C_THRESHOLD = 7.0
FREQUENT_MIN_LABS = 3
FIG_DIR = Path("figures")

DEPT_EN = {
    "内分泌科": "Endocrinology",
    "心内科": "Cardiology",
    "肾内科": "Nephrology",
    "消化内科": "Gastroenterology",
    "普通内科": "General Medicine",
}

REQUIRED = {
    "patients": ["patient_id", "name", "birth_date", "sex"],
    "visits": ["visit_id", "patient_id", "department", "visit_date"],
    "labs": ["report_id", "visit_id", "item", "value", "unit"],
}
DATE_COLS = {"patients": "birth_date", "visits": "visit_date"}
CSV_HEADERS = {
    "patients": ["patient_id", "name", "birth_date", "sex"],
    "visits": ["visit_id", "patient_id", "department", "visit_date", "diagnosis"],
    "labs": ["report_id", "visit_id", "item", "value", "unit"],
}

DATE_PATTERNS = [
    (re.compile(r"^(\d{4})-(\d{1,2})-(\d{1,2})$"), ("y", "m", "d")),
    (re.compile(r"^(\d{4})/(\d{1,2})/(\d{1,2})$"), ("y", "m", "d")),
    (re.compile(r"^(\d{1,2})-(\d{1,2})-(\d{4})$"), ("d", "m", "y")),
]


# ---------------------------------------------------------------- 已给出：读数据 / 日期口径
def read_rows(case_dir: str | Path, table: str) -> list[dict]:
    """读原始 CSV（此时还带着空格、重复行、空字段）。"""
    with (Path(case_dir) / f"{table}.csv").open(encoding="utf-8", newline="") as fh:
        return [dict(r) for r in csv.DictReader(fh)]


def normalize_date(text: str) -> str | None:
    """三种输入格式 → `YYYY-MM-DD`（口径见 task.md）；无法解析返回 None。

    例：`2026/3/7` → `2026-03-07`；`07-03-2026` → `2026-03-07`（**日-月-年**）。
    """
    for pattern, order in DATE_PATTERNS:
        m = pattern.match(text)
        if m:
            parts = dict(zip(order, m.groups()))
            return f"{int(parts['y']):04d}-{int(parts['m']):02d}-{int(parts['d']):02d}"
    return None


def profile_tables(raw: dict[str, list[dict]]) -> dict:
    """② 摸清数据：行数已经有了；`problems_found` 请你补上"脏在哪几类"。"""
    return {
        "raw_rows": {t: len(rows) for t, rows in raw.items()},
        # TODO：列出你观察到的数据问题（重复行？空字段？非正数检验值？日期格式？外键对不上？）
        #   把判断写进列表，例如：
        #     problems.append("同一张表里有完全重复的行")
        #   判断重复的提示：把每行转成元组后放进 set，长度变短就说明有重复。
        "problems_found": [],
    }


# ---------------------------------------------------------------- TODO ①：清洗口径
def clean_table(table: str, rows: list[dict], known_ids: set[str],
                ref_col: str | None) -> tuple[list[dict], dict]:
    """④ 清洗一张表，返回 `(保留的行, {"invalid": n, "duplicates": m})`。

    口径（task.md「清洗口径」的 1~6 条，**顺序不能反**）：
      1. 每个字段去首尾空白；
      2. 必填字段为空 → 丢弃（必填清单见 REQUIRED[table]）；
      3. 日期列（DATE_COLS[table]）统一成 YYYY-MM-DD，无法解析 → 丢弃；
      4. `labs.value` 必须能转成 float 且 > 0，否则丢弃；
      5. 引用完整性：`ref_col` 的值必须在 `known_ids` 里（`labs` 传 visit_id 集合、
         `visits` 传 patient_id 集合、`patients` 传空集 + ref_col=None），对不上 → 丢弃；
      6. 去重：处理完的行内容完全相同 → 只留**首次出现**，其余计入 duplicates。

    最小示例（读一行、去空白、取出需要的列）：

        rec = {k: str(v).strip() for k, v in row.items() if k in CSV_HEADERS[table]}
        rec = {k: rec.get(k, "") for k in CSV_HEADERS[table]}

    提示：`labs.value` 入库时要是数字（`float(...)`），别把字符串塞进 REAL 列。
    """
    # TODO：实现 1~6 条口径
    raise NotImplementedError("TODO：按 task.md 的清洗口径实现 clean_table")


def load_and_clean(case_dir: str | Path) -> tuple[dict[str, list[dict]], dict]:
    """③④ 按依赖顺序清洗三张表：patients → visits → labs（后者要用前者的 id 集合）。"""
    raw = {t: read_rows(case_dir, t) for t in CSV_HEADERS}
    profile = profile_tables(raw)

    patients, d_p = clean_table("patients", raw["patients"], set(), None)
    visits, d_v = clean_table("visits", raw["visits"], {r["patient_id"] for r in patients}, "patient_id")
    labs, d_l = clean_table("labs", raw["labs"], {r["visit_id"] for r in visits}, "visit_id")

    dropped = {
        "invalid": d_p["invalid"] + d_v["invalid"] + d_l["invalid"],
        "duplicates": d_p["duplicates"] + d_v["duplicates"] + d_l["duplicates"],
    }
    profile["dropped"] = dropped
    return {"patients": patients, "visits": visits, "labs": labs}, profile


# ---------------------------------------------------------------- 已给出：建表 + 入库
def create_schema(conn: sqlite3.Connection) -> None:
    """③ 建库：患者—就诊—检验三张表。

    第一张表已经给你了（注意 `PRIMARY KEY`）；**另外两张表请你照着写**，别忘了：
      - `visits.patient_id` 要用 `REFERENCES patients(patient_id)` 指向患者表；
      - `labs.visit_id` 要用 `REFERENCES visits(visit_id)` 指向就诊表；
      - `labs.value` 用 `REAL`（也可以加 `CHECK (value > 0)`）。
    """
    conn.execute("PRAGMA foreign_keys = ON")  # ⚠️ 打开外键约束（默认是关的）
    conn.executescript(
        """
        CREATE TABLE patients (
          patient_id TEXT PRIMARY KEY,
          name       TEXT NOT NULL,
          birth_date TEXT NOT NULL,
          sex        TEXT NOT NULL
        );
        -- TODO：建 visits 表
        -- TODO：建 labs 表
        """
    )


def insert_rows(conn: sqlite3.Connection, tables: dict[str, list[dict]]) -> dict:
    """④ 入库。"""
    for table, cols in CSV_HEADERS.items():
        rows = tables[table]
        sql = f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})"
        conn.executemany(sql, [[r[c] for c in cols] for r in rows])
    conn.commit()
    return {t: len(rows) for t, rows in tables.items()}


def dump_schema(conn: sqlite3.Connection) -> dict:
    """把库的结构导出来（判据要核对主键与外键是否真的建了）。"""
    tables = []
    names = [r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )]
    for name in names:
        info = list(conn.execute(f"PRAGMA table_info({name})"))
        tables.append({
            "name": name,
            "columns": [[r[1], r[2]] for r in info],
            "primary_key": [r[1] for r in info if r[5] > 0],
            "foreign_keys": [
                {"from": r[3], "to_table": r[2], "to": r[4]}
                for r in conn.execute(f"PRAGMA foreign_key_list({name})")
            ],
        })
    return {"tables": tables}


# ---------------------------------------------------------------- TODO ②：增删改
def apply_corrections(conn: sqlite3.Connection, corrections: dict) -> dict:
    """⑤ 按更正单做增删改，返回各类条数（字段名见 task.md 的交付格式）。

    最小示例：

        cur = conn.execute("DELETE FROM labs WHERE report_id = ?", (report_id,))
        deleted += cur.rowcount

        conn.execute("UPDATE visits SET department = ? WHERE visit_id = ?", (dept, visit_id))

        try:
            conn.execute("INSERT INTO labs (...) VALUES (?, ?, ?, ?, ?)", (...))
            inserted_labs += 1
        except sqlite3.IntegrityError:
            # 外键拒绝了"引用不存在就诊"的报告 —— 这正是约束该起的作用
            rejected += 1

    返回的键要有：`deleted_labs` / `updated_visits` / `inserted_visits` / `inserted_labs` /
    `rejected_orphan_labs` / `final_visits` / `final_labs`（后两个用 `SELECT COUNT(*)` 取）。
    """
    # TODO：实现 DELETE / UPDATE / INSERT，并把被拒绝的条数如实记下来
    raise NotImplementedError("TODO：按 corrections.json 实现 apply_corrections")


# ---------------------------------------------------------------- TODO ③：查询
def run_queries(conn: sqlite3.Connection) -> dict:
    """⑥ 更正之后，用 SQL 回答三个临床问题（口径见 task.md「查询口径」）。

    返回：

        {
          "q1_hba1c_patients": ["P0004", ...],                       # 患者 ID，升序
          "q2_by_department": [{"department": ..., "n_patients": ...}, ...],  # 科室名升序
          "q3_frequent_patients": [{"patient_id": ..., "n_labs": ...}, ...]   # 患者 ID，升序
        }

    最小示例（三表 JOIN + 聚合的骨架）：

        SELECT v.patient_id
        FROM labs l JOIN visits v ON v.visit_id = l.visit_id
        WHERE l.item = ? AND l.value >= ?
        ORDER BY v.patient_id

    提示：`COUNT(DISTINCT v.patient_id)` 才能得到"患者数"（同一个人可能查过多次）。
    """
    # TODO：实现三个查询
    raise NotImplementedError("TODO：实现 run_queries 的三个查询")


# ---------------------------------------------------------------- 已给出：画图 + 组装报告
def plot_department_hba1c(query_results: dict, fig_dir: Path = FIG_DIR) -> dict:
    """⑥ 各科室超标患者数柱状图（图上的文字用英文：容器里没有中文字体）。"""
    fig_dir.mkdir(parents=True, exist_ok=True)
    rows = query_results["q2_by_department"]
    labels = [DEPT_EN.get(r["department"], r["department"]) for r in rows]
    values = [r["n_patients"] for r in rows]
    fig, ax = plt.subplots(figsize=(7, 4))
    bars = ax.bar(range(len(labels)), values, color="#4C78A8")
    ax.set_xticks(range(len(labels)))
    ax.set_xticklabels(labels, fontsize=8)
    ax.set_ylabel("patients with HbA1c >= 7.0")
    ax.set_title("HbA1c >= 7.0 patients by department (after corrections)")
    for b, v in zip(bars, values):
        ax.text(b.get_x() + b.get_width() / 2, v, str(v), ha="center", va="bottom", fontsize=8)
    fig.tight_layout()
    path = fig_dir / "hba1c_by_department.png"
    fig.savefig(path, dpi=110)
    plt.close(fig)
    top = max(rows, key=lambda r: r["n_patients"]) if rows else {"department": "-", "n_patients": 0}
    takeaway = (
        f"更正后 HbA1c >= 7.0 的患者共 {sum(values)} 人次、分布在 {len(rows)} 个科室，"
        f"最多的是 {top['department']}（{top['n_patients']} 人）。"
    )
    return {"path": str(path), "takeaway": takeaway}


def compose_notes(profile: dict, loaded: dict, crud: dict, query_results: dict) -> str:
    """⑥ 写结论：**这段最好你自己写** —— 数据有多脏、表怎么设计、约束起了什么作用、还有什么不足。"""
    # TODO：把下面这段话换成你自己的总结（判据要看你有没有说清机制与不足）
    return (
        f"原始三张表 {profile['raw_rows']}，清洗后入库 {loaded}；"
        f"更正后 HbA1c 超标患者 {len(query_results['q1_hba1c_patients'])} 人。"
    )


def build_report(case_dir: str | Path, fig_dir: Path = FIG_DIR, work_dir: Path = Path(".")) -> dict:
    tables, profile = load_and_clean(case_dir)
    corrections = json.loads((Path(case_dir) / "corrections.json").read_text(encoding="utf-8"))

    db_path = Path(work_dir) / "clinic.db"
    db_path.parent.mkdir(parents=True, exist_ok=True)
    if db_path.exists():
        db_path.unlink()

    conn = sqlite3.connect(db_path)
    try:
        create_schema(conn)
        loaded = insert_rows(conn, tables)
        schema = dump_schema(conn)
        crud = apply_corrections(conn, corrections)
        queries = run_queries(conn)
    finally:
        conn.close()

    figures = [plot_department_hba1c(queries, fig_dir)]
    return {
        "profile": profile,
        "schema": schema,
        "loaded": loaded,
        "dropped": profile["dropped"],
        "crud": crud,
        "query_results": queries,
        "figures": figures,
        "notes": compose_notes(profile, loaded, crud, queries),
    }


def run_case(case_dir: str | Path, out_path: str | Path, fig_dir: Path = FIG_DIR) -> dict:
    report = build_report(case_dir, fig_dir)
    Path(out_path).write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return report


def main() -> None:
    ap = argparse.ArgumentParser(description="检验数据入库与查询（你的实现）")
    ap.add_argument("case_dir")
    ap.add_argument("out")
    args = ap.parse_args()
    report = run_case(args.case_dir, args.out)
    print(json.dumps({k: v for k, v in report.items() if k != "schema"}, ensure_ascii=False))
    for fig in report["figures"]:
        print(f"  [图] {fig['path']} —— {fig['takeaway']}")


if __name__ == "__main__":
    main()
