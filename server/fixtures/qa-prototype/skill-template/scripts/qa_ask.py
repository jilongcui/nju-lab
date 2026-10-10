#!/usr/bin/env python3
"""第 9 章（综合实践）的**起点骨架**：把你的实现写在标了 TODO 的地方。

结构已经搭好，与 `problem/reference/scripts/qa_ask.py` 的函数划分**完全一致** ——
先跑通参考实现、读懂它的输出，再回来把自己的 TODO 填掉。

要填的三处：
  ① `keyword_passages` / `rank_passages_by_similarity` —— 段落层的两条路（字面共现 / 相似度）
  ② `neighbors` / `shortest_path`                        —— 图谱层的邻居查询与多跳最短路径
  ③ `answer_question` / `compose_notes`                  —— 逐题路由（本实验的核心）与结论

已经给出的部分（最小示例）：读数据 `load_all`、内存 SQLite `build_sql`、
字符 2-gram 与余弦 `char_bigrams` / `cosine`、画图 `plot_routes`。

用法：
  python3 scripts/qa_ask.py <case目录> <output.json>     # 单个 case（图写到当前目录的 figures/）
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import sqlite3
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

import matplotlib

matplotlib.use("Agg")  # 容器内无显示环境
import matplotlib.pyplot as plt  # noqa: E402

FIG_DIR = Path("figures")
FIG_NAME = "route_counts.png"

# Q02 的字面术语（三个概念都要出现）与 Q03 的说明性提问 —— 口径见 task.md
KEYWORD_TERMS = ["PARP", "BRCA", "卵巢癌"]
SIMILARITY_QUERY = "同源重组修复缺陷的肿瘤为什么对铂类药物和 PARP 抑制剂都敏感？"


# ---------------------------------------------------------------- 已给出：读数据 / SQL / 相似度零件


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8", newline="") as fh:
        return [dict(r) for r in csv.DictReader(fh)]


def load_all(case_dir: Path) -> dict:
    return {
        "genes": read_csv(case_dir / "genes.csv"),
        "variants": read_csv(case_dir / "variants.csv"),
        "drugs": read_csv(case_dir / "drugs.csv"),
        "trials": read_csv(case_dir / "trials.csv"),
        "passages": read_csv(case_dir / "passages.csv"),
        "edges": read_csv(case_dir / "edges.csv"),
        "questions": read_csv(case_dir / "questions.csv"),
    }


def build_sql(data: dict) -> sqlite3.Connection:
    """把结构化表装进内存 SQLite —— "精确事实"这一层就该用 SQL 查，而不是靠肉眼扫表。"""
    con = sqlite3.connect(":memory:")
    con.row_factory = sqlite3.Row
    con.executescript(
        """
        CREATE TABLE genes (gene_symbol TEXT PRIMARY KEY, full_name TEXT, chromosome TEXT);
        CREATE TABLE variants (variant_id TEXT PRIMARY KEY, gene_symbol TEXT, variant_type TEXT, clinical_significance TEXT);
        CREATE TABLE drugs (drug_name TEXT PRIMARY KEY, drug_class TEXT, target TEXT, approval_status TEXT);
        CREATE TABLE trials (trial_id TEXT PRIMARY KEY, drug_name TEXT, indication TEXT, phase TEXT, orr_pct REAL);
        """
    )
    for table, rows, cols in (
        ("genes", data["genes"], ("gene_symbol", "full_name", "chromosome")),
        (
            "variants",
            data["variants"],
            ("variant_id", "gene_symbol", "variant_type", "clinical_significance"),
        ),
        ("drugs", data["drugs"], ("drug_name", "drug_class", "target", "approval_status")),
        ("trials", data["trials"], ("trial_id", "drug_name", "indication", "phase", "orr_pct")),
    ):
        con.executemany(
            f"INSERT INTO {table} VALUES ({','.join('?' * len(cols))})",
            [tuple(r[c] for c in cols) for r in rows],
        )
    con.commit()
    return con


def query_trial(con: sqlite3.Connection, drug_name: str, phase: str | None = None):
    """按药名（可选分期）查试验：给药名 + 分期 → 精确挑出那一条。"""
    sql = "SELECT trial_id, drug_name, indication, phase, orr_pct FROM trials WHERE drug_name = ?"
    params: list[str] = [drug_name]
    if phase:
        sql += " AND phase = ?"
        params.append(phase)
    sql += " ORDER BY trial_id"
    return con.execute(sql, params).fetchall()


def char_bigrams(text: str) -> Counter:
    """口径：NFKC + 转小写 → **只保留字母与数字**（标点与空格全部删除）
    → 相邻两字符算一个 2-gram（中文不需要分词器）。"""
    compact = "".join(
        ch for ch in unicodedata.normalize("NFKC", text or "").lower() if ch.isalnum()
    )
    return Counter(compact[i : i + 2] for i in range(len(compact) - 1))


def cosine(a: Counter, b: Counter) -> float:
    if not a or not b:
        return 0.0
    dot = sum(v * b.get(k, 0) for k, v in a.items())
    na = math.sqrt(sum(v * v for v in a.values()))
    nb = math.sqrt(sum(v * v for v in b.values()))
    return 0.0 if na == 0 or nb == 0 else dot / (na * nb)


# ---------------------------------------------------------------- TODO ①：段落层两条路


def keyword_passages(passages: list[dict], terms: list[str]) -> list[str]:
    """返回**同时包含全部术语**（大小写不敏感的字面子串）的段落号，按段落号升序。

    TODO ①：就是"字面共现"——**每一个**术语都要在该段文本里原样出现（忽略大小写）。
    """
    raise NotImplementedError("TODO ①：实现 keyword_passages")


def rank_passages_by_similarity(passages: list[dict], query: str) -> list[tuple[str, float]]:
    """按字符 2-gram 余弦相似度降序；**并列按段落号升序**（口径钉死，结果唯一确定）。

    TODO ①：对每段算 `cosine(char_bigrams(query), char_bigrams(段文本))`，然后排序。
    """
    raise NotImplementedError("TODO ①：实现 rank_passages_by_similarity")


# ---------------------------------------------------------------- TODO ②：图谱层


def adjacency(edges: list[dict]) -> dict[str, list[tuple[str, str]]]:
    """`head → [(relation, tail), …]`（**有向**；同一节点的分支先按 (tail, relation) 排好序）。"""
    out: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for e in edges:
        out[e["head"]].append((e["relation"], e["tail"]))
    for head in out:
        out[head].sort()
    return out


def neighbors(edges: list[dict], head: str, relation: str) -> list[str]:
    """取某节点在某关系下的全部尾节点（按 ASCII 升序）——「这个类别里有哪些药」就靠它。

    TODO ②：注意 `head` 与 `relation` 都要匹配（边是有向的），结果去重后排序。
    """
    raise NotImplementedError("TODO ②：实现 neighbors")


def shortest_path(edges: list[dict], start: str, goal: str) -> list[str] | None:
    """有向 BFS 最短路径，返回 `["head|relation|tail", …]`；同长度多条时取**边序列最小**的那条。

    TODO ②：用 `adjacency(edges)` 做 BFS；路径里每一步都写成 `head|relation|tail`；
    同一节点有多条出边时按 `(tail, relation)` 排序后再入队（这样"边序列最小"才稳定）。
    """
    raise NotImplementedError("TODO ②：实现 shortest_path")


# ---------------------------------------------------------------- TODO ③：逐题路由


def answer_question(con: sqlite3.Connection, data: dict, q: dict) -> dict:
    """按问题性质选路，返回一道题的完整答案（`task.md` 的交付格式）。

    TODO ③：本实验的核心 —— 五个问题分别要：
      Q01 精确数字（oleparib 卵巢癌 **III 期**试验）→ SQL，注意要按分期筛；
      Q02 原文里**字面**同时出现 PARP / BRCA / 卵巢癌 的段落 → 关键词；
      Q03 问法里没有那段关键词、要按**相似度**找 → 向量（字符 2-gram 余弦）；
      Q04 关系链 + 类别成员（PARP 抑制剂包含哪些药）→ 图谱（多跳路径 + neighbors）；
      Q05 两跳组合：图谱取 niraparib 的获批适应证 + SQL 取它的试验数据。
    每题都要写 `route` / `answer`（≥10 字）/ `key_facts`（键名见 task.md 的表）/
    `sources`（kind + ref，多跳题附 `path`）/ `confidence`。
    """
    raise NotImplementedError("TODO ③：实现 answer_question（五题的路由）")


def plot_routes(route_counts: dict[str, int], fig_root: Path) -> list[dict]:
    """画"每种形态回答了几题"，返回 `[{"path", "takeaway"}]`。

    TODO ③：把 takeaway 换成一句话结论（数字要与 route_counts 自洽）。
    """
    fig_root.mkdir(parents=True, exist_ok=True)
    kinds = sorted(route_counts)
    counts = [route_counts[k] for k in kinds]
    fig, ax = plt.subplots(figsize=(6.0, 4.0))
    ax.bar(kinds, counts)
    ax.set_ylabel("number of questions")
    ax.set_title("Which knowledge form answered each question")
    fig.tight_layout()
    fig.savefig(fig_root / FIG_NAME, dpi=110)
    plt.close(fig)
    return [{"path": f"{FIG_DIR}/{FIG_NAME}", "takeaway": "TODO：用一句话说清这张图告诉了我们什么"}]


def compose_notes(data: dict, route_counts: dict[str, int], answers: list[dict]) -> str:
    """`notes`：≥60 字。TODO ③ —— 讲清路由理由、出处可溯源、四种形态的分工，
    以及至少一条真实局限（含「检索结果不是结论」这条坑）。"""
    raise NotImplementedError("TODO ③：实现 compose_notes")


# ---------------------------------------------------------------- 串起来（不用改）


def run_case(case_dir: Path, fig_root: Path | None = None) -> tuple[dict, dict]:
    data = load_all(case_dir)
    con = build_sql(data)

    answers = [answer_question(con, data, q) for q in data["questions"]]
    answers.sort(key=lambda a: a["question_id"])

    route_counts: dict[str, int] = defaultdict(int)
    for a in answers:
        route_counts[a["route"]] += 1
    route_counts = dict(route_counts)

    out = {
        "answers": answers,
        "route_counts": route_counts,
        "figures": plot_routes(route_counts, fig_root or Path(".")),
        "notes": compose_notes(data, route_counts, answers),
    }

    expected = {
        "n_questions": len(data["questions"]),
        "route_counts": route_counts,
        "answers": [
            {
                "question_id": a["question_id"],
                "route": a["route"],
                "key_facts": a["key_facts"],
                "sources_kinds": sorted(s["kind"] for s in a["sources"]),
                **({"path": a["sources"][0]["path"]} if a["sources"][0].get("path") else {}),
            }
            for a in answers
        ],
    }
    return out, expected


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("case_dir", help="case 目录（含七份数据文件）")
    ap.add_argument("out_path", help="输出 output.json 的路径")
    args = ap.parse_args()
    case_dir, out_path = Path(args.case_dir), Path(args.out_path)
    out, _ = run_case(case_dir, Path("."))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[ok] {case_dir.name} → {out_path}")


if __name__ == "__main__":
    main()
