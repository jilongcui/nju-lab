#!/usr/bin/env python3
"""实验一（关系数据库）的参考实现（学习示范）：三张 CSV + 更正单 → `clinic.db` + `output.json` + 一张图。

📖 这份实现**随题目包一起下发**（`problem/reference/`）—— 先读懂它，再写你自己的。
   **它不是唯一正确答案**：表名、列类型、清洗代码怎么写都可以，判据只看
   "清洗后的行数 / 更正是否真的落到库里 / 查询结果对不对 + 说清设计"。

本实现走完**完整流程**（与 task.md 的六步对应）：
  ① 看清需求      —— 把"要能查、能改、能追溯"翻译成表结构与约束
  ② 摸清数据      —— `profile_tables`：先数行数、再数脏在哪（不急着建库）
  ③ 设计并建库    —— `create_schema`：三张表 + 主键 + 外键（`PRAGMA foreign_keys=ON`）
  ④ 清洗入库      —— `load_and_clean` + `insert_rows`：口径写死，脏行丢弃并计数
  ⑤ 增删改查      —— `apply_corrections`（删 / 改 / 插入，含一条必须被外键拒绝的）
  ⑥ 查询与结论    —— `run_queries` + `plot_department_hba1c` + `compose_notes`

用法：
  python3 scripts/run_sql.py <case目录> <output.json>      # 单个 case（图写到当前目录的 figures/）
  python3 scripts/run_sql.py --regen-expected              # 重算 problem/cases/*/expected.json

请在**与复验同一个镜像内**生成 expected（当前 pkg6）：

  docker run --rm -v "$PWD:/w" --entrypoint python3 \
    nju-lab-verify:0.2.0-rc.2-pkg6 /w/problem/reference/scripts/run_sql.py --regen-expected
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sqlite3
from pathlib import Path

import matplotlib

matplotlib.use("Agg")  # 容器内无显示环境
import matplotlib.pyplot as plt  # noqa: E402

HBA1C_ITEM = "HbA1c"
HBA1C_THRESHOLD = 7.0
FREQUENT_MIN_LABS = 3
FIG_DIR = Path("figures")

# 图上的文字必须用英文：容器里没有中文字体，中文会渲染成方框（见 task.md 的提醒）
DEPT_EN = {
    "内分泌科": "Endocrinology",
    "心内科": "Cardiology",
    "肾内科": "Nephrology",
    "消化内科": "Gastroenterology",
    "普通内科": "General Medicine",
}

HERE = Path(__file__).resolve().parent
CASES_DIR = HERE.parent.parent / "cases"

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


def normalize_date(text: str) -> str | None:
    """② 三种输入格式 → `YYYY-MM-DD`；无法解析返回 None（该行丢弃）。"""
    for pattern, order in DATE_PATTERNS:
        m = pattern.match(text)
        if m:
            parts = dict(zip(order, m.groups()))
            return f"{int(parts['y']):04d}-{int(parts['m']):02d}-{int(parts['d']):02d}"
    return None


def read_rows(case_dir: str | Path, table: str) -> list[dict]:
    """② 读原始 CSV（此时还带着空格、重复行、空字段）。"""
    with (Path(case_dir) / f"{table}.csv").open(encoding="utf-8", newline="") as fh:
        return [dict(r) for r in csv.DictReader(fh)]


def profile_tables(raw: dict[str, list[dict]]) -> dict:
    """② 摸清数据：行数 + 脏在哪（给报告里的 `profile`，也是写清洗代码的依据）。"""
    problems = []
    if any(len({tuple(str(v).strip() for v in r.values()) for r in rows}) < len(rows)
           for rows in raw.values()):
        problems.append("同一张表里有完全重复的行")
    if any(any(not str(v).strip() for v in r.values()) for rows in raw.values() for r in rows):
        problems.append("有字段是空的")
    if any(re.fullmatch(r"\s*[-+]?\d+(\.\d+)?\s*", str(r["value"])) is None
           or float(str(r["value"])) <= 0 for r in raw["labs"]):
        problems.append("检验值不是正数（或不是数字）")
    if any(re.fullmatch(r"\d{4}[-/]\d{1,2}[-/]\d{1,2}", str(r["visit_date"]).strip()) is None
           for r in raw["visits"]):
        problems.append("日期格式不统一")
    problems.append("可能有外键对不上的行（检验报告的 visit_id / 就诊的 patient_id）")
    return {
        "raw_rows": {t: len(rows) for t, rows in raw.items()},
        "problems_found": problems,
    }


def clean_table(table: str, rows: list[dict], known_ids: set[str],
                ref_col: str | None) -> tuple[list[dict], dict]:
    """④ 清洗：去空白 → 校验必填/日期/数值 → 引用完整性 → 去重（留首次出现）。"""
    kept: list[dict] = []
    seen: set[tuple] = set()
    invalid = duplicates = 0

    for row in rows:
        rec = {k: str(v).strip() for k, v in row.items() if k in CSV_HEADERS[table]}
        rec = {k: rec.get(k, "") for k in CSV_HEADERS[table]}

        # 必填字段为空 → 丢弃
        if any(rec[c] == "" for c in REQUIRED[table]):
            invalid += 1
            continue

        # 日期统一（不可解析 → 丢弃）
        date_col = DATE_COLS.get(table)
        if date_col:
            fixed = normalize_date(rec[date_col])
            if fixed is None:
                invalid += 1
                continue
            rec[date_col] = fixed

        # 检验值必须是正数
        if table == "labs":
            try:
                value = float(rec["value"])
            except ValueError:
                invalid += 1
                continue
            if value <= 0:
                invalid += 1
                continue
            rec["value"] = value

        # 引用完整性
        if ref_col and rec[ref_col] not in known_ids:
            invalid += 1
            continue

        # 去重：清洗后整行相同 → 只留首次出现
        key = tuple(str(rec[c]) for c in CSV_HEADERS[table])
        if key in seen:
            duplicates += 1
            continue
        seen.add(key)
        kept.append(rec)

    return kept, {"invalid": invalid, "duplicates": duplicates}


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


def create_schema(conn: sqlite3.Connection) -> None:
    """③ 设计并建库：主键保证唯一、外键保证引用完整（`PRAGMA foreign_keys=ON` 让约束真的生效）。"""
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript(
        """
        CREATE TABLE patients (
          patient_id TEXT PRIMARY KEY,
          name       TEXT NOT NULL,
          birth_date TEXT NOT NULL,
          sex        TEXT NOT NULL
        );
        CREATE TABLE visits (
          visit_id   TEXT PRIMARY KEY,
          patient_id TEXT NOT NULL REFERENCES patients(patient_id),
          department TEXT NOT NULL,
          visit_date TEXT NOT NULL,
          diagnosis  TEXT
        );
        CREATE TABLE labs (
          report_id TEXT PRIMARY KEY,
          visit_id  TEXT NOT NULL REFERENCES visits(visit_id),
          item      TEXT NOT NULL,
          value     REAL NOT NULL CHECK (value > 0),
          unit      TEXT NOT NULL
        );
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


