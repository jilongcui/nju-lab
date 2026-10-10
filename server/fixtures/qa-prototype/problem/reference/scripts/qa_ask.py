#!/usr/bin/env python3
"""第 9 章（综合实践）参考实现：把四种知识形态串成一个最小问答原型。

📖 这份实现**随题目包一起下发**（`problem/reference/`）—— 先读懂它，再写你自己的。
   **它不是唯一正确答案**：代码怎么组织随你；判据只看"每个问题走对了路没有、关键事实对不对、
   出处有没有带出来、说得清为什么这么走"。

四形态各就各位（对应课程第 5~8 章）：

| 形态 | 在本实现里 | 回答什么 |
|---|---|---|
| 关系库（SQL） | `sql_or_*` / `query_trial`（`sqlite3` 内存库） | 精确事实与统计（分期、客观缓解率） |
| 文本关键词 | `keyword_passages`（术语**字面**共现） | "原文里直接提到这几个概念"的段落 |
| 向量相似（字符 2-gram 余弦） | `rank_passages_by_similarity` | "换了说法"但仍指同一件事的段落 |
| 知识图谱（多跳） | `shortest_path` / `neighbors`（有向 BFS） | 关系链推理与可解释证据链 |

**每个答案都必须带出处**（`sources`）：检索结果不是结论，出处才是能核查的东西 ——
这是本章「常见坑」里最要命的一条。

流程（与 task.md 的六步一致）：

  ① 看清需求      —— 每个问题要的是"精确数字 / 原文段落 / 意思相近的段落 / 推理链"中的哪一种
  ② 摸清材料      —— `load_all`：五张表 + 段落 + 关系边
  ③ 搭四个入口    —— `build_sql` / `keyword_passages` / `rank_passages_by_similarity` / `shortest_path`
  ④ 逐题路由      —— `answer_question`：选路、取事实、发问出处
  ⑤ 汇总与画图    —— `route_counts` + `plot_routes`
  ⑥ 写结论        —— `compose_notes`（含"检索结果不是结论"这条坑）

用法：

  python3 scripts/qa_ask.py <case目录> <output.json>     # 单个 case（图写到当前目录的 figures/）
  python3 scripts/qa_ask.py --regen-expected             # 重算 problem/cases/*/expected.json

请在**与复验同一个镜像内**生成 expected（当前 pkg6）：

  docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/w" --entrypoint python3 \
    nju-lab-verify:0.2.0-rc.2-pkg6 /w/problem/reference/scripts/qa_ask.py --regen-expected
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import sqlite3
import tempfile
import unicodedata
from collections import Counter, defaultdict, deque
from pathlib import Path

import matplotlib

matplotlib.use("Agg")  # 容器内无显示环境
import matplotlib.pyplot as plt  # noqa: E402

HERE = Path(__file__).resolve().parent
CASES_DIR = HERE.parent.parent / "cases"
FIG_DIR = Path("figures")
FIG_NAME = "route_counts.png"

# Q02 的字面术语（题面里三个概念：PARP 抑制剂 / BRCA 突变 / 卵巢癌）
KEYWORD_TERMS = ["PARP", "BRCA", "卵巢癌"]
# Q03 的说明性提问（要按"相似度"找段落，不是按字面共现）
SIMILARITY_QUERY = "同源重组修复缺陷的肿瘤为什么对铂类药物和 PARP 抑制剂都敏感？"


# ---------- ② 摸清材料 ----------


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


# ---------- ③ 入口一：关系库（SQL） ----------


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


def query_trial(con: sqlite3.Connection, drug_name: str, phase: str | None = None) -> list[sqlite3.Row]:
    """按药名（可选分期）查试验：给药名 + 分期 → 精确挑出那一条。"""
    sql = "SELECT trial_id, drug_name, indication, phase, orr_pct FROM trials WHERE drug_name = ?"
    params: list[str] = [drug_name]
    if phase:
        sql += " AND phase = ?"
        params.append(phase)
    sql += " ORDER BY trial_id"
    return con.execute(sql, params).fetchall()


# ---------- ③ 入口二：关键词（字面共现） ----------


def keyword_passages(passages: list[dict], terms: list[str]) -> list[str]:
    """返回**同时包含全部术语**（大小写不敏感的字面子串）的段落号，按段落号升序。

    这就是本章说的"搜得到字面"：它只认字面，所以换个说法（第 3 题）就搜不到了。
    """
    hits: list[str] = []
    for p in passages:
        text = p["text"].lower()
        if all(t.lower() in text for t in terms):
            hits.append(p["passage_id"])
    return sorted(hits)


# ---------- ③ 入口三：向量相似（字符 2-gram 余弦） ----------


def char_bigrams(text: str) -> Counter:
    """口径：NFKC + 转小写 → **只保留字母与数字**（`str.isalnum()`，标点与空格全部删除）
    → 相邻两字符算一个 2-gram。中文不需要分词器，字符 2-gram 对中英文都成立。"""
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


def rank_passages_by_similarity(passages: list[dict], query: str) -> list[tuple[str, float]]:
    """按字符 2-gram 余弦相似度降序；并列按段落号升序（口径写死，结果唯一确定）。"""
    q = char_bigrams(query)
    scored = [(p["passage_id"], cosine(q, char_bigrams(p["text"]))) for p in passages]
    return sorted(scored, key=lambda kv: (-kv[1], kv[0]))


# ---------- ③ 入口四：知识图谱（多跳） ----------


def adjacency(edges: list[dict]) -> dict[str, list[tuple[str, str]]]:
    out: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for e in edges:
        out[e["head"]].append((e["relation"], e["tail"]))
    for head in out:
        out[head].sort()
    return out


def neighbors(edges: list[dict], head: str, relation: str) -> list[str]:
    """取某节点在某关系下的全部尾节点（按 ASCII 升序）——"这个类别里有哪些药"就靠它。"""
    tails = [e["tail"] for e in edges if e["head"] == head and e["relation"] == relation]
    return sorted(set(tails))


def shortest_path(edges: list[dict], start: str, goal: str) -> list[str] | None:
    """有向 BFS 最短路径，返回 `["head|relation|tail", …]`；同长度多条时取**边序列最小**的那条。"""
    adj = adjacency(edges)
    queue: deque[tuple[str, list[str]]] = deque([(start, [])])
    seen = {start}
    while queue:
        node, path = queue.popleft()
        if node == goal:
            return path
        branches = sorted(adj.get(node, []), key=lambda rt: (rt[1], rt[0]))
        for relation, nxt in branches:
            if nxt in seen:
                continue
            seen.add(nxt)
            queue.append((nxt, path + [f"{node}|{relation}|{nxt}"]))
    return None


# ---------- ④ 逐题路由 ----------


def answer_question(con: sqlite3.Connection, data: dict, q: dict) -> dict:
    """按问题性质选路 —— 一次只走一条主路，需要两跳时把第二条路也记进 `sources`。"""
    qid = q["question_id"]
    passages = data["passages"]
    edges = data["edges"]

    if qid == "Q01":
        rows = [r for r in query_trial(con, "olaparib") if r["indication"] == "卵巢癌"]
        phase3 = [r for r in rows if r["phase"] == "III"]
        trial = phase3[0]
        return {
            "question_id": qid,
            "route": "sql",
            "answer": (
                f"奥拉帕利在卵巢癌的 III 期试验是 {trial['trial_id']}，客观缓解率 {trial['orr_pct']}%。"
                "（同药在 II 期试验里另有较低的结果，所以要按分期筛，不能只看药名。）"
            ),
            "key_facts": {
                "trial_id": trial["trial_id"],
                "phase": trial["phase"],
                "orr_pct": trial["orr_pct"],
            },
            "sources": [{"kind": "sql", "ref": f"trials:{trial['trial_id']}"}],
            "confidence": 0.95,
        }

    if qid == "Q02":
        hits = keyword_passages(passages, KEYWORD_TERMS)
        return {
            "question_id": qid,
            "route": "keyword",
            "answer": (
                f"是 {hits[0]}：它是唯一一段同时**字面**出现「PARP」「BRCA」「卵巢癌」三个概念的推荐段落。"
                "这类问题靠倒排索引/关键词就能解决，代价是换个说法就搜不到。"
            ),
            "key_facts": {"passage_ids": hits},
            "sources": [{"kind": "keyword", "ref": f"passages:{pid}"} for pid in hits],
            "confidence": 0.9,
        }

    if qid == "Q03":
        ranked = rank_passages_by_similarity(passages, SIMILARITY_QUERY)
        top = ranked[0][0]
        return {
            "question_id": qid,
            "route": "vector",
            "answer": (
                f"是 {top}：这一段讲了同源重组修复缺陷与铂类 / PARP 抑制剂敏感性（合成致死）。"
                "问题里没有出现这一段的关键词，所以要按相似度找 —— 但它仍然只是**字面相似**的近似，"
                "换成真正的语义改写就要靠向量模型了。"
            ),
            "key_facts": {"passage_ids": [top]},
            "sources": [{"kind": "vector", "ref": f"passages:{top}"}],
            "confidence": 0.8,
        }

    if qid == "Q04":
        path = shortest_path(edges, "BRCA1", "olaparib") or []
        drugs = neighbors(edges, "PARP抑制剂", "includes")
        return {
            "question_id": qid,
            "route": "graph",
            "answer": (
                "推理链：" + " → ".join(path) + "。"
                f"即 BRCA1 功能缺失 → 同源重组修复缺陷 → 与 PARP 抑制剂合成致死 → 该类药包含 {('、'.join(drugs))}。"
                "这条链能一步步核查，这正是图谱比「检索结果」强的地方。"
            ),
            "key_facts": {"drugs": drugs, "hops": len(path)},
            "sources": [{"kind": "graph", "ref": "edges:BRCA1->olaparib", "path": path}],
            "confidence": 0.85,
        }

    # Q05：图谱取"获批适应证"，再用 SQL 取试验数据（两跳组合）
    approvals = neighbors(edges, "niraparib", "approved_for")
    rows = query_trial(con, "niraparib")
    trial = rows[0]
    return {
        "question_id": qid,
        "route": "graph",
        "answer": (
            f"尼拉帕利获批用于{('、'.join(approvals))}；它的临床试验是 {trial['trial_id']}"
            f"（{trial['phase']} 期，{trial['indication']}），客观缓解率 {trial['orr_pct']}%。"
            "这一题要两跳：先在图谱里拿到适应证，再到关系库里取试验数据。"
        ),
        "key_facts": {
            "indication": approvals[0],
            "trial_id": trial["trial_id"],
            "orr_pct": trial["orr_pct"],
        },
        "sources": [
            {"kind": "graph", "ref": "edges:niraparib->approved_for"},
            {"kind": "sql", "ref": f"trials:{trial['trial_id']}"},
        ],
        "confidence": 0.8,
    }


# ---------- ⑤ 汇总与画图 ----------


def plot_routes(route_counts: dict[str, int], fig_root: Path) -> list[dict]:
    fig_root.mkdir(parents=True, exist_ok=True)
    kinds = sorted(route_counts)
    counts = [route_counts[k] for k in kinds]
    colors = {"sql": "#1565c0", "keyword": "#ef6c00", "vector": "#6a1b9a", "graph": "#2e7d32"}

    fig, ax = plt.subplots(figsize=(6.0, 4.0))
    ax.bar(kinds, counts, color=[colors.get(k, "#9e9e9e") for k in kinds])
    ax.set_ylabel("number of questions")
    ax.set_title("Which knowledge form answered each question")
    for i, c in enumerate(counts):
        ax.text(i, c + 0.05, str(c), ha="center", fontsize=9)
    fig.tight_layout()
    fig.savefig(fig_root / FIG_NAME, dpi=110)
    plt.close(fig)

    detail = "、".join(f"{k} {route_counts[k]} 题" for k in kinds)
    return [
        {
            "path": f"{FIG_DIR}/{FIG_NAME}",
            "takeaway": (
                f"五个问题一共用了四种形态：{detail}；图谱被用了两次（一次纯多跳、一次"
                "「图谱取适应证 + SQL 取试验数据」的组合）。没有哪一种形态能单独回答全部问题。"
            ),
        }
    ]


# ---------- ⑥ 结论 ----------


def compose_notes(data: dict, route_counts: dict[str, int], answers: list[dict]) -> str:
    detail = "、".join(f"{k} {route_counts[k]} 题" for k in sorted(route_counts))
    return (
        f"口径与做法：五张结构化表装进内存 SQLite（精确事实走 SQL）；段落层做两种检索 —— "
        f"关键词是**字面术语共现**（{'、'.join(KEYWORD_TERMS)} 同时出现），相似度是**字符 2-gram 余弦**"
        "（NFKC + 只留字母数字 + 相邻两字符，中文不需要分词器）；关系层是有向边表 + BFS 最短路径，"
        f"每条路径写成 head|relation|tail 的三元组链。五个问题的路由分布：{detail}。"
        "四种形态各管一段：关系库负责精确与统计，文本负责原文出处，向量负责「换了说法」的近似匹配，"
        "图谱负责关系链与可解释性。**每个答案都带了 sources**（表名:主键 或 边:head->relation->tail）"
        "—— 检索结果只是线索，出处才能核查，这是本章最要命的那个坑：把检索结果直接当结论。"
        "局限：语料是虚构的小规模数据，段落检索用字符 2-gram 只能近似「语义」（真正的向量模型本环境装不了、"
        "也不联网）；图谱只覆盖了手工录入的关系，缺关系时会回落不到任何答案；答案本身由这几层结果拼成，"
        "没有接大模型做生成（课程后面的 RAG 章节再补这一环）。"
    )


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
        "note": (
            "参考水平（不是标准答案）：路由、关键事实与出处都已经确定 —— 用于核对学生的方案"
            "有没有「每个问题走对路」「事实取对」「出处带出来」。硬性判据见 manifest.json 的 assertions，"
            "语义判据见 judge.md。"
        ),
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
