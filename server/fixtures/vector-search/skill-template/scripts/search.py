#!/usr/bin/env python3
"""实验二（向量数据库）的**起点骨架**：把你的实现写在标了 TODO 的地方。

结构与 `problem/reference/scripts/search.py` 的函数划分一致 —— 先跑通它、读懂它的输出，
再回来填自己的 TODO。三处 TODO：

  ① `embed` / `build_index` —— 按词表做向量化（L2 归一化）并建库
  ② `search` / `keyword_topk` —— 余弦 Top-K 与关键词（字符 2-gram）对照检索
  ③ `apply_updates` —— 新增 / 改写（**重算向量**）/ 删除 / 带科室过滤的检索

用法：
  python3 scripts/search.py <case目录> <output.json>     # 单个 case（图写到当前目录的 figures/）
"""
from __future__ import annotations

import argparse
import csv
import json
import math
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

TOP_K = 3
FIG_DIR = Path("figures")


# ---------------------------------------------------------------- 读数据（已给出）
def load_case(case_dir: str | Path) -> tuple[dict, list[dict], list[dict], dict]:
    """读 `concepts.json` / `corpus.csv` / `queries.csv` / `updates.json`。"""
    case_dir = Path(case_dir)
    concepts = json.loads((case_dir / "concepts.json").read_text(encoding="utf-8"))
    with (case_dir / "corpus.csv").open(encoding="utf-8", newline="") as fh:
        docs = [dict(r) for r in csv.DictReader(fh)]
    with (case_dir / "queries.csv").open(encoding="utf-8", newline="") as fh:
        queries = [
            {
                "query_id": r["query_id"], "text": r["text"], "kind": r["kind"],
                "relevant_doc_ids": [x for x in r["relevant_doc_ids"].split("|") if x],
            }
            for r in csv.DictReader(fh)
        ]
    updates = json.loads((case_dir / "updates.json").read_text(encoding="utf-8"))
    return concepts, docs, queries, updates


# ---------------------------------------------------------------- TODO ①：向量化 + 建库
def embed(text: str, concepts: dict) -> list[float]:
    """把一段文本变成向量：按词表数同义词出现次数 → L2 归一化。

    口径（`task.md`「向量化口径」）：
      1. 文本转小写；
      2. 对第 i 个概念，累加它**全部同义词**在该文本中的出现次数（子串计数）；
      3. 得到 dim 维向量后 **L2 归一化**（除以模长）；模长为 0 → 返回全零向量。

    最小示例（统计某一维）：

        lowered = text.lower()
        count = sum(lowered.count(term.lower()) for term in concept["terms"])

    提示：`math.sqrt(sum(v * v for v in raw))` 就是模长。
    """
    # TODO：实现向量化
    raise NotImplementedError("TODO：按 task.md 的向量化口径实现 embed")


def build_index(docs: list[dict], concepts: dict) -> dict[str, list[float]]:
    """建立向量库：doc_id → 向量。"""
    # TODO：对每条语料调用 embed
    raise NotImplementedError("TODO：实现 build_index")


# ---------------------------------------------------------------- TODO ②：两种检索
def cosine(a: list[float], b: list[float]) -> float:
    """两个**已归一化**向量的余弦相似度 = 点积。"""
    return sum(x * y for x, y in zip(a, b))


def search(query: str, index: dict[str, list[float]], concepts: dict,
           docs_by_id: dict[str, dict] | None = None, dept: str | None = None,
           top_k: int = TOP_K) -> list[dict]:
    """向量检索：查询向量 → 与库里每条算余弦 → Top-K。

    口径：**只返回相似度 > 0 的**（没命中就少返回）；相似度相同按 `doc_id` 升序；
    `dept` 给出时只在该科室的语料里检索。

    返回 `[{"doc_id": ..., "score": ...}, ...]`（score 四舍五入到 4 位）。
    """
    # TODO：实现向量检索
    raise NotImplementedError("TODO：实现 search")


def keyword_topk(query: str, docs: list[dict], top_k: int = TOP_K) -> list[dict]:
    """关键词（字面）检索：文档得分 = 查询的 2-gram 在文档里出现的总次数。

    口径：查询文本转小写 → 取**相邻两个字符**组成的全部 2-gram 并**去重** →
    对每个文档统计这些 2-gram 在其文本（小写）中出现的**总次数** → Top-K。
    同样**只返回得分 > 0** 的；同分按 `doc_id` 升序。

    最小示例（取一个文本的全部 2-gram）：

        lowered = text.lower()
        grams = {lowered[i:i + 2] for i in range(len(lowered) - 1)}
    """
    # TODO：实现关键词对照检索
    raise NotImplementedError("TODO：实现 keyword_topk")


def recall_at_k(topk: list[dict], relevant: list[str], k: int = TOP_K) -> float | None:
    """召回率 = Top-K 命中数 / 相关文档总数；没有标注相关文档的查询返回 None（不参与平均）。"""
    if not relevant:
        return None
    hits = len({item["doc_id"] for item in topk[:k]} & set(relevant))
    return hits / len(relevant)


