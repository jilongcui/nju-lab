#!/usr/bin/env python3
"""造题工具（**不下发给学生**）：生成 `kg-alerts` 两个 case 的输入数据。

生成物（`problem/cases/caseNN/`）：

| 文件 | 内容 |
|---|---|
| `triples.csv` | 知识图谱三元组：`head,relation,tail`（药物知识 + 患者数据） |
| `ontology.json` | 本体：实体类型表 + 每种关系的端点类型（`from` / `to`）—— 图更新的**校验依据** |
| `updates.json` | 图更新单：补录新患者 / 撤销医嘱 / 更正错误关系 / **一条违反本体的更新（必须被拒绝）** |

知识部分（药物—疾病—症状）写死成小册子式的常量；患者数据按种子生成，并在生成后**校验**
"初始图里确实有禁忌证预警与相互作用预警、更新后数量会变"，否则报错（避免造出一份没信号的题）。

用法：

  python3 tools/gen_data.py
  python3 tools/gen_data.py --seed 7        # 换种子（需重算 expected）
"""
from __future__ import annotations

import argparse
import csv
import json
import random
from pathlib import Path

HERE = Path(__file__).resolve().parent
CASE_ROOT = HERE.parent / "problem" / "cases"

# ---- 本体：每种关系的端点类型（图更新的校验依据）----
RELATION_SCHEMA = {
    "禁忌证": {"from": "Drug", "to": "Disease"},
    "相互作用": {"from": "Drug", "to": "Drug"},
    "不良反应": {"from": "Drug", "to": "Symptom"},
    "患有": {"from": "Patient", "to": "Disease"},
    "服用": {"from": "Patient", "to": "Drug"},
    "医嘱使用": {"from": "Patient", "to": "Drug"},
    "过敏": {"from": "Patient", "to": "Drug"},
}

# ---- 药物知识（固定，教学用虚构整理）----
DRUGS = ["二甲双胍", "华法林", "阿司匹林", "布洛芬", "氯吡格雷", "胰岛素",
         "地高辛", "呋塞米", "卡托普利", "美托洛尔", "辛伐他汀", "阿莫西林"]
DISEASES = ["2型糖尿病", "严重肾功能不全", "冠心病", "高血压", "心力衰竭",
            "心房颤动", "消化道出血", "痛风", "哮喘", "甲状腺功能减退"]
SYMPTOMS = ["出血", "低血糖", "干咳", "心动过缓", "皮疹", "胃肠道不适"]

CONTRAINDICATIONS = [
    ("二甲双胍", "严重肾功能不全"),
    ("布洛芬", "消化道出血"),
    ("美托洛尔", "哮喘"),
    ("呋塞米", "痛风"),
    ("辛伐他汀", "甲状腺功能减退"),
    ("地高辛", "严重肾功能不全"),
]
INTERACTIONS = [
    ("华法林", "阿司匹林"),
    ("华法林", "布洛芬"),
    ("氯吡格雷", "布洛芬"),
    ("地高辛", "呋塞米"),
    ("卡托普利", "呋塞米"),
    ("美托洛尔", "地高辛"),
]
ADVERSE = [
    ("阿司匹林", "出血"),
    ("布洛芬", "胃肠道不适"),
    ("卡托普利", "干咳"),
    ("美托洛尔", "心动过缓"),
    ("胰岛素", "低血糖"),
    ("阿莫西林", "皮疹"),
    ("华法林", "出血"),
]
PATIENT_DISEASES = ["2型糖尿病", "严重肾功能不全", "高血压", "冠心病",
                    "心力衰竭", "心房颤动", "哮喘", "痛风"]


def knowledge_triples() -> list[dict]:
    rows = []
    for d, c in CONTRAINDICATIONS:
        rows.append({"head": d, "relation": "禁忌证", "tail": c})
    for a, b in INTERACTIONS:
        rows.append({"head": a, "relation": "相互作用", "tail": b})
    for d, s in ADVERSE:
        rows.append({"head": d, "relation": "不良反应", "tail": s})
    return rows


