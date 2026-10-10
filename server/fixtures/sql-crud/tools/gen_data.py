#!/usr/bin/env python3
"""造题工具（**不下发给学生**）：生成 `sql-crud` 两个 case 的输入数据。

流程：造"干净"数据 → 按固定规则**脏化** → 写
`problem/cases/caseNN/{patients.csv,visits.csv,labs.csv,corrections.json}`。

脏化规则（与 `task.md` 的清洗口径一一对应，全部可复现）：

| 脏化 | 触发 | 学生要做的处理 |
|---|---|---|
| 字段首尾加空格 | 部分行 | 去首尾空白 |
| 日期格式 `YYYY/M/D`、`DD-MM-YYYY` | 部分行 | 统一成 `YYYY-MM-DD` |
| 整行复制一份 | 部分行 | 清洗后完全相同的行只留首次出现 |
| 必填字段置空 | 少数行 | 整行丢弃 |
| `labs.value` 置 0 / 负数 | 少数行 | 整行丢弃 |
| 外键指向不存在的 id | 少数行 | 整行丢弃（引用完整性） |

用法：

  python3 tools/gen_data.py            # 重新生成全部 case（覆盖）
  python3 tools/gen_data.py --seed 7   # 换种子（会改变所有期望值，慎用 → 需重算 expected）
"""
from __future__ import annotations

import argparse
import csv
import json
import random
from pathlib import Path

HERE = Path(__file__).resolve().parent
CASE_ROOT = HERE.parent / "problem" / "cases"

DEPARTMENTS = ["内分泌科", "心内科", "肾内科", "消化内科", "普通内科"]

DIAGNOSIS = {
    "内分泌科": ["2型糖尿病", "甲状腺功能减退"],
    "心内科": ["高血压", "冠心病"],
    "肾内科": ["慢性肾脏病", "糖尿病肾病"],
    "消化内科": ["慢性胃炎", "脂肪肝"],
    "普通内科": ["上呼吸道感染", "乏力待查"],
}

# 科室偏置：决定 HbA1c 的水平（内分泌科 / 肾内科偏高 —— 与临床常识一致）
HBA1C_BIAS = {"内分泌科": 1.7, "肾内科": 1.2, "心内科": 0.4, "消化内科": 0.0, "普通内科": -0.5}

SURNAMES = list("赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦许何吕施张孔曹严华金魏陶姜")
GIVEN = ["建国", "秀兰", "志强", "桂英", "海燕", "文博", "淑珍", "立新", "雅静", "宏伟",
         "晓东", "春梅", "俊杰", "红霞", "永强", "玉兰", "振华", "丽娟", "国庆", "雪梅"]

LAB_ITEMS = ["HbA1c", "空腹血糖", "肌酐", "eGFR", "白细胞"]
LAB_UNITS = {
    "HbA1c": "%",
    "空腹血糖": "mmol/L",
    "肌酐": "umol/L",
    "eGFR": "mL/min/1.73m2",
    "白细胞": "10^9/L",
}


def make_patients(n: int, rng: random.Random) -> list[dict]:
    rows = []
    for i in range(1, n + 1):
        rows.append({
            "patient_id": f"P{i:04d}",
            "name": rng.choice(SURNAMES) + rng.choice(GIVEN),
            "birth_date": f"{rng.randint(1948, 1998)}-{rng.randint(1, 12):02d}-{rng.randint(1, 28):02d}",
            "sex": rng.choice(["男", "女"]),
        })
    return rows


def make_visits(patients: list[dict], rng: random.Random) -> list[dict]:
    rows = []
    vid = 0
    # 最后 3 位患者只在 patient 表里（没有就诊）—— 主表行数可以多于从表
    active = patients[:-3] if len(patients) > 10 else patients
    for p in active:
        for _ in range(rng.choices([1, 2], weights=[0.72, 0.28])[0]):
            vid += 1
            dept = rng.choices(DEPARTMENTS, weights=[0.26, 0.22, 0.20, 0.17, 0.15])[0]
            rows.append({
                "visit_id": f"V{vid:04d}",
                "patient_id": p["patient_id"],
                "department": dept,
                "visit_date": f"2026-{rng.randint(1, 4):02d}-{rng.randint(1, 28):02d}",
                "diagnosis": rng.choice(DIAGNOSIS[dept]),
            })
    return rows


