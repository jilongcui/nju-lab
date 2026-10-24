"""你的方案：把主诉文本向量化 → 余弦相似度 → Top-3，写 output.json + 一张图。

**代码里的 TODO 才是你要改的地方**（文档 `SKILL.md` 不用改）。
用法：python3 scripts/solve.py <case目录> <output.json> [--fig-dir figures]
"""
import argparse
import csv
import json
from pathlib import Path


def load(case_dir: Path):
    concepts = json.loads((case_dir / "concepts.json").read_text(encoding="utf-8"))
    with (case_dir / "docs.csv").open(encoding="utf-8") as f:
        docs = list(csv.DictReader(f))
    with (case_dir / "queries.csv").open(encoding="utf-8") as f:
        queries = list(csv.DictReader(f))
    return concepts, docs, queries


def vectorize(text: str, concepts: dict) -> list[int]:
    # TODO: 同义词按长度降序替换成概念，再按概念出现次数填 8 维向量
    raise NotImplementedError


def cosine(a: list[int], b: list[int]) -> float:
    # TODO: 点积 / 模长乘积；任一向量全 0 时返回 0
    raise NotImplementedError


def retrieve(qtext: str, docs, concepts, k: int = 3) -> list[dict]:
    # TODO: 算每条文档的相似度（四舍五入 4 位）、丢掉 0 分、按「分数降序 + doc_id 升序」取前 k
    return []


def plot(retrieval: list[dict], fig_dir: Path) -> dict:
    # TODO: 画三条查询的 top-1 分数柱状图；轴标签用英文（复验镜像没有中文字体）
    fig_dir.mkdir(parents=True, exist_ok=True)
    return {"path": f"{fig_dir.as_posix()}/top1_scores.png", "takeaway": ""}


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
        "notes": "",
    }
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
