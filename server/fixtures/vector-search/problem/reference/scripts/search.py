#!/usr/bin/env python3
"""实验二（向量数据库）的参考实现（学习示范）：语料 + 查询 + 概念词表 + 更新单 → `output.json` + 一张图。

📖 这份实现**随题目包一起下发**（`problem/reference/`）—— 先读懂它，再写你自己的。
   **它不是唯一正确答案**：向量怎么存（list / numpy / SQLite blob）、索引怎么组织都随你，
   判据只看"检索结果与口径一致 + 更新后索引真的跟着变 + 说清机制与局限"。

本实现走完**完整流程**（与 task.md 的六步对应）：
  ① 看清需求      —— 要解决的是"字面不同、意思相近"的检索
  ② 回头看概念    —— 为什么"心梗"和"心肌梗死"要落进同一维（词表就是最简的 embedding）
  ③ 建立向量库    —— `embed` + `build_index`：把每条语料变成向量存起来
  ④ 检索与对照    —— `search`（余弦 Top-3）vs `keyword_topk`（字符 bigram）
  ⑤ 增删改查      —— `apply_updates`：新增 / 改写（**向量要重算**）/ 删除 / 带元数据过滤的检索
  ⑥ 评估与结论    —— `recall_at_k` 算两种检索的召回 + 一张对比图 + `notes`

用法：
  python3 scripts/search.py <case目录> <output.json>       # 单个 case（图写到当前目录的 figures/）
  python3 scripts/search.py --regen-expected               # 重算 problem/cases/*/expected.json

请在**与复验同一个镜像内**生成 expected（当前 pkg6）：

  docker run --rm -v "$PWD:/w" --entrypoint python3 \
    nju-lab-verify:0.2.0-rc.2-pkg6 /w/problem/reference/scripts/search.py --regen-expected
"""
from __future__ import annotations

import argparse
import csv
import json
import math
from pathlib import Path

import matplotlib

matplotlib.use("Agg")  # 容器内无显示环境
import matplotlib.pyplot as plt  # noqa: E402

TOP_K = 3
FIG_DIR = Path("figures")

HERE = Path(__file__).resolve().parent
CASES_DIR = HERE.parent.parent / "cases"


# ---------------------------------------------------------------- ②③ 向量化
def load_concepts(case_dir: str | Path) -> dict:
    """读概念词表：每个概念 = 向量的一维，terms 是它的同义词。"""
    return json.loads((Path(case_dir) / "concepts.json").read_text(encoding="utf-8"))


def embed(text: str, concepts: dict) -> list[float]:
    """把一段文本变成向量：按词表数同义词出现次数 → L2 归一化。

    这一步就是真实 embedding 模型的**玩具版** —— 区别只在于"相近的语义落到相近的向量"
    这件事，这里是靠人写的同义词表实现的，真实模型是靠训练学到的。
    """
    lowered = text.lower()
    raw = [
        sum(lowered.count(term.lower()) for term in concept["terms"])
        for concept in concepts["concepts"]
    ]
    norm = math.sqrt(sum(v * v for v in raw))
    if norm == 0:
        return [0.0] * len(raw)
    return [v / norm for v in raw]


def build_index(docs: list[dict], concepts: dict) -> dict[str, list[float]]:
    """③ 建立向量库：doc_id → 向量。"""
    return {d["doc_id"]: embed(d["text"], concepts) for d in docs}


def cosine(a: list[float], b: list[float]) -> float:
    """两个**已归一化**向量的余弦相似度就是点积。"""
    return sum(x * y for x, y in zip(a, b))


def search(query: str, index: dict[str, list[float]], concepts: dict,
           docs_by_id: dict[str, dict] | None = None, dept: str | None = None,
           top_k: int = TOP_K) -> list[dict]:
    """④ 相似度检索：算查询向量 → 与库里每条向量算余弦 → Top-K（同分按 doc_id 升序）。

    `dept` 给出时只在该科室的语料里检索（向量库的"带元数据过滤"用法）。
    """
    q = embed(query, concepts)
    scored = []
    for doc_id, vec in index.items():
        if dept is not None and docs_by_id and docs_by_id[doc_id]["dept"] != dept:
            continue
        scored.append((round(cosine(q, vec), 4), doc_id))
    scored.sort(key=lambda t: (-t[0], t[1]))
    # 口径：只返回**分数大于 0** 的结果（没命中就少返回，不硬凑 K 条）
    hits = [{"doc_id": doc_id, "score": score} for score, doc_id in scored if score > 0]
    return hits[:top_k]


# ---------------------------------------------------------------- ④ 对照：关键词检索
def bigrams(text: str) -> list[str]:
    """相邻两个字符组成的所有 2-gram（去重）。"""
    lowered = text.lower()
    return sorted({lowered[i:i + 2] for i in range(len(lowered) - 1)})