def make_labs(visits: list[dict], rng: random.Random) -> list[dict]:
    rows = []
    rid = 0
    for v in visits:
        n_labs = rng.choices([1, 2, 3, 4], weights=[0.22, 0.3, 0.3, 0.18])[0]
        p_hba1c = 0.75 if v["department"] in ("内分泌科", "肾内科") else 0.5
        picked: list[str] = []
        if rng.random() < p_hba1c:
            picked.append("HbA1c")
        while len(picked) < n_labs:
            it = rng.choice(LAB_ITEMS)
            if it not in picked:
                picked.append(it)
        for item in picked:
            rid += 1
            if item == "HbA1c":
                value = round(5.6 + HBA1C_BIAS[v["department"]] + rng.uniform(-1.1, 1.9), 1)
            elif item == "空腹血糖":
                value = round(4.6 + HBA1C_BIAS[v["department"]] * 0.9 + rng.uniform(-0.8, 2.4), 1)
            elif item == "肌酐":
                value = float(int(rng.gauss(96 + HBA1C_BIAS[v["department"]] * 18, 26)))
            elif item == "eGFR":
                value = float(int(rng.gauss(88 - HBA1C_BIAS[v["department"]] * 12, 15)))
            else:
                value = round(rng.uniform(3.2, 11.5), 1)
            rows.append({
                "report_id": f"R{rid:04d}",
                "visit_id": v["visit_id"],
                "item": item,
                "value": value,
                "unit": LAB_UNITS[item],
            })
    return rows


def _fmt_date(s: str, style: str) -> str:
    y, m, d = str(s).split("-")
    if style == "slash":
        return f"{y}/{int(m)}/{int(d)}"
    if style == "dmy":
        return f"{int(d):02d}-{m}-{y}"
    return str(s)


def dirty(rows: list[dict], date_col: str | None, required: list[str], rng: random.Random,
          *, value_col: str | None = None, orphan_col: str | None = None,
          orphan_id: str = "") -> tuple[list[dict], list[dict]]:
    """就地脏化一张表，返回 `(全部行, 清洗后仍会保留的行)`。

    第二个返回值是**造题侧对清洗口径的复述**：只有这些行里的 id 才是"清洗后一定存在"的，
    所以 `corrections.json` 的目标只从这里挑（参考实现会再校验一次，避免造题与口径漂移）。
    """
    out = [dict(r) for r in rows]
    n = len(out)
    doomed: list[dict] = []

    # 1) 字段首尾空格（约 20% 的行）—— 清洗后会被去掉，不影响保留
    for r in out:
        if rng.random() < 0.2:
            col = rng.choice(list(r.keys()))
            r[col] = (" " if rng.random() < 0.6 else "\t") + str(r[col]) + (" " if rng.random() < 0.5 else "")

    # 2) 日期格式（清洗后应统一成 YYYY-MM-DD）
    if date_col:
        for r in out:
            x = rng.random()
            if x < 0.35:
                r[date_col] = _fmt_date(r[date_col], "slash")
            elif x < 0.55:
                r[date_col] = _fmt_date(r[date_col], "dmy")

    # 3) 必填字段置空（约 3% → 整行丢弃）
    for r in rng.sample(out, k=max(1, int(n * 0.03))):
        r[rng.choice(required)] = " " if rng.random() < 0.5 else ""
        doomed.append(r)

    # 4) 非法数值（约 3% → 整行丢弃）
    if value_col:
        for r in rng.sample(out, k=max(1, int(n * 0.03))):
            r[value_col] = rng.choice([0, -3.2, ""])
            doomed.append(r)

    # 5) 孤儿外键（约 2% → 整行丢弃）
    if orphan_col:
        for r in rng.sample(out, k=max(1, int(n * 0.02))):
            r[orphan_col] = orphan_id or "P9999"
            doomed.append(r)

    # 6) 整行复制（约 6% → 去重时只留首次出现的那一份）
    dupes = [dict(r) for r in rng.sample(out, k=max(1, int(n * 0.06)))]
    doomed.extend(dupes)

    doomed_ids = {id(r) for r in doomed}
    safe = [r for r in out if id(r) not in doomed_ids]
    return out + dupes, safe