def apply_corrections(conn: sqlite3.Connection, corrections: dict) -> dict:
    """⑤ 增删改查：按更正单执行 DELETE / UPDATE / INSERT，并如实记录被拒绝的插入。"""
    conn.execute("PRAGMA foreign_keys = ON")
    deleted = 0
    for report_id in corrections["retract_labs"]:
        cur = conn.execute("DELETE FROM labs WHERE report_id = ?", (report_id,))
        deleted += cur.rowcount

    updated = 0
    for item in corrections["update_visit_departments"]:
        cur = conn.execute(
            "UPDATE visits SET department = ? WHERE visit_id = ?",
            (item["new_department"], item["visit_id"]),
        )
        updated += cur.rowcount

    inserted_visits = 0
    for v in corrections["add_visits"]:
        conn.execute(
            "INSERT INTO visits (visit_id, patient_id, department, visit_date, diagnosis)"
            " VALUES (?, ?, ?, ?, ?)",
            (v["visit_id"], v["patient_id"], v["department"], v["visit_date"], v["diagnosis"]),
        )
        inserted_visits += 1

    inserted_labs = rejected = 0
    for lab in corrections["add_labs"]:
        try:
            conn.execute(
                "INSERT INTO labs (report_id, visit_id, item, value, unit) VALUES (?, ?, ?, ?, ?)",
                (lab["report_id"], lab["visit_id"], lab["item"], float(lab["value"]), lab["unit"]),
            )
            inserted_labs += 1
        except sqlite3.IntegrityError:
            # 外键拒绝了"引用不存在就诊"的报告 —— 这正是约束该起的作用
            rejected += 1
    conn.commit()

    return {
        "deleted_labs": deleted,
        "updated_visits": updated,
        "inserted_visits": inserted_visits,
        "inserted_labs": inserted_labs,
        "rejected_orphan_labs": rejected,
        "final_visits": conn.execute("SELECT COUNT(*) FROM visits").fetchone()[0],
        "final_labs": conn.execute("SELECT COUNT(*) FROM labs").fetchone()[0],
    }


def dump_schema(conn: sqlite3.Connection) -> dict:
    """把库的结构导出来（判据要核对：主键、外键是不是真的建了）。"""
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


def run_queries(conn: sqlite3.Connection) -> dict:
    """⑥ 更正之后，用 SQL 回答临床问题（三表 JOIN + 聚合）。"""
    q1 = [
        r[0] for r in conn.execute(
            """
            SELECT DISTINCT v.patient_id
            FROM labs l JOIN visits v ON v.visit_id = l.visit_id
            WHERE l.item = ? AND l.value >= ?
            ORDER BY v.patient_id
            """,
            (HBA1C_ITEM, HBA1C_THRESHOLD),
        )
    ]
    q2 = [
        {"department": r[0], "n_patients": r[1]} for r in conn.execute(
            """
            SELECT v.department, COUNT(DISTINCT v.patient_id)
            FROM labs l JOIN visits v ON v.visit_id = l.visit_id
            WHERE l.item = ? AND l.value >= ?
            GROUP BY v.department
            ORDER BY v.department
            """,
            (HBA1C_ITEM, HBA1C_THRESHOLD),
        )
    ]
    q3 = [
        {"patient_id": r[0], "n_labs": r[1]} for r in conn.execute(
            """
            SELECT v.patient_id, COUNT(*)
            FROM labs l JOIN visits v ON v.visit_id = l.visit_id
            GROUP BY v.patient_id
            HAVING COUNT(*) >= ?
            ORDER BY v.patient_id
            """,
            (FREQUENT_MIN_LABS,),
        )
    ]
    return {
        "q1_hba1c_patients": q1,
        "q2_by_department": q2,
        "q3_frequent_patients": q3,
    }


