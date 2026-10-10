#!/usr/bin/env python3
"""实验三（知识图谱）的**起点骨架**：把你的实现写在标了 TODO 的地方。

结构与 `problem/reference/scripts/kg.py` 的函数划分一致 —— 先跑通它、读懂它的输出，
再回来填自己的 TODO。两处 TODO：

  ① `is_valid_triple` / `apply_updates` —— 本体校验 + 图更新（含"必须被拒绝"的非法更新）
  ② `find_contraindication_alerts` / `find_interaction_alerts` —— 两跳预警（每条都要带推理路径）

用法：
  python3 scripts/kg.py <case目录> <output.json>            # 单个 case（图写到当前目录的 figures/）
"""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import networkx as nx  # noqa: E402

USE = ("服用", "医嘱使用")  # 两种"患者在用药"的关系名，都算在用
CONTRA = "禁忌证"
INTERACTION = "相互作用"
FIG_DIR = Path("figures")


# ---------------------------------------------------------------- 读数据 + 建图（已给出）
def read_triples(case_dir: str | Path) -> list[dict]:
    with (Path(case_dir) / "triples.csv").open(encoding="utf-8", newline="") as fh:
        return [dict(r) for r in csv.DictReader(fh)]


def load_ontology(case_dir: str | Path) -> dict:
    return json.loads((Path(case_dir) / "ontology.json").read_text(encoding="utf-8"))


def build_graph(triples: list[dict]) -> nx.DiGraph:
    """③ 三元组 → 有向图：节点是实体，边带 `relation` 属性。"""
    graph = nx.DiGraph()
    for t in triples:
        graph.add_edge(t["head"], t["tail"], relation=t["relation"])
    return graph


def graph_stats(graph: nx.DiGraph, ontology: dict) -> dict:
    """图的规模与类型统计（类型取自本体映射；输出按名称升序 —— 结果要可复现）。"""
    types: dict[str, int] = {}
    for node in graph.nodes:
        t = ontology["entity_types"].get(node, "Unknown")
        types[t] = types.get(t, 0) + 1
    relations: dict[str, int] = {}
    for _, _, data in graph.edges(data=True):
        relations[data["relation"]] = relations.get(data["relation"], 0) + 1
    return {
        "n_nodes": graph.number_of_nodes(),
        "n_edges": graph.number_of_edges(),
        "entity_types": dict(sorted(types.items())),
        "relation_counts": dict(sorted(relations.items())),
    }


# ---------------------------------------------------------------- TODO ①：本体校验 + 图更新
def is_valid_triple(head: str, relation: str, tail: str, ontology: dict) -> bool:
    """本体校验：关系必须存在，且 head / tail 的类型要符合 `from` / `to`。

    口径（`task.md`「图更新口径」）：
        relation_schema[relation] = {"from": ..., "to": ...}
        合法 ⇔ entity_types[head] == from 且 entity_types[tail] == to

    最小示例：

        schema = ontology["relation_schema"].get(relation)
        if not schema:
            return False
        types = ontology["entity_types"]
        return types.get(head) == schema["from"] and types.get(tail) == schema["to"]
    """
    # TODO：实现本体校验
    raise NotImplementedError("TODO：实现 is_valid_triple")


def apply_updates(graph: nx.DiGraph, updates: dict, ontology: dict) -> dict:
    """⑤ 按更新单改图：**每条都要先过本体校验**，不合格的计入 `rejected_updates` 并跳过。

    口径：`add_triples`（加节点/边，新节点计入 `added_nodes`）、`remove_triples`（`removed_edges`）、
    `replace_triples`（删旧边加新边，`updated_edges`）、`invalid_triples`（**必须被拒绝**）。

    返回的键要有：`added_edges` / `added_nodes` / `removed_edges` / `updated_edges` /
    `rejected_updates` / `final_n_nodes` / `final_n_edges`。
    """
    # TODO：实现图更新（注意每条更新先过 is_valid_triple）
    raise NotImplementedError("TODO：实现 apply_updates")


# ---------------------------------------------------------------- TODO ②：两跳预警
def find_contraindication_alerts(graph: nx.DiGraph) -> list[dict]:
    """④ 禁忌证预警：患者患有某疾病，而他的用药对该疾病是禁忌。

    口径（`task.md`「预警口径」）：
      - "在用药" = 关系 `服用` 或 `医嘱使用`；
      - 判定：存在 `患者 -患有→ c` 且 `d -禁忌证→ c`，且 `患者 -服用→ d`；
      - `path` 固定为 `[[患者,"患有",c], [d,"禁忌证",c], [患者,"服用",d]]`；
      - 结果按 `(patient, drug)` 升序。

    每条预警形如：

        {"patient": "P001", "drug": "二甲双胍", "reason": "contraindication",
         "with": "严重肾功能不全", "path": [...]}

    最小示例（遍历一个节点的出边）：

        for _, disease, data in graph.out_edges(drug, data=True):
            if data["relation"] == CONTRA: ...
    """
    # TODO：实现禁忌证预警
    raise NotImplementedError("TODO：实现 find_contraindication_alerts")