def patient_triples(n_patients: int, rng: random.Random) -> list[dict]:
    """患者数据：每位患者若干疾病 + 在服药物 +（偶尔）过敏。

    ⚠️ 读起来"随机"就够了，但**必须保证有信号**：以较大概率给患者注入
    "疾病 ↔ 禁忌药"和"两味互相作用的药"两类冲突，否则整份题里一条预警都出不来。
    """
    rows = []
    for i in range(1, n_patients + 1):
        pid = f"P{i:03d}"
        diseases = set(rng.sample(
            PATIENT_DISEASES, k=rng.choices([1, 2], weights=[0.55, 0.45])[0]))
        drugs = set(rng.sample(DRUGS, k=rng.choices([1, 2], weights=[0.6, 0.4])[0]))

        # 注入禁忌冲突：患者的某个疾病 + 该疾病的禁忌药
        if rng.random() < 0.55:
            pairs = [(d, c) for d, c in CONTRAINDICATIONS if c in diseases and d not in drugs]
            if not pairs:
                pairs = rng.sample(CONTRAINDICATIONS, k=1)
                d, c = pairs[0]
                diseases.add(c)
            else:
                d, c = rng.choice(pairs)
            drugs.add(d)

        # 注入相互作用：同时用上两味互相作用的药
        if rng.random() < 0.45:
            a, b = rng.choice(INTERACTIONS)
            drugs.update({a, b})

        for d in sorted(diseases):
            rows.append({"head": pid, "relation": "患有", "tail": d})
        for drug in sorted(drugs):
            rows.append({"head": pid, "relation": "服用", "tail": drug})
        if rng.random() < 0.25:
            rows.append({"head": pid, "relation": "过敏", "tail": rng.choice(DRUGS)})
    return rows


