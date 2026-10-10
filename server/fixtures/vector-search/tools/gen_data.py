#!/usr/bin/env python3
"""造题工具（**不下发给学生**）：生成 `vector-search` 两个 case 的输入数据。

核心：**离线可复现的"向量化"** —— 题干给一份**概念词表**（每个概念 = 一维，每个概念若干同义词），
学生的 `embed(text)` 就是"按词表数同义词出现次数 → L2 归一化"。于是：

- 「心梗」与「心肌梗死」落进**同一维** → 语义检索真的能命中"字面完全不同"的改写；
- 完全确定、无需联网、无需下载模型（真实场景用训练好的 embedding 模型，机制一模一样）。

**两个关键口径（造题必须保证，否则对照实验没意义）**：

1. 每个概念有一个**"查询专用"说法**，**语料里从不出现** —— 所以改写查询在字面上与相关文档不重叠；
2. 造题时**校验**该说法与全部相关文档**没有任何 2-gram 重叠** —— 保证"关键词检索（字符 bigram）
   在改写查询上必然漏"（手工挑同义词很容易踩坑：`高血压病` 与 `高血压` 共享 bigram，就漏不了了）。

生成物（`problem/cases/caseNN/`）：`corpus.csv`、`queries.csv`、`concepts.json`、`updates.json`。

查询 `kind` 三类：`same_words`（用文档里出现过的说法）、`paraphrase`（换成查询专用说法）、
`unrelated`（与语料无关，两种检索都返回空）。

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

# (概念名, 语料里可用的说法, 留给查询专用的说法)
# ⚠️ 第三项要手工挑成"与其它说法不共享 2-gram"的样子（英文/改述都行），造题时会再校验一遍。
BASE_CONCEPTS: list[tuple[str, list[str], str]] = [
    ("心梗", ["心梗", "心肌梗死", "急性心肌梗死"], "冠状动脉闭塞"),
    ("糖尿病", ["糖尿病", "2型糖尿病", "血糖控制不佳"], "糖代谢异常"),
    ("高血压", ["高血压", "血压偏高", "高血压病"], "收缩压超标"),
    ("髋部骨折", ["股骨颈骨折", "髋部骨折", "跌倒后髋部疼痛"], "不能站立行走"),
    ("肾功能不全", ["肾功能不全", "慢性肾脏病", "肌酐升高"], "eGFR 下降"),
    ("肺炎", ["肺炎", "肺部感染", "肺部渗出"], "胸片浸润影"),
    ("抗凝治疗", ["华法林", "抗凝治疗", "口服抗凝药"], "需监测 INR"),
    ("二甲双胍", ["二甲双胍", "双胍类药物", "降糖药二甲双胍"], "metformin"),
    ("低血糖", ["低血糖", "血糖偏低", "低血糖反应"], "出汗心慌手抖"),
    ("消化道出血", ["消化道出血", "黑便", "上消化道出血"], "呕血与柏油样便"),
    ("癫痫", ["癫痫", "抽搐发作", "痫性发作"], "意识丧失伴肢体抽动"),
    ("哮喘", ["哮喘", "喘息发作", "支气管哮喘"], "夜间憋气伴哮鸣音"),
]
EXTRA_CONCEPTS: list[tuple[str, list[str], str]] = [
    ("甲状腺功能减退", ["甲状腺功能减退", "甲减"], "TSH 升高"),
    ("心力衰竭", ["心力衰竭", "心功能不全"], "端坐呼吸伴下肢水肿"),
]

SCENES = ["门诊记录", "急诊留观", "出院小结", "会诊意见", "随访记录", "入院记录"]
DEPTS = ["心内科", "内分泌科", "肾内科", "呼吸科", "消化内科", "神经内科"]
# 语料与查询用**不同**的场景词，避免关键词检索靠场景词"蹭分"
QUERY_SCENES = ["老人主诉", "本次就诊提示", "病例摘要", "患者情况", "咨询内容", "现病史"]


def bigrams(text: str) -> list[str]:
    lowered = text.lower()
    return sorted({lowered[i:i + 2] for i in range(len(lowered) - 1)})


def make_concepts(extra: int) -> list[tuple[str, list[str], str]]:
    return BASE_CONCEPTS + EXTRA_CONCEPTS[:extra]


def make_corpus(concepts, n_docs: int, rng: random.Random) -> list[dict]:
    docs = []
    for i in range(1, n_docs + 1):
        n_topics = rng.choices([1, 2, 3], weights=[0.45, 0.4, 0.15])[0]
        topics = rng.sample(range(len(concepts)), k=n_topics)
        parts = [f"{rng.choice(SCENES)}：{rng.choice(concepts[t][1])}" for t in sorted(topics)]
        docs.append({
            "doc_id": f"D{i:03d}",
            "text": "；".join(parts) + "。",
            "dept": rng.choice(DEPTS),
            "_topics": sorted(topics),  # 造题用，不写进 CSV
        })
    return docs


def make_queries(concepts, corpus: list[dict], rng: random.Random,
                 n_queries: int) -> tuple[list[dict], list[str]]:
    """三类查询交替出现；改写查询只在"满足字面无重叠"的概念上生成。

    返回 `(查询列表, 跳过说明)` —— 跳过说明打出来，便于确认数据不是"悄悄生成成没对照意义的"。
    """
    queries: list[dict] = []
    skipped: list[str] = []
    kinds = ["same_words", "paraphrase", "paraphrase", "unrelated"]

    for k in range(n_queries):
        kind = kinds[k % len(kinds)]
        if kind == "unrelated":
            queries.append({
                "query_id": f"q{k + 1}",
                "text": rng.choice([
                    "儿童疫苗接种后发热如何处理",
                    "孕期营养补充与随访安排",
                    "术后伤口换药与拆线时间",
                    "体检套餐项目如何选择",
                ]),
                "kind": kind,
                "relevant_doc_ids": [],
            })
            continue

        candidates = []
        for i, (_, terms, para) in enumerate(concepts):
            docs = [d for d in corpus if i in d["_topics"]]
            if len(docs) < 2:
                continue
            if kind == "same_words":
                used = [t for t in terms if any(t in d["text"] for d in docs)]
                if used:
                    candidates.append((i, docs, used))
            else:
                # 校验：查询专用说法与所有相关文档**没有任何 2-gram 重叠**
                grams = bigrams(para)
                if not any(g in d["text"].lower() for d in docs for g in grams):
                    candidates.append((i, docs, [para]))
                else:
                    skipped.append(f"{concepts[i][0]}: 查询说法与文档有字面重叠")

        if not candidates:
            skipped.append(f"q{k + 1}({kind}): 没有可用概念")
            continue

        i, docs, terms = rng.choice(candidates)
        queries.append({
            "query_id": f"q{k + 1}",
            "text": f"{rng.choice(QUERY_SCENES)}：{rng.choice(sorted(terms))}",
            "kind": kind,
            "relevant_doc_ids": sorted(d["doc_id"] for d in docs),
        })
    return queries, skipped


def make_updates(concepts, corpus: list[dict], queries: list[dict], rng: random.Random) -> dict:
    """向量库的增删改单：新增一条语料 / 改写一条（向量必须重算）/ 删除一条 / 带过滤的检索。"""
    new_id = f"D{len(corpus) + 1:03d}"
    add_topic = rng.randrange(len(concepts))
    added_text = f"{rng.choice(SCENES)}：{rng.choice(concepts[add_topic][1])}。"

    upd = rng.choice(corpus)
    upd_topic = (upd["_topics"][0] + 1) % len(concepts)
    updated_text = f"{rng.choice(SCENES)}：{rng.choice(concepts[upd_topic][1])}。"

    deleted = rng.choice([d["doc_id"] for d in corpus])

    labelled = [q for q in queries if q["relevant_doc_ids"]] or queries
    fq = rng.choice(labelled)
    owner = next(d for d in corpus if d["doc_id"] == fq["relevant_doc_ids"][0])
    return {
        "note": "向量库更新单：新增一条语料 / 改写一条（要重算向量）/ 删除一条 / 再按科室过滤检索一次",
        "add_docs": [{"doc_id": new_id, "text": added_text, "dept": rng.choice(DEPTS)}],
        "update_docs": [{"doc_id": upd["doc_id"], "text": updated_text}],
        "delete_docs": [deleted],
        "filter_query": {"query_id": fq["query_id"], "dept": owner["dept"]},
    }


def write_case(name: str, n_docs: int, n_queries: int, extra_concepts: int, seed: int) -> None:
    rng = random.Random(seed)
    concepts = make_concepts(extra_concepts)
    corpus = make_corpus(concepts, n_docs, rng)
    queries, skipped = make_queries(concepts, corpus, rng, n_queries)
    updates = make_updates(concepts, corpus, queries, rng)

    out_dir = CASE_ROOT / name
    out_dir.mkdir(parents=True, exist_ok=True)

    with (out_dir / "corpus.csv").open("w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=["doc_id", "text", "dept"])
        w.writeheader()
        w.writerows([{k: d[k] for k in ("doc_id", "text", "dept")} for d in corpus])

    with (out_dir / "queries.csv").open("w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=["query_id", "text", "kind", "relevant_doc_ids"])
        w.writeheader()
        for q in queries:
            w.writerow({
                "query_id": q["query_id"], "text": q["text"], "kind": q["kind"],
                "relevant_doc_ids": "|".join(q["relevant_doc_ids"]),
            })

    (out_dir / "concepts.json").write_text(json.dumps({
        "dim": len(concepts),
        "how_to_embed": (
            "文本转小写 → 对每个概念累加它全部同义词在该文本中出现的次数（子串计数）→ "
            "得到一个 dim 维向量 → L2 归一化"
        ),
        "how_to_score": "余弦相似度 = 两个**已归一化**向量的点积；零向量与任何向量的相似度为 0",
        "concepts": [{"name": n, "terms": terms + [para]} for n, terms, para in concepts],
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    (out_dir / "updates.json").write_text(
        json.dumps(updates, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    n_para = sum(1 for q in queries if q["kind"] == "paraphrase")
    print(f"[生成] {name}: 语料 {len(corpus)} 条 / 查询 {len(queries)} 条"
          f"（改写 {n_para} 条）/ 维度 {len(concepts)}")
    if skipped:
        print(f"       跳过 {len(skipped)} 次候选：{skipped[:3]}{' …' if len(skipped) > 3 else ''}")
    if n_para < 2:
        raise SystemExit(f"❌ {name}: 改写查询太少（{n_para}）—— 对照实验会失去意义，请调整概念表")


def main() -> None:
    ap = argparse.ArgumentParser(description="生成 vector-search 的 case 数据")
    ap.add_argument("--seed", type=int, default=None)
    args = ap.parse_args()
    base = args.seed if args.seed is not None else 2026
    write_case("case01", 40, 8, 0, base + 11)
    write_case("case02", 60, 12, 2, base + 12)


if __name__ == "__main__":
    main()
