#!/usr/bin/env python3
"""第 9 章（综合实践：分子医学知识问答系统）实验的造题工具：生成两份「四形态语料 + 问题」用例。

**不下发给学生**（`tools/` 是造题工具）。

数据是**虚构的教学数据**（没有真实患者，也不是真实临床试验）：一个小规模的"基因 / 变异 / 药物 /
试验 / 段落 / 关系"知识库，用来走通"四形态各用一次"的综合实践。

五个问题**刻意一一对应四种形态**（第 5 问要两跳组合）：

| 问题 | 应当走的路 | 为什么 |
|---|---|---|
| Q01 | SQL | 精确数字（试验分期 / 客观缓解率）在结构化表里 |
| Q02 | 关键词（字面） | 要"原文里直接出现这几个术语"的段落 |
| Q03 | 向量（字符 2-gram 余弦） | 问的是"解释原因"的那段 —— 措辞不同、要按相似度找 |
| Q04 | 图谱（多跳） | 要"从功能缺失推到药物"的**推理链**（可解释） |
| Q05 | 图谱 + SQL | 先用图谱拿到"获批适应证"，再用 SQL 取试验数据 |

两份用例只在**规模**上不同（case01 少一条试验 + 少两个段落），问题集相同 ——
判的是"同一个方案要普适"。

用法：

  python3 tools/gen_data.py            # 重新生成 problem/cases/case01|case02 的输入文件
  python3 tools/gen_data.py --print    # 只打印，不落盘
"""
from __future__ import annotations

import argparse
from pathlib import Path

HERE = Path(__file__).resolve().parent
CASES_DIR = HERE.parent / "problem" / "cases"

GENES = [
    ("BRCA1", "BRCA1 DNA repair associated", "17q21"),
    ("BRCA2", "BRCA2 DNA repair associated", "13q13"),
    ("PARP1", "poly(ADP-ribose) polymerase 1", "1q42"),
    ("HER2", "erb-b2 receptor tyrosine kinase 2", "17q12"),
]

VARIANTS = [
    ("V-01", "BRCA1", "germline_mutation", "pathogenic"),
    ("V-02", "BRCA2", "germline_mutation", "pathogenic"),
    ("V-03", "PARP1", "somatic_mutation", "likely_benign"),
    ("V-04", "HER2", "amplification", "pathogenic"),
]

DRUGS = [
    ("olaparib", "PARP_inhibitor", "PARP1", "approved"),
    ("niraparib", "PARP_inhibitor", "PARP1", "approved"),
    ("talazoparib", "PARP_inhibitor", "PARP1", "approved"),
    ("carboplatin", "platinum_agent", "DNA", "approved"),
    ("trastuzumab", "HER2_antibody", "HER2", "approved"),
]

# 试验表：case01 少一条（II 期那条只放进 case02），逼着方案"按条件筛"而不是"照抄第一行"
TRIALS_COMMON = [
    ("T-101", "niraparib", "卵巢癌", "II", "45.0"),
    ("T-102", "olaparib", "卵巢癌", "III", "62.4"),
    ("T-103", "talazoparib", "乳腺癌", "III", "55.1"),
    ("T-104", "carboplatin", "卵巢癌", "III", "58.3"),
]
TRIALS_EXTRA = [
    ("T-105", "olaparib", "卵巢癌", "II", "48.9"),
]

PASSAGES_COMMON = [
    (
        "P-01",
        "NCCN 卵巢癌指南（虚构教学版）",
        "系统治疗推荐",
        "指南推荐：对携带胚系 BRCA1 或 BRCA2 突变的晚期卵巢癌患者，可在含铂化疗后使用 PARP 抑制剂（奥拉帕利）维持治疗。",
    ),
    (
        "P-02",
        "卵巢癌一线治疗综述（虚构教学版）",
        "化疗方案",
        "卵巢癌的一线治疗以铂类为基础，卡铂联合紫杉醇是常用方案。",
    ),
    (
        "P-03",
        "合成致死机制综述（虚构教学版）",
        "作用机制",
        "同源重组修复缺陷的肿瘤细胞对铂类药物与 PARP 抑制剂都更敏感，这一现象称为合成致死。",
    ),
    (
        "P-04",
        "HER2 靶向治疗手册（虚构教学版）",
        "用药监护",
        "曲妥珠单抗用于 HER2 阳性乳腺癌，治疗期间需要监测心脏功能。",
    ),
    (
        "P-05",
        "遗传咨询工作手册（虚构教学版）",
        "风险评估",
        "携带胚系 BRCA1 突变的女性一生中卵巢癌风险明显升高，建议定期筛查与遗传咨询。",
    ),
]