def keyword_topk(query: str, docs: list[dict], top_k: int = TOP_K) -> list[dict]:
    """④ 关键词（字面）检索：文档得分 = 查询的 2-gram 在文档里出现的总次数。

    它**不做任何同义扩展** —— 这正是它在"改写过的查询"上会漏的原因。
    """
    grams = bigrams(query)
    scored = []
    for d in docs:
        text = d["text"].lower()
        scored.append((sum(text.count(g) for g in grams), d["doc_id"]))
    scored.sort(key=lambda t: (-t[0], t[1]))
    # 口径：只返回**分数大于 0** 的结果（没命中就少返回，不硬凑 K 条）
    hits = [{"doc_id": doc_id, "score": score} for score, doc_id in scored if score > 0]
    return hits[:top_k]


def recall_at_k(topk: list[dict], relevant: list[str], k: int = TOP_K) -> float | None:
    """召回率 = Top-K 命中数 / 相关文档总数（没有标注相关文档的查询不参与平均）。"""
    if not relevant:
        return None
    hits = len({item["doc_id"] for item in topk[:k]} & set(relevant))
    return hits / len(relevant)


# ---------------------------------------------------------------- ⑤ 增删改查
def apply_updates(index: dict[str, list[float]], docs: list[dict], updates: dict,
                  concepts: dict, queries: list[dict]) -> tuple[dict, list[dict], list[dict]]:
    """按更新单做增删改：新增要算向量，改写要**重算**向量，删除要从索引里移除。

    返回 `(crud 报告, 更新后的语料, 更新单里的过滤检索命中哪些相关文档)`。
    """
    docs_by_id = {d["doc_id"]: d for d in docs}

    added = 0
    for item in updates["add_docs"]:
        doc = {"doc_id": item["doc_id"], "text": item["text"], "dept": item["dept"]}
        docs.append(doc)
        docs_by_id[doc["doc_id"]] = doc
        index[doc["doc_id"]] = embed(doc["text"], concepts)
        added += 1

    updated = changed_vector = 0
    for item in updates["update_docs"]:
        doc = docs_by_id[item["doc_id"]]
        before = index[doc["doc_id"]]
        doc["text"] = item["text"]
        after = embed(doc["text"], concepts)
        index[doc["doc_id"]] = after
        updated += 1
        changed_vector += int(before != after)

    deleted = 0
    for doc_id in updates["delete_docs"]:
        if doc_id in index:
            index.pop(doc_id)
            docs = [d for d in docs if d["doc_id"] != doc_id]
            docs_by_id.pop(doc_id, None)
            deleted += 1

    # 更新之后的检索：新增/删除/改写都会体现在结果里
    post = [
        {"query_id": q["query_id"], "top_k": search(q["text"], index, concepts, docs_by_id)}
        for q in queries[:2]
    ]

    fq = updates["filter_query"]
    owner_query = next(q for q in queries if q["query_id"] == fq["query_id"])
    filtered = {
        "query_id": fq["query_id"],
        "dept": fq["dept"],
        "top_k": search(owner_query["text"], index, concepts, docs_by_id, dept=fq["dept"]),
    }

    return {
        "added": added,
        "updated": updated,
        "deleted": deleted,
        "n_docs_final": len(index),
        "update_changed_vector": bool(changed_vector == updated),
        "post_retrieval": post,
        "filtered": filtered,
    }, docs, post


# ---------------------------------------------------------------- ⑥ 评估与结论
def plot_recall_comparison(metrics: dict, fig_dir: Path = FIG_DIR) -> dict:
    """⑥ 两种检索的召回对比（图上的文字用英文：容器里没有中文字体）。"""
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
        f"向量检索的 recall@{TOP_K} 为 {values[0]:.2f}，关键词检索只有 {values[1]:.2f}；"
        f"改写过的查询（字面完全不同）关键词基本搜不到，向量检索靠同义词落进同一维把它找了回来。"
    )
    return {"path": str(path), "takeaway": takeaway}


def compose_notes(concepts: dict, metrics: dict, crud: dict, queries: list[dict]) -> str:
    """⑥ 写结论：机制（同义词→同一维）→ 对照结果 → 更新后索引的变化 → 局限。"""
    n_para = sum(1 for q in queries if q["kind"] == "paraphrase")
    return (
        f"向量化用的是词表打分的玩具版 embedding：{concepts['dim']} 个概念各占一维，"
        f"同义词表让「心梗」和「心肌梗死」落进同一维，所以「字面不同、意思相近」能被算出来。"
        f"{n_para} 条改写查询上，向量检索 recall@{TOP_K} {metrics['recall_at_3_vector']:.2f}，"
        f"关键词（字符 bigram）只有 {metrics['recall_at_3_keyword']:.2f} —— 因为关键词不做同义词扩展，"
        f"改写后字面几乎不重叠。"
        f"更新单执行后：新增 {crud['added']} 条、改写 {crud['updated']} 条（向量必须重算，"
        f"否则检索还按旧文本给分）、删除 {crud['deleted']} 条，库里剩 {crud['n_docs_final']} 条；"
        f"带科室过滤的检索把范围收到一个科室里，Top-1 是 "
        f"{crud['filtered']['top_k'][0]['doc_id'] if crud['filtered']['top_k'] else '（无）'}。"
        f"局限：词表是人写的，没收录的说法一律搜不到；真实场景要用训练好的 embedding 模型，"
        f"机制相同但泛化能力强得多。"
    )


