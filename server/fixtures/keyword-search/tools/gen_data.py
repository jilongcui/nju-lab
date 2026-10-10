#!/usr/bin/env python3
"""第 5 章（知识库 / 文本内容）实验的造题工具：生成两份「语料 + 查询 + 相关性标注」用例。

**不下发给学生**（`tools/` 是造题工具）。

语料是**虚构的教学摘要**（英文，没有真实患者、也不是真实文献）—— 用英文是刻意的：
这一章练的是"词项 → 文档"的倒排索引，中文还要先分词，而镜像里没有分词器；
换成英文，口径（小写 + 按非字母数字切分 + 去停用词）就能写得**完全确定、谁算都一样**。

语料的构造方式是有讲究的（**这才是这份用例的教学价值**）：

- 每个主题产出 4 篇：**1 篇短而精准**（该主题的关键词各出现一次）+ **3 篇长的综述 / 跨主题文档**
  （同样含该主题的关键词，而且**反复出现**、篇幅长得多）；
- 查询的相关文档**永远是那篇短的精准文档**；
- 于是「不做长度归一化的 2-gram 计数器」会被三篇长文档刷分、把真正相关的那篇挤出 Top-3，
  而 BM25 的**长度归一化（b）**与**词频饱和（k1）**能把短文档捞回来 —— 这是本实验最直观的一组对照；
- 查询分两类：`same_word`（用词与文档相同 → 应当命中）与 `paraphrase`（换了说法 →
  关键词检索会漏，这就是本章说的"搜得到字面，搜不到意思"）。

用法：

  python3 tools/gen_data.py            # 重新生成 problem/cases/case01|case02 的输入文件
  python3 tools/gen_data.py --print    # 只打印，不落盘
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path

HERE = Path(__file__).resolve().parent
CASES_DIR = HERE.parent / "problem" / "cases"


@dataclass(frozen=True)
class Theme:
    key: str
    name: str
    short_title: str
    review_title: str
    sentences: tuple[str, ...]  # 前两句 = 短文档；四句 = 本主题综述


THEMES: list[Theme] = [
    Theme(
        "t1",
        "PARP inhibitors",
        "Olaparib maintenance in ovarian cancer",
        "PARP inhibitors: current evidence",
        (
            "Olaparib is a PARP inhibitor approved for ovarian cancer with germline BRCA1 or BRCA2 mutations.",
            "In a randomised trial olaparib maintenance prolonged progression free survival compared with placebo.",
            "The benefit was largest in homologous recombination deficient tumours, which are also sensitive to platinum chemotherapy.",
            "Reversion mutations in BRCA1 or BRCA2 restore homologous recombination and explain acquired resistance to PARP inhibition.",
        ),
    ),
    Theme(
        "t2",
        "antiplatelet therapy",
        "Aspirin after myocardial infarction",
        "Antiplatelet therapy: current evidence",
        (
            "Aspirin inhibits platelet aggregation and is prescribed after myocardial infarction.",
            "Low dose aspirin reduces the risk of recurrent ischaemic events in survivors of myocardial infarction.",
            "After coronary stent implantation dual antiplatelet therapy with a P2Y12 inhibitor and aspirin is recommended for twelve months.",
            "Dual antiplatelet therapy increases gastrointestinal and intracranial bleeding, so risk scores are used to shorten its duration.",
        ),
    ),
    Theme(
        "t3",
        "glucose lowering drugs",
        "Metformin in type 2 diabetes",
        "Glucose lowering drugs: current evidence",
        (
            "Metformin lowers hepatic glucose production and improves insulin sensitivity in type 2 diabetes.",
            "It is the first line oral agent unless renal function is impaired, and lactic acidosis is a rare adverse effect.",
            "SGLT2 inhibitors such as empagliflozin and dapagliflozin promote urinary glucose excretion and reduce cardiovascular death.",
            "In diabetic kidney disease these agents slow the decline of kidney function and are widely prescribed.",
        ),
    ),
    Theme(
        "t4",
        "antibiotics for resistant infection",
        "Vancomycin dosing and monitoring",
        "Antibiotics for resistant infection: current evidence",
        (
            "Vancomycin is a glycopeptide antibiotic used for serious infections caused by methicillin resistant Staphylococcus aureus.",
            "Serum trough concentrations should be monitored to avoid nephrotoxicity during vancomycin treatment.",
            "Bloodstream infection with gram negative bacilli requires prompt empirical therapy and repeated cultures.",
            "Resistance to third generation cephalosporins limits treatment options and drives the use of newer agents.",
        ),
    ),
    Theme(
        "t5",
        "critical laboratory results",
        "Critical potassium values",
        "Critical results: current evidence",
        (
            "Serum potassium above 6.0 mmol per litre is a critical value that requires immediate clinical review.",
            "Haemolysed samples may falsely elevate potassium and should be repeated before treatment decisions.",
            "Laboratory policy requires telephone notification of critical results within thirty minutes.",
            "The call must be documented with the name of the receiving clinician and the time of notification.",
        ),
    ),
    Theme(
        "t6",
        "imaging and renal protection",
        "Imaging for suspected pulmonary embolism",
        "Cardiorespiratory and renal care: current evidence",
        (
            "Computed tomography of the chest is the preferred imaging test when pulmonary embolism is suspected.",
            "Contrast enhanced angiography can confirm the diagnosis but is contraindicated in severe renal impairment.",
            "Angiotensin receptor blockers slow the progression of proteinuric chronic kidney disease.",
            "Serum creatinine and potassium must be checked shortly after starting an angiotensin receptor blocker.",
        ),
    ),
]


def build_docs() -> list[tuple[str, str, str]]:
    """每个主题 4 篇：1 篇短（相关文档）+ 3 篇长（同主题综述 / 跨主题综述）。"""
    docs: list[tuple[str, str, str]] = []
    for idx, theme in enumerate(THEMES):
        base = 4 * idx + 1
        nxt = THEMES[(idx + 1) % len(THEMES)]
        prv = THEMES[(idx - 1) % len(THEMES)]
        docs.append((f"D{base:02d}", theme.short_title, " ".join(theme.sentences[:2])))
        docs.append((f"D{base + 1:02d}", theme.review_title, " ".join(theme.sentences)))
        docs.append(
            (
                f"D{base + 2:02d}",
                f"{theme.name} and {nxt.name}: a combined review",
                " ".join(theme.sentences + nxt.sentences[:2]),
            )
        )
        docs.append(
            (
                f"D{base + 3:02d}",
                f"Clinical overview: {theme.name}",
                " ".join(theme.sentences + prv.sentences[:2]),
            )
        )
    return docs


DOCS = build_docs()

# 查询：query_id → (查询文本, 类型, 相关 doc_id)。相关文档永远是该主题那篇**短的精准文档**。
QUERIES_CASE01: list[tuple[str, str, str, list[str]]] = [
    ("Q01", "olaparib brca1 ovarian cancer", "same_word", ["D01"]),
    ("Q02", "aspirin platelet aggregation myocardial infarction", "same_word", ["D05"]),
    ("Q03", "metformin insulin sensitivity type 2 diabetes", "same_word", ["D09"]),
    ("Q04", "lactic acidosis metformin", "same_word", ["D09"]),
    (
        "Q05",
        "which drug is given to women whose ovarian tumour carries a faulty gene?",
        "paraphrase",
        ["D01"],
    ),
    (
        "Q06",
        "how can the risk of another blockage of a heart vessel be lowered after the first one?",
        "paraphrase",
        ["D05"],
    ),
    (
        "Q07",
        "what is the usual first oral treatment when blood sugar stays high?",
        "paraphrase",
        ["D09"],
    ),
    (
        "Q08",
        "which oral agent works by making the body respond better to its own hormone?",
        "paraphrase",
        ["D09"],
    ),
]

QUERIES_CASE02: list[tuple[str, str, str, list[str]]] = [
    ("Q01", "olaparib brca1 ovarian cancer", "same_word", ["D01"]),
    ("Q02", "vancomycin nephrotoxicity trough concentrations", "same_word", ["D13"]),
    ("Q03", "metformin insulin sensitivity", "same_word", ["D09"]),
    ("Q04", "pulmonary embolism computed tomography", "same_word", ["D21"]),
    (
        "Q05",
        "which drug is given to women whose ovarian tumour carries a faulty gene?",
        "paraphrase",
        ["D01"],
    ),
    (
        "Q06",
        "which blood result is so abnormal that it needs an urgent call to the ward?",
        "paraphrase",
        ["D17"],
    ),
    (
        "Q07",
        "how can the risk of another blockage of a heart vessel be lowered after the first one?",
        "paraphrase",
        ["D05"],
    ),
    (
        "Q08",
        "what is the usual first oral treatment when blood sugar stays high?",
        "paraphrase",
        ["D09"],
    ),
]

CASES = {
    # case01：小语料 —— 前三个主题（12 篇）
    "case01": {
        "note": "小语料：12 篇文档（3 个主题 × 4 篇）/ 8 个查询（4 个同词、4 个改写）",
        "doc_ids": [f"D{i:02d}" for i in range(1, 13)],
        "queries": QUERIES_CASE01,
    },
    # case02：大语料 —— 六个主题全上（24 篇）
    "case02": {
        "note": "大语料：24 篇文档（6 个主题 × 4 篇）/ 8 个查询（4 个同词、4 个改写）",
        "doc_ids": [f"D{i:02d}" for i in range(1, 25)],
        "queries": QUERIES_CASE02,
    },
}


def escape(cell: str) -> str:
    """CSV 转义：语料里有逗号，统一加引号（用 csv 模块读不会有问题）。"""
    return '"' + cell.replace('"', '""') + '"'


def build(spec: dict) -> dict[str, str]:
    docs = {d[0]: d for d in DOCS}
    corpus_rows = [[did, docs[did][1], docs[did][2]] for did in spec["doc_ids"]]
    query_rows = [[qid, text, qtype] for qid, text, qtype, _ in spec["queries"]]
    qrels_rows = [[qid, did] for qid, _, _, rels in spec["queries"] for did in rels]
    return {
        "corpus.csv": "doc_id,title,text\n"
        + "\n".join(",".join(escape(c) for c in r) for r in corpus_rows)
        + "\n",
        "queries.csv": "query_id,query,type\n"
        + "\n".join(",".join(escape(c) for c in r) for r in query_rows)
        + "\n",
        "qrels.csv": "query_id,doc_id\n" + "\n".join(",".join(r) for r in qrels_rows) + "\n",
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
        print("    nju-lab-verify:0.2.0-rc.2-pkg6 /w/problem/reference/scripts/bm25_search.py --regen-expected")


if __name__ == "__main__":
    main()
