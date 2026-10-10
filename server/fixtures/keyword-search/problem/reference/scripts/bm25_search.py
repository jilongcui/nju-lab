#!/usr/bin/env python3
"""第 5 章（知识库 · 文本内容）参考实现：倒排索引 + BM25 检索，与「字符 2-gram」基线对照。

📖 这份实现**随题目包一起下发**（`problem/reference/`）—— 先读懂它，再写你自己的。
   **它不是唯一正确答案**：代码怎么组织随你；判据只看"索引口径一致 + 检索名单一致
   + 两个召回率对不对 + 说得清 BM25 与关键词检索的边界"。

它把本章那句论断落成了可量的东西：

- **倒排索引**（`build_index`）：`词项 → {doc_id: 词频}`，等价于教科书最后的"索引页"；
- **BM25**（`bm25_scores`）：词越稀有（idf 高）越加分，词频有**饱和**（k1），长文档有**长度归一化**（b）；
- **字符 2-gram 基线**（`bigram_counts` + `bigram_score`）：不建词表、直接数"查询里的字符碎片在文档里
  出现了多少次"，而且**不做长度归一化** —— 它能在"同词"查询上蹭到分，却完全不懂"换了说法"的查询，
  还会被长文档刷分。

流程（与 task.md 的六步一致）：

  ① 看清需求      —— 要回答的是"哪篇文档和这个问题相关"，且要说清方法的天花板
  ② 看懂口径      —— 词项怎么切、停用词表、BM25 参数、Top-K 的并列怎么排
  ③ 建索引        —— `build_index` + `postings_checksum`（口径钉死，可逐字节复现）
  ④ 检索          —— `bm25_scores` + `rank` 取 Top-3
  ⑤ 对照与评估    —— `bigram_counts` / `bigram_score` 跑同一个查询集，算 `recall@3`
  ⑥ 写结论        —— 一张按查询类型分组的图 + `notes`（讲清 BM25 解决什么、边界在哪）

用法：

  python3 scripts/bm25_search.py <case目录> <output.json>    # 单个 case（图写到当前目录的 figures/）
  python3 scripts/bm25_search.py --regen-expected            # 重算 problem/cases/*/expected.json

请在**与复验同一个镜像内**生成 expected（当前 pkg6）：

  docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/w" --entrypoint python3 \
    nju-lab-verify:0.2.0-rc.2-pkg6 /w/problem/reference/scripts/bm25_search.py --regen-expected
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import re
import tempfile
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

import matplotlib

matplotlib.use("Agg")  # 容器内无显示环境
import matplotlib.pyplot as plt  # noqa: E402

HERE = Path(__file__).resolve().parent
CASES_DIR = HERE.parent.parent / "cases"
FIG_DIR = Path("figures")
FIG_NAME = "recall_by_query_type.png"

K1 = 1.5  # 词频饱和参数（口径写死在 task.md）
B = 0.75  # 长度归一化强度
TOP_K = 3

# 停用词表（口径写死在 task.md —— 换表就是换口径，expected 会立刻对不上）
STOPWORDS = {
    "a", "an", "the", "of", "in", "on", "for", "with", "and", "or", "to", "is", "are", "was",
    "were", "be", "been", "by", "as", "at", "from", "that", "this", "these", "those", "it", "its",
    "may", "can", "should", "must", "than", "then", "over", "after", "before", "during", "into",
    "not", "no", "but", "if", "when", "which", "who", "what", "how", "why", "does", "do", "did",
}


# ---------- ② 口径：分词与文本拼接 ----------


def tokenize(text: str) -> list[str]:
    """口径：NFKC + 转小写 → 按**非字母数字**切分 → 丢掉长度 < 2 的词与停用词。"""
    lowered = unicodedata.normalize("NFKC", text or "").lower()
    return [t for t in re.split(r"[^a-z0-9]+", lowered) if len(t) >= 2 and t not in STOPWORDS]


def document_text(row: dict[str, str]) -> str:
    """一份文档的检索文本 = `title` + 一个空格 + `text`（口径写死在 task.md）。"""
    return f"{row.get('title', '')} {row.get('text', '')}"


# ---------- ③ 建索引 ----------


def load_corpus(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8", newline="") as fh:
        return [dict(r) for r in csv.DictReader(fh)]


def build_index(docs: list[dict[str, str]]) -> tuple[dict[str, dict[str, int]], dict[str, int], int]:
    """返回 `(postings, doc_length, vocab_size)`：`postings[term][doc_id] = 词频`。"""
    postings: dict[str, dict[str, int]] = defaultdict(dict)
    doc_length: dict[str, int] = {}
    for row in docs:
        doc_id = row["doc_id"]
        terms = tokenize(document_text(row))
        doc_length[doc_id] = len(terms)
        for term, tf in Counter(terms).items():
            postings[term][doc_id] = tf
    return dict(postings), doc_length, len(postings)


def postings_checksum(postings: dict[str, dict[str, int]]) -> str:
    """口径写死在 task.md：`term|doc_id|tf` 行（term 升序、同 term 内 doc_id 升序），
    行间 `\\n`、末尾不加换行，UTF-8 → sha256 十六进制**前 12 位**。"""
    lines = [
        f"{term}|{doc_id}|{postings[term][doc_id]}"
        for term in sorted(postings)
        for doc_id in sorted(postings[term])
    ]
    return hashlib.sha256("\n".join(lines).encode("utf-8")).hexdigest()[:12]


# ---------- ④ BM25 检索 ----------


def bm25_scores(
    query_terms: list[str],
    postings: dict[str, dict[str, int]],
    doc_length: dict[str, int],
    avgdl: float,
    n_docs: int,
) -> dict[str, float]:
    """BM25 打分。口径：查询词项**去重**后逐项累加；`idf = ln(1 + (N - df + 0.5) / (df + 0.5))`。"""
    scores: dict[str, float] = defaultdict(float)
    for term in sorted(set(query_terms)):
        posting = postings.get(term)
        if not posting:
            continue
        df = len(posting)
        idf = math.log(1 + (n_docs - df + 0.5) / (df + 0.5))
        for doc_id, tf in posting.items():
            dl = doc_length[doc_id]
            scores[doc_id] += idf * tf * (K1 + 1) / (tf + K1 * (1 - B + B * dl / avgdl))
    return dict(scores)


def rank(scores: dict[str, float], k: int = TOP_K) -> list[str]:
    """分数降序；**并列按 doc_id 升序**（口径写死，保证结果唯一确定）。"""
    return [doc_id for doc_id, _ in sorted(scores.items(), key=lambda kv: (-kv[1], kv[0]))[:k]]


# ---------- ⑤ 字符 2-gram 基线 ----------


def bigram_counts(text: str) -> Counter:
    """口径：NFKC + 转小写 → **只留 `[a-z0-9]`** → 相邻两字符为一个 2-gram。"""
    compact = re.sub(r"[^a-z0-9]", "", unicodedata.normalize("NFKC", text or "").lower())
    return Counter(compact[i : i + 2] for i in range(len(compact) - 1))


def bigram_score(query_grams: Counter, doc_grams: Counter) -> float:
    """基线打分口径：查询的每个 2-gram 在文档里出现的次数**直接相加**（不做长度归一化）。

    这正是"不做归一化会发生什么"的对照组：长文档只要堆得够长，碎片重叠就多，分数就高。
    """
    return float(sum(count * doc_grams.get(gram, 0) for gram, count in query_grams.items()))


def recall_at_k(retrieved: list[str], relevant: list[str], k: int = TOP_K) -> float:
    """`|Top-K ∩ 相关| / |相关|`（每个查询各算一次，再对查询取平均）。"""
    if not relevant:
        return 0.0
    return len(set(retrieved[:k]) & set(relevant)) / len(relevant)


def mean(values: list[float]) -> float:
    return round(sum(values) / len(values), 6) if values else 0.0


# ---------- ⑤ 画图 ----------


def plot_by_type(by_type: dict[str, dict[str, float]], fig_root: Path) -> list[dict]:
    fig_root.mkdir(parents=True, exist_ok=True)
    kinds = sorted(by_type)
    x = range(len(kinds))
    width = 0.36
    bm25 = [by_type[k]["bm25"] for k in kinds]
    bigram = [by_type[k]["bigram"] for k in kinds]

    fig, ax = plt.subplots(figsize=(6.4, 4.2))
    ax.bar([i - width / 2 for i in x], bm25, width, label="BM25 (inverted index)", color="#1565c0")
    ax.bar([i + width / 2 for i in x], bigram, width, label="char 2-gram cosine", color="#ef6c00")
    ax.set_xticks(list(x))
    ax.set_xticklabels(kinds)
    ax.set_ylim(0, 1.05)
    ax.set_ylabel("recall@3")
    ax.set_title("Retrieval quality by query type")
    ax.legend(loc="upper right", fontsize=8)
    fig.tight_layout()
    fig.savefig(fig_root / FIG_NAME, dpi=110)
    plt.close(fig)

    detail = "；".join(
        f"{k}: BM25 {by_type[k]['bm25']:.3f} vs 2-gram {by_type[k]['bigram']:.3f}" for k in kinds
    )
    takeaway = (
        f"按查询类型看对照（recall@3）：{detail}。两类方法在「同词」查询上都能命中，"
        f"但在「换了说法」的查询上都掉下来 —— 这就是关键词检索的天花板：它匹配的是字面，不是意思。"
    )
    return [{"path": f"{FIG_DIR}/{FIG_NAME}", "takeaway": takeaway}]


# ---------- ⑥ 结论 ----------


def compose_notes(metrics: dict, by_type: dict, index: dict, n_queries: int) -> str:
    kinds = sorted(by_type)
    weak = kinds[-1] if kinds else "paraphrase"
    return (
        "口径与做法：文档文本取 title + text，按 NFKC + 小写 + 非字母数字切分 + 去停用词切词，"
        f"建成倒排索引（{index['n_docs']} 篇文档 / {index['vocab_size']} 个词项，校验和 {index['postings_checksum']}）；"
        f"检索用 BM25（k1={K1}、b={B}），查询词项去重后逐项累加，分数降序取 Top-3，并列按 doc_id 升序。"
        f"对照的基线是字符 2-gram 的重叠计数（不做长度归一化）—— 它不建词表，只看字符碎片重叠。"
        f"结果：BM25 的 recall@3 = {metrics['recall_at_3_bm25']}，2-gram 基线 = {metrics['recall_at_3_bigram']}"
        f"（{n_queries} 个查询）。BM25 强在两件事：**词频饱和**（同一个词出现 10 次不会比出现 3 次强 3 倍，"
        "避免长文档靠堆词刷分）与**长度归一化**（b 让长文档不吃亏太多）；idf 则让稀有词（如药名）权重更高。"
        f"但它在「{weak}」类查询上明显掉分：查询换成了同义说法（血 thinning / metal scaffold / DNA repair defect），"
        "而倒排索引里根本没有这些词项，命中 0 篇 —— 这就是本章说的「搜得到字面、搜不到意思」。"
        "2-gram 基线更差，原因有两层：它连词都不是，只在字符层面蹭重叠（不会区分同词不同义、也没有 idf），而且不做长度归一化 —— 长文档靠碎片数量就能刷分，把真正相关的那篇挤下去。"
        "局限：本实现没有词干还原（stems/复数）、没有同义词扩展、也处理不了否定（「否认糖尿病」会被误命中）；"
        "停用词表是写死的，换一套表结果就会变；Top-K 的并列规则也写死了，口径一改名单就会变。"
    )


def run_case(case_dir: Path, fig_root: Path | None = None) -> tuple[dict, dict]:
    docs = load_corpus(case_dir / "corpus.csv")
    with (case_dir / "queries.csv").open(encoding="utf-8", newline="") as fh:
        queries = [dict(r) for r in csv.DictReader(fh)]
    with (case_dir / "qrels.csv").open(encoding="utf-8", newline="") as fh:
        qrels: dict[str, list[str]] = defaultdict(list)
        for row in csv.DictReader(fh):
            qrels[row["query_id"]].append(row["doc_id"])

    postings, doc_length, vocab_size = build_index(docs)
    n_docs = len(docs)
    avgdl = sum(doc_length.values()) / n_docs if n_docs else 0.0
    index = {
        "n_docs": n_docs,
        "vocab_size": vocab_size,
        "postings_checksum": postings_checksum(postings),
    }

    doc_bigrams = {row["doc_id"]: bigram_counts(document_text(row)) for row in docs}

    retrieval: list[dict] = []
    baseline: list[dict] = []
    rows_by_type: dict[str, dict[str, list[float]]] = defaultdict(lambda: {"bm25": [], "bigram": []})
    all_bm25: list[float] = []
    all_bigram: list[float] = []
    for q in queries:
        qid = q["query_id"]
        relevant = qrels.get(qid, [])
        terms = tokenize(q["query"])

        scores = bm25_scores(terms, postings, doc_length, avgdl, n_docs)
        top_ids = rank(scores)
        retrieval.append(
            {
                "query_id": qid,
                "top_k": [{"doc_id": d, "score": round(scores[d], 6)} for d in top_ids],
            }
        )

        query_grams = bigram_counts(q["query"])
        sims = {did: bigram_score(query_grams, grams) for did, grams in doc_bigrams.items()}
        base_ids = rank(sims)
        baseline.append({"query_id": qid, "top_ids": base_ids})

        r_bm25 = recall_at_k(top_ids, relevant)
        r_bigram = recall_at_k(base_ids, relevant)
        rows_by_type[q["type"]]["bm25"].append(r_bm25)
        rows_by_type[q["type"]]["bigram"].append(r_bigram)
        all_bm25.append(r_bm25)
        all_bigram.append(r_bigram)

    by_type = {
        kind: {"bm25": mean(vals["bm25"]), "bigram": mean(vals["bigram"])}
        for kind, vals in rows_by_type.items()
    }
    metrics = {
        "recall_at_3_bm25": mean(all_bm25),
        "recall_at_3_bigram": mean(all_bigram),
        "by_type": by_type,
    }

    figures = plot_by_type(by_type, fig_root or Path("."))
    out = {
        "index": index,
        "retrieval": retrieval,
        "baseline": baseline,
        "metrics": metrics,
        "figures": figures,
        "notes": compose_notes(metrics, by_type, index, len(queries)),
    }

    expected = {
        "note": (
            "参考水平（不是标准答案）：分词、BM25 参数、Top-K 并列规则都已在 task.md 里钉死，"
            "所以索引校验和、检索名单与两个 recall 都是确定的 —— 用于核对学生的索引口径、"
            "排名与对照是否算对。硬性判据见 manifest.json 的 assertions，语义判据见 judge.md。"
        ),
        "index": index,
        "retrieval": [{"query_id": r["query_id"], "top_k": [x["doc_id"] for x in r["top_k"]]} for r in retrieval],
        "baseline": [{"query_id": b["query_id"], "top_ids": b["top_ids"]} for b in baseline],
        "metrics": metrics,
    }
    return out, expected


def run_case_to_file(case_dir: Path, out_path: Path) -> None:
    out, _ = run_case(case_dir, Path("."))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[ok] {case_dir.name} → {out_path}")


def regen_expected() -> None:
    for case_dir in sorted(p for p in CASES_DIR.iterdir() if p.is_dir()):
        with tempfile.TemporaryDirectory() as tmp:
            _, expected = run_case(case_dir, Path(tmp))
        path = case_dir / "expected.json"
        path.write_text(json.dumps(expected, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"[regen] {path}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("case_dir", nargs="?")
    ap.add_argument("out_path", nargs="?")
    ap.add_argument("--regen-expected", action="store_true")
    args = ap.parse_args()

    if args.regen_expected:
        regen_expected()
        return
    if not args.case_dir or not args.out_path:
        ap.error("需要 <case目录> <output.json>，或用 --regen-expected")
    run_case_to_file(Path(args.case_dir), Path(args.out_path))


if __name__ == "__main__":
    main()