def build_report(case_dir: str | Path, fig_dir: Path = FIG_DIR) -> dict:
    concepts = load_concepts(case_dir)
    with (Path(case_dir) / "corpus.csv").open(encoding="utf-8", newline="") as fh:
        docs = [dict(r) for r in csv.DictReader(fh)]
    with (Path(case_dir) / "queries.csv").open(encoding="utf-8", newline="") as fh:
        queries = [
            {
                "query_id": r["query_id"], "text": r["text"], "kind": r["kind"],
                "relevant_doc_ids": [x for x in r["relevant_doc_ids"].split("|") if x],
            }
            for r in csv.DictReader(fh)
        ]
    updates = json.loads((Path(case_dir) / "updates.json").read_text(encoding="utf-8"))

    # ③ 建库（CRUD 之前的状态）
    index = build_index(docs, concepts)
    docs_by_id = {d["doc_id"]: d for d in docs}
    n_docs_initial = len(index)

    # ④ 检索 + 关键词对照
    retrieval = [
        {"query_id": q["query_id"], "kind": q["kind"],
         "top_k": search(q["text"], index, concepts, docs_by_id)}
        for q in queries
    ]
    keyword_baseline = [
        {"query_id": q["query_id"], "top_k": keyword_topk(q["text"], docs)} for q in queries
    ]

    # ⑥ 评估（两条路都用同一个"相关文档"标注）
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

    # ⑤ 增删改查（在同一个索引上继续操作）
    crud, docs, _ = apply_updates(index, docs, updates, concepts, queries)

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
    Path(out_path).write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return report


def regen_expected() -> None:
    """重算每个 case 的 expected.json（参考水平，不是标准答案）。"""
    import tempfile

    for case_dir in sorted(p for p in CASES_DIR.iterdir() if p.is_dir()):
        with tempfile.TemporaryDirectory() as tmp:
            report = build_report(case_dir, Path(tmp))
        expected = {
            "note": (
                "参考水平（不是标准答案）：向量化与检索口径已在 task.md 里钉死，所以 Top-K 与召回率是确定的。"
                "这几项用于核对学生的向量化/检索是否与口径一致、更新单是否真的改到索引上。"
                "硬性判据见 manifest.json 的 assertions，语义判据见 judge.md。"
            ),
            "index": {"dim": report["index"]["dim"], "n_docs": report["index"]["n_docs"]},
            "retrieval": [
                {"query_id": r["query_id"], "top_ids": [x["doc_id"] for x in r["top_k"]]}
                for r in report["retrieval"]
            ],
            "keyword_baseline": [
                {"query_id": r["query_id"], "top_ids": [x["doc_id"] for x in r["top_k"]]}
                for r in report["keyword_baseline"]
            ],
            "metrics": report["metrics"],
            "crud": {
                "added": report["crud"]["added"],
                "updated": report["crud"]["updated"],
                "deleted": report["crud"]["deleted"],
                "n_docs_final": report["crud"]["n_docs_final"],
                "post_retrieval": [
                    {"query_id": p["query_id"], "top_ids": [x["doc_id"] for x in p["top_k"]]}
                    for p in report["crud"]["post_retrieval"]
                ],
                "filtered": {
                    "query_id": report["crud"]["filtered"]["query_id"],
                    "dept": report["crud"]["filtered"]["dept"],
                    "top_ids": [x["doc_id"] for x in report["crud"]["filtered"]["top_k"]],
                },
            },
            "accept": {"top_k": TOP_K, "vector_must_beat_keyword": True},
        }
        out = case_dir / "expected.json"
        out.write_text(json.dumps(expected, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(
            f"[regen] {out.name}@{case_dir.name}: dim={expected['index']['dim']} "
            f"vector={expected['metrics']['recall_at_3_vector']} "
            f"keyword={expected['metrics']['recall_at_3_keyword']} "
            f"n_queries={expected['metrics']['n_queries_evaluated']}"
        )


def main() -> None:
    ap = argparse.ArgumentParser(description="向量检索实验的参考实现")
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
    print(json.dumps({k: v for k, v in report.items() if k != "retrieval"}, ensure_ascii=False))
    for fig in report["figures"]:
        print(f"  [图] {fig['path']} —— {fig['takeaway']}")


if __name__ == "__main__":
    main()