def build_case(name: str, n_patients: int, seed: int) -> dict:
    rng = random.Random(seed)
    kn = knowledge_triples()
    pt = patient_triples(n_patients, rng)
    triples = kn + pt

    drugs_in_use = {(t["head"], t["tail"]) for t in pt if t["relation"] == "服用"}
    taken: dict[str, list[str]] = {}
    for pid, drug in drugs_in_use:
        taken.setdefault(pid, []).append(drug)

    # ---- 更新单：撤销一条医嘱 / 更正一条医嘱 / 补录一位新患者（带一段会触发预警的用药）----
    # 撤销：挑一位"有禁忌证冲突"的患者，撤掉那味药 → 更新后该类预警应当减少
    revoke = None
    for pid, drug_list in sorted(taken.items()):
        has_disease = {t["tail"] for t in pt if t["head"] == pid and t["relation"] == "患有"}
        conflict = [c for d, c in CONTRAINDICATIONS if d in drug_list and c in has_disease]
        if conflict:
            drug = next(d for d, c in CONTRAINDICATIONS if d in drug_list and c in has_disease)
            revoke = {"head": pid, "relation": "服用", "tail": drug}
            break

    # 更正：把某位患者的"服用"关系换成另一味药（原边错误）
    fix_pid = rng.choice(sorted(taken))
    fix_old = {"head": fix_pid, "relation": "服用", "tail": rng.choice(sorted(taken[fix_pid]))}
    fix_new = {"head": fix_pid, "relation": "服用", "tail": rng.choice([d for d in DRUGS if d != fix_old["tail"]])}

    # 补录的新患者：带上"互为相互作用"的两味药 → 更新后多一条相互作用预警
    # （疾病选与这两味药都不冲突的，让变化只体现在一类预警上，便于学生核对）
    new_pid = f"P{n_patients + 1:03d}"
    new_drug_a, new_drug_b = rng.choice(INTERACTIONS)

    updates = {
        "note": "用药审查前的图更新：补录一位新患者 / 撤销一条医嘱 / 更正一条错误关系 / 一条违反本体的更新（必须被拒绝）",
        "add_triples": [
            {"head": new_pid, "relation": "患有", "tail": "高血压"},
            {"head": new_pid, "relation": "服用", "tail": new_drug_a},
            {"head": new_pid, "relation": "服用", "tail": new_drug_b},  # ← 这两味药互为相互作用 → 新增一条预警
        ],
        "remove_triples": [revoke] if revoke else [],
        "replace_triples": [{"old": fix_old, "new": fix_new}],
        # ⚠️ 违反本体：禁忌证的 head 必须是 Drug，这里给了 Patient → 图更新必须拒绝它
        "invalid_triples": [{"head": fix_pid, "relation": "禁忌证", "tail": "高血压"}],
    }

    entities = {d: "Drug" for d in DRUGS}
    entities.update({d: "Disease" for d in DISEASES})
    entities.update({s: "Symptom" for s in SYMPTOMS})
    entities.update({f"P{i:03d}": "Patient" for i in range(1, n_patients + 1)})
    entities[new_pid] = "Patient"

    ontology = {
        "entity_types": entities,
        "relation_schema": RELATION_SCHEMA,
        "note": "图更新要按 relation_schema 校验：head 的类型必须是 from、tail 的类型必须是 to，否则拒绝该条更新",
    }

    # ---- 生成后自检：这份数据必须有信号（预警存在、更新会改变数量）----
    def alerts(rows: list[dict]) -> tuple[int, int]:
        have = {t["head"] + "|" + t["tail"] for t in rows if t["relation"] == "患有"}
        use = {(t["head"], t["tail"]) for t in rows if t["relation"] == "服用"}
        drug_contra = {d: c for d, c in CONTRAINDICATIONS}
        n_contra = sum(1 for pid, drug in use if f"{pid}|{drug_contra.get(drug, '')}" in have)
        by_pid: dict[str, set[str]] = {}
        for pid, drug in use:
            by_pid.setdefault(pid, set()).add(drug)
        pairs = {tuple(sorted(p)) for p in INTERACTIONS}
        n_inter = sum(
            1 for pid, drugs in by_pid.items()
            for a in drugs for b in drugs
            if a < b and (a, b) in pairs
        )
        return n_contra, n_inter

    n_contra, n_inter = alerts(triples)
    if n_contra < 3 or n_inter < 2:
        raise SystemExit(f"❌ {name}: 预警信号不足（禁忌 {n_contra} / 相互作用 {n_inter}），请换种子")

    return {
        "name": name, "triples": triples, "ontology": ontology, "updates": updates,
        "signals": (n_contra, n_inter),
    }


def write_case(case: dict) -> None:
    out_dir = CASE_ROOT / case["name"]
    out_dir.mkdir(parents=True, exist_ok=True)
    with (out_dir / "triples.csv").open("w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=["head", "relation", "tail"])
        w.writeheader()
        w.writerows(case["triples"])
    (out_dir / "ontology.json").write_text(
        json.dumps(case["ontology"], ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (out_dir / "updates.json").write_text(
        json.dumps(case["updates"], ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"  [写] {case['name']}: 三元组 {len(case['triples'])} 条；"
          f"初始预警 禁忌 {case['signals'][0]} / 相互作用 {case['signals'][1]}")


def main() -> None:
    ap = argparse.ArgumentParser(description="生成 kg-alerts 的 case 数据")
    ap.add_argument("--seed", type=int, default=None)
    args = ap.parse_args()
    base = args.seed if args.seed is not None else 2026
    for name, n, seed in [("case01", 8, base + 21), ("case02", 12, base + 22)]:
        print(f"[生成] {name}（患者 {n}，seed={seed}）")
        write_case(build_case(name, n, seed))


if __name__ == "__main__":
    main()