def plot_department_hba1c(query_results: dict, fig_dir: Path = FIG_DIR) -> dict:
    """⑥ 用图说清"超标患者集中在哪些科室"（图上的文字用英文：容器里没有中文字体）。"""
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
    total = sum(values)
    takeaway = (
        f"更正后 HbA1c >= 7.0 的患者共 {total} 人次分布在 {len(rows)} 个科室，"
        f"最多的是 {top['department']}（{top['n_patients']} 人）；"
        f"内分泌科与肾内科加起来占了多数，与这两个科室查 HbA1c 更频繁、血糖控制更差一致。"
    )
    return {"path": str(path), "takeaway": takeaway}


def compose_notes(profile: dict, loaded: dict, crud: dict, query_results: dict) -> str:
    """⑥ 写结论：数据有多脏 → 表怎么设计 → 约束起了什么作用 → 查询说明什么 → 不足。"""
    raw = profile["raw_rows"]
    dropped = profile["dropped"]
    top = max(query_results["q2_by_department"], key=lambda r: r["n_patients"])
    return (
        f"原始三张表 {raw['patients']}/{raw['visits']}/{raw['labs']} 行，清洗后入库 "
        f"{loaded['patients']}/{loaded['visits']}/{loaded['labs']} 行：丢弃 {dropped['invalid']} 行"
        f"（空字段、非正数检验值、外键对不上的行）与 {dropped['duplicates']} 行重复行。"
        f"表设计成 患者—就诊—检验 三层，主键各自唯一、就诊引用患者、检验引用就诊；"
        f"入库时打开外键约束，所以更正单里那条引用不存在就诊的报告被直接拒绝"
        f"（{crud['rejected_orphan_labs']} 条），不会在库里留下一份查不到病人的报告。"
        f"更正生效后重新查询：HbA1c 超标患者 {len(query_results['q1_hba1c_patients'])} 人，"
        f"最多的是 {top['department']}；说明「先改数据、再出报表」的顺序会影响这个口径的结果。"
        f"不足：没做单位检查（同一项目混用单位时结果会错），也没有记录是谁在什么时候改的（缺审计表）。"
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
    Path(out_path).write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return report


def regen_expected() -> None:
    """重算每个 case 的 expected.json（参考水平，不是标准答案）。

    ⚠️ 图与 clinic.db 会写文件 —— 这里只为取数值，写到临时目录，不进仓库。
    """
    import tempfile

    for case_dir in sorted(p for p in CASES_DIR.iterdir() if p.is_dir()):
        with tempfile.TemporaryDirectory() as tmp:
            report = build_report(case_dir, Path(tmp), Path(tmp))
        expected = {
            "note": (
                "参考水平（不是标准答案）：清洗口径与查询口径已在 task.md 里钉死，所以数值是确定的 —— "
                "这几项用于核对学生的清洗是否与口径一致、更正是否真的落到库里、查询结果对不对。"
                "硬性判据见 manifest.json 的 assertions，语义判据见 judge.md。"
            ),
            "profile": {"raw_rows": report["profile"]["raw_rows"]},
            "dropped": report["dropped"],
            "loaded": report["loaded"],
            "crud": report["crud"],
            "query_results": report["query_results"],
            "accept": {"hba1c_threshold": HBA1C_THRESHOLD, "min_figures": 1},
        }
        out = case_dir / "expected.json"
        out.write_text(json.dumps(expected, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(
            f"[regen] {out.name}@{case_dir.name}: loaded={expected['loaded']} "
            f"dropped={expected['dropped']} crud={expected['crud']} "
            f"q1={len(expected['query_results']['q1_hba1c_patients'])} 人"
        )


def main() -> None:
    ap = argparse.ArgumentParser(description="关系数据库实验的参考实现")
    ap.add_argument("case_dir", nargs="?")
    ap.add_argument("out", nargs="?")
    ap.add_argument("--regen-expected", action="store_true")
    args = ap.parse_args()

    if args.regen_expected:
        regen_expected()
        return
    if not args.case_dir or not args.out:
        ap.error("需要 <case目录> 与 <output.json>")

    report = run_case(args.case_dir, args.out)
    print(json.dumps({k: v for k, v in report.items() if k != "schema"}, ensure_ascii=False))
    for fig in report["figures"]:
        print(f"  [图] {fig['path']} —— {fig['takeaway']}")


if __name__ == "__main__":
    main()