def find_interaction_alerts(graph: nx.DiGraph) -> list[dict]:
    """④ 相互作用预警：患者同时在用两种互为相互作用的药。

    口径：
      - "在用药" = `服用` / `医嘱使用`；
      - 相互作用是**相互**的 → `a→b` 与 `b→a` 两个方向都要查；
      - `path` 用**图里实际存在的方向**：`[[患者,"服用",x], [x,"相互作用",y], [患者,"服用",y]]`；
      - 结果按 `(patient, drug, drug2)` 升序，`drug < drug2`（字符串升序）。
    """
    # TODO：实现相互作用预警
    raise NotImplementedError("TODO：实现 find_interaction_alerts")


def all_alerts(graph: nx.DiGraph) -> dict:
    """两类预警一起跑（更新前后各调用一次）。"""
    return {
        "contraindication": find_contraindication_alerts(graph),
        "interaction": find_interaction_alerts(graph),
    }


# ---------------------------------------------------------------- 已给出：画图 + 串联
def plot_alert_counts(before: dict, after: dict, fig_dir: Path = FIG_DIR) -> dict:
    """更新前后两类预警的数量对比（图上的文字用英文：容器里没有中文字体）。"""
    fig_dir.mkdir(parents=True, exist_ok=True)
    labels = ["contraindication", "interaction"]
    b = [len(before["contraindication"]), len(before["interaction"])]
    a = [len(after["contraindication"]), len(after["interaction"])]
    x = range(len(labels))
    fig, ax = plt.subplots(figsize=(7, 4))
    ax.bar([i - 0.2 for i in x], b, width=0.4, label="before update", color="#4C78A8")
    ax.bar([i + 0.2 for i in x], a, width=0.4, label="after update", color="#F58518")
    ax.set_xticks(list(x))
    ax.set_xticklabels(labels)
    ax.set_ylabel("number of alerts")
    ax.set_title("Medication alerts before vs after graph update")
    ax.legend()
    fig.tight_layout()
    path = fig_dir / "alert_counts.png"
    fig.savefig(path, dpi=110)
    plt.close(fig)
    takeaway = (
        f"更新前禁忌证预警 {b[0]} 条、相互作用预警 {b[1]} 条；更新后变成 {a[0]} 条与 {a[1]} 条。"
    )
    return {"path": str(path), "takeaway": takeaway}


def compose_notes(stats: dict, crud: dict, before: dict, after: dict) -> str:
    """⑥ 写结论：**这段最好你自己写** —— 为什么用图、被拒绝的更新错在哪、变化、局限。"""
    # TODO：把下面这句换成你自己的总结（判据要看你有没有说清可解释性、本体的作用与局限）
    return f"图里有 {stats['n_nodes']} 个实体、{stats['n_edges']} 条关系；更新前后预警数发生了变化。"


def build_report(case_dir: str | Path, fig_dir: Path = FIG_DIR) -> dict:
    ontology = load_ontology(case_dir)
    updates = json.loads((Path(case_dir) / "updates.json").read_text(encoding="utf-8"))

    graph = build_graph(read_triples(case_dir))
    stats = graph_stats(graph, ontology)
    before = all_alerts(graph)
    crud = apply_updates(graph, updates, ontology)
    after = all_alerts(graph)

    figures = [plot_alert_counts(before, after, fig_dir)]
    return {
        "graph": stats,
        "crud": crud,
        "alerts_before": before,
        "alerts_after": after,
        "figures": figures,
        "notes": compose_notes(stats, crud, before, after),
    }


def run_case(case_dir: str | Path, out_path: str | Path, fig_dir: Path = FIG_DIR) -> dict:
    report = build_report(case_dir, fig_dir)
    Path(out_path).write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return report


def main() -> None:
    ap = argparse.ArgumentParser(description="用药安全预警图谱（你的实现）")
    ap.add_argument("case_dir")
    ap.add_argument("out")
    args = ap.parse_args()
    report = run_case(args.case_dir, args.out)
    print(json.dumps({k: v for k, v in report.items() if k != "alerts_after"}, ensure_ascii=False))
    for fig in report["figures"]:
        print(f"  [图] {fig['path']} —— {fig['takeaway']}")


if __name__ == "__main__":
    main()
