"""参考实现：词表向量化 → 余弦相似度 → Top-3，写 output.json + 一张图。

用法：python3 scripts/solve.py <case目录> <output.json> [--fig-dir figures]
"""
import argparse
import csv
import json
import math
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402


def load(case_dir: Path):
    concepts = json.loads((case_dir / "concepts.json").read_text(encoding="utf-8"))
    with (case_dir / "docs.csv").open(encoding="utf-8") as f:
        docs = list(csv.DictReader(f))
    with (case_dir / "queries.csv").open(encoding="utf-8") as f:
        queries = list(csv.DictReader(f))
    return concepts, docs, queries


def vectorize(text: str, concepts: dict) -> list[int]:
    """同义词先归一到概念（长词优先），再按概念计数。"""
    s = text
    for word in sorted(concepts["synonyms"], key=len, reverse=True):
        s = s.replace(word, concepts["synonyms"][word])
    return [s.count(name) for name in concepts["concepts"]]


def cosine(a: list[int], b: list[int]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return 0.0 if na == 0 or nb == 0 else dot / (na * nb)


def retrieve(qtext: str, docs, concepts, k: int = 3) -> list[dict]:
    qv = vectorize(qtext, concepts)
    scored = [
        {"doc_id": d["doc_id"], "score": round(cosine(qv, vectorize(d["text"], concepts)), 4)}
        for d in docs
    ]
    scored = [s for s in scored if s["score"] > 0]  # 完全不相关的查询返回空
    scored.sort(key=lambda s: (-s["score"], s["doc_id"]))  # 同分按 doc_id 升序
    return scored[:k]


def plot(retrieval: list[dict], fig_dir: Path) -> dict:
    fig_dir.mkdir(parents=True, exist_ok=True)
    labels = [r["query_id"] for r in retrieval]
    values = [r["top_k"][0]["score"] if r["top_k"] else 0.0 for r in retrieval]
    fig, ax = plt.subplots(figsize=(4.6, 3.4))
    ax.bar(labels, values, color="#59A14F")
    ax.set_ylim(0, 1.05)
    ax.set_ylabel("top-1 cosine score")
    ax.set_title("Top-1 similarity by query")
    for i, v in enumerate(values):
        ax.text(i, v + 0.02, f"{v:.2f}", ha="center", fontsize=9)
    fig.tight_layout()
    fig.savefig(fig_dir / "top1_scores.png", dpi=110)
    plt.close(fig)
    same = next(r for r in retrieval if r["kind"] == "same_words")
    para = next(r for r in retrieval if r["kind"] == "paraphrase")
    empty = next(r for r in retrieval if r["kind"] == "irrelevant")
    return {
        "path": f"{fig_dir.as_posix()}/top1_scores.png",
        "takeaway": (
            f"同词查询 top1 分数 {same['top_k'][0]['score'] if same['top_k'] else 0:.2f}，"
            f"同义改写 {para['top_k'][0]['score'] if para['top_k'] else 0:.2f}，"
            f"不相关查询命中 {len(empty['top_k'])} 条——说明向量检索找的是'意思像'，不是字面像。"
        ),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("case_dir")
    ap.add_argument("out")
    ap.add_argument("--fig-dir", default="figures")
    a = ap.parse_args()

    concepts, docs, queries = load(Path(a.case_dir))
    retrieval = [
        {"query_id": q["query_id"], "kind": q["kind"], "top_k": retrieve(q["text"], docs, concepts)}
        for q in queries
    ]
    out = {
        "index": {"dim": concepts["dim"], "n_docs": len(docs)},
        "retrieval": retrieval,
        "figures": [plot(retrieval, Path(a.fig_dir))],
        "notes": (
            f"用 {concepts['dim']} 个概念词表做玩具 embedding：先把同义词归一到概念（例如「胸闷」→「胸痛」），"
            "再按概念出现次数成向量，用余弦相似度算相似度并取 Top-3（只保留分数 > 0 的）。"
            f"同词查询（{retrieval[0]['query_id']}）能拿到满分命中；同义改写（{retrieval[1]['query_id']}）"
            "因为归一到同一概念也命中；完全不相关的查询（{}）返回空——这正说明向量检索回答的是「像不像」，不是「对不对」。".format(
                retrieval[2]["query_id"]
            )
        ),
    }
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