def build_case(name: str, n_patients: int, seed: int) -> dict:
    rng = random.Random(seed)
    patients = make_patients(n_patients, rng)
    visits = make_visits(patients, rng)
    labs = make_labs(visits, rng)

    raw_patients, safe_patients = dirty(
        patients, "birth_date", ["patient_id", "name", "birth_date", "sex"], rng
    )
    raw_visits, safe_visits = dirty(
        visits, "visit_date", ["visit_id", "patient_id", "department", "visit_date"],
        rng, orphan_col="patient_id", orphan_id="P9999",
    )
    raw_labs, safe_labs = dirty(
        labs, None, ["report_id", "visit_id", "item", "value", "unit"],
        rng, value_col="value", orphan_col="visit_id", orphan_id="V9998",
    )

    # ---- corrections.json：临床更正单（撤回报告 / 更正科室 / 补录就诊与检验）----
    retract = [r["report_id"] for r in rng.sample(safe_labs, k=2)]

    hba1c_high = {
        r["visit_id"] for r in safe_labs
        if r["item"] == "HbA1c" and float(r["value"]) >= 7.0
    }
    candidates = [v for v in safe_visits if v["visit_id"] in hba1c_high and v["department"] != "内分泌科"]
    target = rng.choice(candidates)

    existing = {v["visit_id"] for v in visits}
    new_visit_id = f"V9{seed % 90 + 10:03d}"
    while new_visit_id in existing:
        new_visit_id = "V" + str(int(new_visit_id[1:]) + 1).zfill(4)
    # 补录的就诊必须指向**清洗后一定存在**的患者（否则它自己就会被外键拒绝）
    anchor = rng.choice(safe_patients)["patient_id"]

    corrections = {
        "note": "临床数据更正单：撤回误报的检验报告 / 更正就诊科室 / 补录一次就诊与检验",
        "retract_labs": retract,
        "update_visit_departments": [
            {"visit_id": target["visit_id"], "new_department": "内分泌科"}
        ],
        "add_visits": [
            {
                "visit_id": new_visit_id,
                "patient_id": anchor,
                "department": "内分泌科",
                "visit_date": "2026-04-26",
                "diagnosis": "2型糖尿病",
            }
        ],
        "add_labs": [
            {"report_id": "R9001", "visit_id": new_visit_id, "item": "HbA1c", "value": 8.4, "unit": "%"},
            # ↓ 引用了不存在的就诊：库里的外键约束必须拒绝它（这是判据之一）
            {"report_id": "R9002", "visit_id": "V9998", "item": "HbA1c", "value": 7.7, "unit": "%"},
        ],
    }
    return {
        "name": name,
        "tables": {"patients": raw_patients, "visits": raw_visits, "labs": raw_labs},
        "corrections": corrections,
    }


def write_case(case: dict) -> None:
    out_dir = CASE_ROOT / case["name"]
    out_dir.mkdir(parents=True, exist_ok=True)
    for table, rows in case["tables"].items():
        path = out_dir / f"{table}.csv"
        with path.open("w", encoding="utf-8", newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
            w.writeheader()
            w.writerows(rows)
        print(f"  [写] {path.relative_to(HERE.parent)}  行={len(rows)}")
    cpath = out_dir / "corrections.json"
    cpath.write_text(json.dumps(case["corrections"], ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"  [写] {cpath.relative_to(HERE.parent)}")


def main() -> None:
    ap = argparse.ArgumentParser(description="生成 sql-crud 的 case 数据")
    ap.add_argument("--seed", type=int, default=None, help="基础种子（默认 2026）")
    args = ap.parse_args()

    base = args.seed if args.seed is not None else 2026
    for name, n, seed in [("case01", 40, base + 1), ("case02", 55, base + 2)]:
        print(f"[生成] {name}（患者 {n}，seed={seed}）")
        write_case(build_case(name, n, seed))


if __name__ == "__main__":
    main()