# ---------------------------------------------------------------- TODO ③：增删改查
def apply_updates(index: dict[str, list[float]], docs: list[dict], updates: dict,
                  concepts: dict, queries: list[dict]) -> tuple[dict, list[dict]]:
    """按更新单做增删改，并返回 `(crud 报告, 更新后的语料)`。

    口径（`task.md`「增删改查口径」）：
      - `add_docs`：入库 + **算向量**；
      - `update_docs`：改文本 **并重算向量**（不重算，检索还按旧文本给分）；
      - `delete_docs`：从索引与语料里移除；
      - `filter_query`：用该查询的文本，在指定 `dept` 的语料里再检索一次 Top-3；
      - 结束后对**前两条查询**重跑向量检索，结果放进 `post_retrieval`。

    crud 报告要有的键：`added` / `updated` / `deleted` / `n_docs_final` /
    `update_changed_vector`（布尔）/ `post_retrieval` / `filtered`。

    最小示例：

        doc = {"doc_id": ..., "text": ..., "dept": ...}
        docs.append(doc); index[doc["doc_id"]] = embed(doc["text"], concepts)
    """
    # TODO：实现增删改查与更新后的检索
    raise NotImplementedError("TODO：实现 apply_updates")


# ---------------------------------------------------------------- 已给出：评估、画图、串联
def plot_recall_comparison(metrics: dict, fig_dir: Path = FIG_DIR) -> dict:
    """两种检索的召回对比（图上的文字用英文：容器里没有中文字体）。"""
    fig_dir.mkdir(parents=True, exist_ok=True)
    names = ["vector (concept embeddings)", "keyword (char bigrams)"]
    values = [metrics["recall_at_3_vector"], metrics["recall_at_3_keyword"]]
    fig, ax = plt.subplots(figsize=(6, 4))
    bars = ax.bar(names, values, color=["#4C78A8", "#F58518"], width=0.5)
    ax.set_ylabel(f"recall@{TOP_K} (mean over labelled queries)")
    ax.set_ylim(0, 1)
    ax.set_title("Semantic vs keyword retrieval")
    for b, v in zip(bars, values):
        ax.text(b.get_x() + b.get_width() / 2, v, f"{v:.2f}", ha="center", va="bottom", fontsize=9)
    fig.tight_layout()
    path = fig_dir / "recall_comparison.png"
    fig.savefig(path, dpi=110)
    plt.close(fig)
    takeaway = (
        f"向量检索的 recall@{TOP_K} 为 {values[0]:.2f}，关键词检索为 {values[1]:.2f}。"
    )
    return {"path": str(path), "takeaway": takeaway}


def compose_notes(concepts: dict, metrics: dict, crud: dict, queries: list[dict]) -> str:
    """⑥ 写结论：**这段最好你自己写** —— 机制（同义词→同一维）、为什么关键词会漏、改写要重算向量、局限。"""
    # TODO：把下面这句换成你自己的总结（判据要看你有没有说清机制与局限）
    return f"向量检索 recall@3 {metrics['recall_at_3_vector']}，关键词 {metrics['recall_at_3_keyword']}。"


def build_report(case_dir: str | Path, fig_dir: Path = FIG_DIR) -> dict:
    concepts, docs, queries, updates = load_case(case_dir)

    index = build_index(docs, concepts)
    docs_by_id = {d["doc_id"]: d for d in docs}
    n_docs_initial = len(index)

    retrieval = [
        {"query_id": q["query_id"], "kind": q["kind"],
         "top_k": search(q["text"], index, concepts, docs_by_id)}
        for q in queries
    ]
    keyword_baseline = [
        {"query_id": q["query_id"], "top_k": keyword_topk(q["text"], docs)} for q in queries
    ]

    vec_scores, kw_scores = [], []
    for q, r, kb in zip(queries, retrieval, keyword_baseline):
        v = recall_at_k(r["top_k"], q["relevant_doc_ids"])
        k = recall_at_k(kb["top_k"], q["relevant_doc_ids"])
        if v is not None:
            vec_scores.append(v)
        if k is not None:
            kw_scores.append(k)
    metrics = {
        "recall_at_3_vector": round(sum(vec_scores) / len(vec_scores), 4) if vec_scores else 0.0,
        "recall_at_3_keyword": round(sum(kw_scores) / len(kw_scores), 4) if kw_scores else 0.0,
        "n_queries_evaluated": len(vec_scores),
    }

    crud, docs = apply_updates(index, docs, updates, concepts, queries)
    figures = [plot_recall_comparison(metrics, fig_dir)]
    return {
        "index": {
            "dim": int(concepts["dim"]),
            "n_docs": n_docs_initial,
            "n_docs_after_crud": crud["n_docs_final"],
        },
        "retrieval": retrieval,
        "keyword_baseline": keyword_baseline,
        "metrics": metrics,
        "crud": crud,
        "figures": figures,
        "notes": compose_notes(concepts, metrics, crud, queries),
    }


def run_case(case_dir: str | Path, out_path: str | Path, fig_dir: Path = FIG_DIR) -> dict:
    report = build_report(case_dir, fig_dir)
    Path(out_path).write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return report


def main() -> None:
    ap = argparse.ArgumentParser(description="相似病例检索（你的实现）")
    ap.add_argument("case_dir")
    ap.add_argument("out")
    args = ap.parse_args()
    report = run_case(args.case_dir, args.out)
    print(json.dumps({k: v for k, v in report.items() if k != "retrieval"}, ensure_ascii=False))
    for fig in report["figures"]:
        print(f"  [图] {fig['path']} —— {fig['takeaway']}")


if __name__ == "__main__":
    main()