PASSAGES_EXTRA = [
    (
        "P-06",
        "PARP 抑制剂用药说明（虚构教学版）",
        "适应证",
        "尼拉帕利是口服 PARP 抑制剂，获批用于铂敏感复发卵巢癌的维持治疗。",
    ),
    (
        "P-07",
        "医学检验手册（虚构教学版）",
        "实验室指标",
        "血清钾高于 6.0 mmol/L 属于危急值，需要立即复核并通知临床。",
    ),
]

# 关系（三元组）：有向；Q04 的最短路径 **唯一**
EDGES = [
    ("BRCA1", "germline_mutation", "卵巢癌"),
    ("BRCA1", "loss_of_function", "同源重组修复缺陷"),
    ("同源重组修复缺陷", "sensitizes_to", "铂类药物"),
    ("同源重组修复缺陷", "synthetic_lethal_with", "PARP抑制剂"),
    ("PARP抑制剂", "includes", "olaparib"),
    ("PARP抑制剂", "includes", "niraparib"),
    ("PARP抑制剂", "includes", "talazoparib"),
    ("olaparib", "approved_for", "BRCA突变卵巢癌"),
    ("niraparib", "approved_for", "铂敏感复发卵巢癌"),
    ("talazoparib", "approved_for", "BRCA突变乳腺癌"),
]

QUESTIONS = [
    ("Q01", "奥拉帕利的 III 期临床试验（卵巢癌）客观缓解率是多少？试验编号是什么？"),
    ("Q02", "指南里直接给出的「PARP 抑制剂用于 BRCA 突变卵巢癌」的推荐，是哪一段？给出段落号。"),
    ("Q03", "哪一段解释了「修复功能有缺陷的肿瘤为什么对铂类和 PARP 抑制剂都敏感」？给出段落号。"),
    ("Q04", "从 BRCA1 的功能缺失出发，到可用的 PARP 抑制剂，推理链是什么？PARP 抑制剂这个类别包含哪些药物？"),
    ("Q05", "尼拉帕利获批的适应证是什么？它的临床试验客观缓解率是多少？"),
]

CASES = {
    "case01": {
        "note": "小规模：4 条试验 / 5 段段落",
        "trials": TRIALS_COMMON,
        "passages": PASSAGES_COMMON,
    },
    "case02": {
        "note": "大规模：5 条试验 / 7 段段落",
        "trials": TRIALS_COMMON + TRIALS_EXTRA,
        "passages": PASSAGES_COMMON + PASSAGES_EXTRA,
    },
}


def csv_text(header: list[str], rows: list[tuple[str, ...]]) -> str:
    lines = [",".join(header)]
    for row in rows:
        cells = []
        for cell in row:
            if any(ch in cell for ch in ',"'):
                cells.append('"' + cell.replace('"', '""') + '"')
            else:
                cells.append(cell)
        lines.append(",".join(cells))
    return "\n".join(lines) + "\n"


def build(spec: dict) -> dict[str, str]:
    return {
        "genes.csv": csv_text(["gene_symbol", "full_name", "chromosome"], GENES),
        "variants.csv": csv_text(
            ["variant_id", "gene_symbol", "variant_type", "clinical_significance"], VARIANTS
        ),
        "drugs.csv": csv_text(["drug_name", "drug_class", "target", "approval_status"], DRUGS),
        "trials.csv": csv_text(["trial_id", "drug_name", "indication", "phase", "orr_pct"], spec["trials"]),
        "passages.csv": csv_text(["passage_id", "source", "section", "text"], spec["passages"]),
        "edges.csv": csv_text(["head", "relation", "tail"], EDGES),
        "questions.csv": csv_text(["question_id", "question"], QUESTIONS),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--print", dest="dry", action="store_true", help="只打印，不写盘")
    args = ap.parse_args()

    for case_name in sorted(CASES):
        spec = CASES[case_name]
        files = build(spec)
        case_dir = CASES_DIR / case_name
        if not args.dry:
            case_dir.mkdir(parents=True, exist_ok=True)
        print(f"[{case_name}] {spec['note']}")
        for rel, text in files.items():
            if args.dry:
                print(f"--- {case_name}/{rel}\n{text}")
            else:
                (case_dir / rel).write_text(text, encoding="utf-8")

    if not args.dry:
        print(f"\n已写入 {CASES_DIR}")
        print("下一步：用参考实现重算期望值（必须在复验同一镜像内）——")
        print('  docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/w" --entrypoint python3 \\')
        print("    nju-lab-verify:0.2.0-rc.2-pkg6 /w/problem/reference/scripts/qa_ask.py --regen-expected")


if __name__ == "__main__":
    main()
