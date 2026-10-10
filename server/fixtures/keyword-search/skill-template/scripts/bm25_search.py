#!/usr/bin/env python3
"""第 5 章（知识库）的**起点骨架**：把你的实现写在标了 TODO 的地方。

结构已经搭好，与 `problem/reference/scripts/bm25_search.py` 的函数划分**完全一致** ——
先跑通参考实现、读懂它的输出，再回来把自己的 TODO 填掉。

要填的三处：
  ① `build_index` / `postings_checksum` —— 倒排索引与"可逐字节复现"的校验和
  ② `bm25_scores`                      —— BM25 打分（k1 / b / idf 口径都在 task.md 里钉死）
  ③ `bigram_score` / `plot_by_type` / `compose_notes` —— 基线、图与结论

已经给出的部分（最小示例）：切词 `tokenize`、读语料 `load_corpus`、排序 `rank`、
字符 2-gram 计数 `bigram_counts`、`recall@k`、以及把流程串起来的 `run_case`。

用法：
  python3 scripts/bm25_search.py <case目录> <output.json>   # 单个 case（图写到当前目录的 figures/）
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import re
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

import matplotlib

matplotlib.use("Agg")  # 容器内无显示环境
import matplotlib.pyplot as plt  # noqa: E402

FIG_DIR = Path("figures")
FIG_NAME = "recall_by_query_type.png"

K1 = 1.5  # 词频饱和参数（口径写死在 task.md，别改）
B = 0.75  # 长度归一化强度（同上）
TOP_K = 3

STOPWORDS = {
    "a", "an", "the", "of", "in", "on", "for", "with", "and", "or", "to", "is", "are", "was",
    "were", "be", "been", "by", "as", "at", "from", "that", "this", "these", "those", "it", "its",
    "may", "can", "should", "must", "than", "then", "over", "after", "before", "during", "into",
    "not", "no", "but", "if", "when", "which", "who", "what", "how", "why", "does", "do", "did",
}


# ---------------------------------------------------------------- 已给出：切词 / 读数据 / 排序


def tokenize(text: str) -> list[str]:
    """口径：NFKC + 转小写 → 按**非字母数字**切分 → 丢掉长度 < 2 的词与停用词。"""
    lowered = unicodedata.normalize("NFKC", text or "").lower()
    return [t for t in re.split(r"[^a-z0-9]+", lowered) if len(t) >= 2 and t not in STOPWORDS]


def document_text(row: dict[str, str]) -> str:
    """一份文档的检索文本 = `title` + 一个空格 + `text`（口径写死在 task.md）。"""
    return f"{row.get('title', '')} {row.get('text', '')}"


def load_corpus(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8", newline="") as fh:
        return [dict(r) for r in csv.DictReader(fh)]


def rank(scores: dict[str, float], k: int = TOP_K) -> list[str]:
    """分数降序；**并列按 doc_id 升序**（口径写死，保证结果唯一确定）。"""
    return [doc_id for doc_id, _ in sorted(scores.items(), key=lambda kv: (-kv[1], kv[0]))[:k]]


def bigram_counts(text: str) -> Counter:
    """口径：NFKC + 转小写 → **只留 `[a-z0-9]`** → 相邻两字符为一个 2-gram。"""
    compact = re.sub(r"[^a-z0-9]", "", unicodedata.normalize("NFKC", text or "").lower())
    return Counter(compact[i : i + 2] for i in range(len(compact) - 1))


def recall_at_k(retrieved: list[str], relevant: list[str], k: int = TOP_K) -> float:
    """`|Top-K ∩ 相关| / |相关|`（每个查询各算一次，再对查询取平均）。"""
    if not relevant:
        return 0.0
    return len(set(retrieved[:k]) & set(relevant)) / len(relevant)


def mean(values: list[float]) -> float:
    return round(sum(values) / len(values), 6) if values else 0.0


# ---------------------------------------------------------------- TODO ①：倒排索引


def build_index(docs: list[dict[str, str]]) -> tuple[dict[str, dict[str, int]], dict[str, int], int]:
    """返回 `(postings, doc_length, vocab_size)`。

    TODO ①：`postings[词项][doc_id] = 该词在本文档出现的次数`（用 `Counter` 数一数就行）；
    `doc_length[doc_id]` = 该文档切词后的词项**总数**（含重复）；
    `vocab_size` = 索引里的唯一词项数。
    """
    raise NotImplementedError("TODO ①：实现 build_index")


def postings_checksum(postings: dict[str, dict[str, int]]) -> str:
    """口径写死在 task.md：`词项|doc_id|词频` 行（词项升序、同词项内 doc_id 升序），
    行间 `\\n`、末尾不加换行，UTF-8 → sha256 十六进制**前 12 位**。

    TODO ①：注意这两点最容易写错 —— **行序**，以及**末尾不要多加换行**。
    """
    raise NotImplementedError("TODO ①：实现 postings_checksum")


# ---------------------------------------------------------------- TODO ②：BM25


def bm25_scores(
    query_terms: list[str],
    postings: dict[str, dict[str, int]],
    doc_length: dict[str, int],
    avgdl: float,
    n_docs: int,
) -> dict[str, float]:
    """BM25 打分。口径（写死在 task.md）：

      idf(词项) = ln(1 + (N - df + 0.5) / (df + 0.5))
      score(文档) += idf * tf * (k1 + 1) / (tf + k1 * (1 - b + b * dl / avgdl))

    TODO ②：查询词项**去重**后逐项累加；索引里没有的词项直接跳过；
    只给"有分"的文档建条目（没命中任何词项的文档不要出现在结果里）。
    """
    raise NotImplementedError("TODO ②：实现 bm25_scores")


# ---------------------------------------------------------------- TODO ③：基线 / 图 / 结论


def bigram_score(query_grams: Counter, doc_grams: Counter) -> float:
    """基线打分口径：查询的每个 2-gram 在文档里出现的次数**直接相加**（不做长度归一化）。

    TODO ③：就按口径写 —— `Σ_g count_query(g) * count_doc(g)`。
    **不要"顺手"做归一化**：一归一化就不是本实验要对照的那个做法了。
    """
    raise NotImplementedError("TODO ③：实现 bigram_score")


def plot_by_type(by_type: dict[str, dict[str, float]], fig_root: Path) -> list[dict]:
    """画一张分组柱状图，返回 `[{"path", "takeaway"}]`。

    TODO ③：给出最小示例要自己补 —— **图上的标题与轴标签用英文**（镜像里没有中文字体，
    中文会变方框），存到 `<工作目录>/figures/` 下；`takeaway` 里的数字要与 `metrics` 自洽。
    """
    fig_root.mkdir(parents=True, exist_ok=True)
    kinds = sorted(by_type)
    x = range(len(kinds))
    width = 0.36
    fig, ax = plt.subplots(figsize=(6.4, 4.2))
    ax.bar([i - width / 2 for i in x], [by_type[k]["bm25"] for k in kinds], width, label="BM25 (inverted index)")
    ax.bar([i + width / 2 for i in x], [by_type[k]["bigram"] for k in kinds], width, label="char 2-gram")
    ax.set_xticks(list(x))
    ax.set_xticklabels(kinds)
    ax.set_ylim(0, 1.05)
    ax.set_ylabel("recall@3")
    ax.set_title("Retrieval quality by query type")
    ax.legend(loc="upper right", fontsize=8)
    fig.tight_layout()
    fig.savefig(fig_root / FIG_NAME, dpi=110)
    plt.close(fig)
    return [{"path": f"{FIG_DIR}/{FIG_NAME}", "takeaway": "TODO：用一句话说清这张图告诉了我们什么"}]


def compose_notes(metrics: dict, by_type: dict, index: dict, n_queries: int) -> str:
    """`notes`：≥60 字。TODO ③ —— 讲清口径与做法、BM25 的哪两个机制在起作用、
    改写查询为什么仍然搜不到、以及至少一条真实局限。"""
    raise NotImplementedError("TODO ③：实现 compose_notes")


# ---------------------------------------------------------------- 串起来（不用改）


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

        scores = bm25_scores(tokenize(q["query"]), postings, doc_length, avgdl, n_docs)
        top_ids = rank(scores)
        retrieval.append(
            {"query_id": qid, "top_k": [{"doc_id": d, "score": round(scores[d], 6)} for d in top_ids]}
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

    out = {
        "index": index,
        "retrieval": retrieval,
        "baseline": baseline,
        "metrics": metrics,
        "figures": plot_by_type(by_type, fig_root or Path(".")),
        "notes": compose_notes(metrics, by_type, index, len(queries)),
    }

    expected = {
        "index": index,
        "retrieval": [
            {"query_id": r["query_id"], "top_k": [x["doc_id"] for x in r["top_k"]]} for r in retrieval
        ],
        "baseline": baseline,
        "metrics": metrics,
    }
    return out, expected


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("case_dir", help="case 目录（含 corpus.csv / queries.csv / qrels.csv）")
    ap.add_argument("out_path", help="输出 output.json 的路径")
    args = ap.parse_args()
    case_dir, out_path = Path(args.case_dir), Path(args.out_path)
    out, _ = run_case(case_dir, Path("."))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[ok] {case_dir.name} → {out_path}")


if __name__ == "__main__":
    main()
