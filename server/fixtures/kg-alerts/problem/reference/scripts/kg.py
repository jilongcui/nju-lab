#!/usr/bin/env python3
"""实验三（知识图谱）的参考实现（学习示范）：三元组 + 本体 + 更新单 → 图 + `output.json` + 一张图。

📖 这份实现**随题目包一起下发**（`problem/reference/`）—— 先读懂它，再写你自己的。
   **它不是唯一正确答案**：图怎么存（networkx / 自写邻接表 / 三元组表）、代码怎么分层都随你，
   判据只看"图统计与口径一致 + 预警清单与路径正确 + 更新（含被拒绝的）真的落到图上 + 说清可解释性"。

本实现走完**完整流程**（与 task.md 的六步对应）：
  ① 看清需求      —— 要回答的是"关系"问题：这个患者用的药，和他的病/别的药有没有冲突
  ② 回头看本体    —— `ontology.json`：实体类型 + 每种关系的端点类型（校验的依据）
  ③ 建图          —— `build_graph`：三元组 → 有向图
  ④ 多跳预警      —— `find_contraindication_alerts` / `find_interaction_alerts`（每步都留**推理路径**）
  ⑤ 图更新        —— `apply_updates`：补录 / 撤销 / 更正 / **违反本体的更新必须被拒绝**
  ⑥ 再看一次 + 结论 —— 更新后重跑预警（撤销应当让预警消失）+ 对比图 + `notes`

用法：
  python3 scripts/kg.py <case目录> <output.json>            # 单个 case（图写到当前目录的 figures/）
  python3 scripts/kg.py --regen-expected                    # 重算 problem/cases/*/expected.json

请在**与复验同一个镜像内**生成 expected（当前 pkg6）：

  docker run --rm -v "$PWD:/w" --entrypoint python3 \
    nju-lab-verify:0.2.0-rc.2-pkg6 /w/problem/reference/scripts/kg.py --regen-expected
"""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")  # 容器内无显示环境
import matplotlib.pyplot as plt  # noqa: E402
import networkx as nx  # noqa: E402

USE = ("服用", "医嘱使用")  # 两种"患者在用药"的关系名，都算在用
CONTRA = "禁忌证"
INTERACTION = "相互作用"
FIG_DIR = Path("figures")

HERE = Path(__file__).resolve().parent
CASES_DIR = HERE.parent.parent / "cases"


# ---------------------------------------------------------------- ②③ 建图
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
    """图的规模与类型统计（类型取自本体映射，输出按名称升序 —— 结果要可复现）。"""
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


def is_valid_triple(head: str, relation: str, tail: str, ontology: dict) -> bool:
    """② 本体校验：关系必须存在，且 head / tail 的类型要符合 `from` / `to`。"""
    schema = ontology["relation_schema"].get(relation)
    if not schema:
        return False
    types = ontology["entity_types"]
    return types.get(head) == schema["from"] and types.get(tail) == schema["to"]


# ---------------------------------------------------------------- ④ 多跳预警（带路径）
def _patients_used_drug(graph: nx.DiGraph) -> dict[str, list[str]]:
    """患者 → 在用药（`服用` / `医嘱使用` 都算）。"""
    out: dict[str, list[str]] = {}
    for head, tail, data in graph.edges(data=True):
        if data["relation"] in USE:
            out.setdefault(head, []).append(tail)
    return {p: sorted(set(d)) for p, d in out.items()}


def find_contraindication_alerts(graph: nx.DiGraph) -> list[dict]:
    """禁忌证预警：患者患有某疾病，而他的用药对该疾病是禁忌。

    两跳：`患者 -患有→ 疾病` 与 `药物 -禁忌证→ 疾病` 在同一个疾病上碰头；
    再把 `患者 -服用→ 药物` 这条边补上，就构成一条**完整的证据链**。
    """
    alerts = []
    patients_diseases: dict[str, list[str]] = {}
    for head, tail, data in graph.edges(data=True):
        if data["relation"] == "患有":
            patients_diseases.setdefault(head, []).append(tail)

    for patient, drugs in _patients_used_drug(graph).items():
        for drug in drugs:
            for _, disease, data in graph.out_edges(drug, data=True):
                if data["relation"] != CONTRA:
                    continue
                if disease in patients_diseases.get(patient, []):
                    alerts.append({
                        "patient": patient,
                        "drug": drug,
                        "reason": "contraindication",
                        "with": disease,
                        "path": [
                            [patient, "患有", disease],
                            [drug, CONTRA, disease],
                            [patient, "服用", drug],
                        ],
                    })
    alerts.sort(key=lambda a: (a["patient"], a["drug"]))
    return alerts


def find_interaction_alerts(graph: nx.DiGraph) -> list[dict]:
    """相互作用预警：患者同时在用两种互为相互作用的药（相互作用是**相互**的，两个方向都查）。"""
    alerts = []
    for patient, drugs in _patients_used_drug(graph).items():
        for i, a in enumerate(drugs):
            for b in drugs[i + 1:]:
                if graph.has_edge(a, b) and graph[a][b]["relation"] == INTERACTION:
                    alerts.append({
                        "patient": patient, "drug": a, "drug2": b, "reason": "interaction",
                        "path": [[patient, "服用", a], [a, INTERACTION, b], [patient, "服用", b]],
                    })
                elif graph.has_edge(b, a) and graph[b][a]["relation"] == INTERACTION:
                    alerts.append({
                        "patient": patient, "drug": a, "drug2": b, "reason": "interaction",
                        "path": [[patient, "服用", b], [b, INTERACTION, a], [patient, "服用", a]],
                    })
    alerts.sort(key=lambda a: (a["patient"], a["drug"], a["drug2"]))
    return alerts


def all_alerts(graph: nx.DiGraph) -> dict:
    return {
        "contraindication": find_contraindication_alerts(graph),
        "interaction": find_interaction_alerts(graph),
    }


# ---------------------------------------------------------------- ⑤ 图更新（含拒绝）
def apply_updates(graph: nx.DiGraph, updates: dict, ontology: dict) -> dict:
    """按更新单改图：**每条都要先过本体校验**，不合格的计入 `rejected_updates` 并跳过。"""
    added_edges = added_nodes = rejected = 0

    for t in updates.get("add_triples", []):
        if not is_valid_triple(t["head"], t["relation"], t["tail"], ontology):
            rejected += 1
            continue
        if t["head"] not in graph:
            graph.add_node(t["head"])
            added_nodes += 1
        if t["tail"] not in graph:
            graph.add_node(t["tail"])
            added_nodes += 1
        if not graph.has_edge(t["head"], t["tail"]):
            graph.add_edge(t["head"], t["tail"], relation=t["relation"])
            added_edges += 1

    removed = 0
    for t in updates.get("remove_triples", []):
        if graph.has_edge(t["head"], t["tail"]) and graph[t["head"]][t["tail"]]["relation"] == t["relation"]:
            graph.remove_edge(t["head"], t["tail"])
            removed += 1

    updated = 0
    for item in updates.get("replace_triples", []):
        old, new = item["old"], item["new"]
        if not is_valid_triple(new["head"], new["relation"], new["tail"], ontology):
            rejected += 1
            continue
        if graph.has_edge(old["head"], old["tail"]):
            graph.remove_edge(old["head"], old["tail"])
        if not graph.has_edge(new["head"], new["tail"]):
            graph.add_edge(new["head"], new["tail"], relation=new["relation"])
        updated += 1

    for t in updates.get("invalid_triples", []):
        if not is_valid_triple(t["head"], t["relation"], t["tail"], ontology):
            rejected += 1
        else:  # 本体上居然合法 → 说明造题/本体有问题，如实加进去而不是假装拒绝
            graph.add_edge(t["head"], t["tail"], relation=t["relation"])

    return {
        "added_edges": added_edges,
        "added_nodes": added_nodes,
        "removed_edges": removed,
        "updated_edges": updated,
        "rejected_updates": rejected,
        "final_n_nodes": graph.number_of_nodes(),
        "final_n_edges": graph.number_of_edges(),
    }


# ---------------------------------------------------------------- ⑥ 画图 + 结论
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
        f"更新前禁忌证预警 {b[0]} 条、相互作用预警 {b[1]} 条；补录新患者、撤销一条医嘱、更正一条关系之后，"
        f"变成 {a[0]} 条与 {a[1]} 条 —— 撤销医嘱会让对应预警消失，补录带冲突的患者会新增预警。"
    )
    return {"path": str(path), "takeaway": takeaway}


def compose_notes(stats: dict, crud: dict, before: dict, after: dict) -> str:
    """⑥ 写结论：为什么用图（多跳 + 可解释）→ 更新后变化 → 与 SQL 相比的取舍 → 不足。"""
    return (
        f"图里有 {stats['n_nodes']} 个实体、{stats['n_edges']} 条关系（药物知识 + 患者数据）。"
        f"两类预警都是**两跳**查询：禁忌证预警把「患者—患有—疾病」和「药物—禁忌证—疾病」"
        f"在同一个疾病上碰头，相互作用预警则在「患者在用的两味药」之间找边。"
        f"每条预警都能给出**完整的三元组路径**（患者 → 疾病 ← 药物 → 患者），"
        f"医生看到的不是一句「有风险」，而是「为什么有风险」 —— 这就是图谱在医疗场景的价值。"
        f"更新单执行后：新增 {crud['added_edges']} 条边（含 1 位新患者）、撤销 {crud['removed_edges']} 条、"
        f"更正 {crud['updated_edges']} 条，另有 {crud['rejected_updates']} 条更新被**本体校验拒绝**"
        f"（往「禁忌证」这种药物→疾病的关系上塞了一个患者节点）—— 本体在这里扮演了"
        f"关系数据库里 Schema 的角色。预警数从 禁忌 {len(before['contraindication'])} / 相互作用 "
        f"{len(before['interaction'])} 变成 {len(after['contraindication'])} / {len(after['interaction'])}："
        f"撤销医嘱的预警消失了，补录的患者带来了新预警。"
        f"不足：本体是手写的、覆盖有限；「过敏」这类关系没纳入预警规则；"
        f"真实临床还要叠加剂量、时间窗与循证等级，图谱只能给出可能性而不是结论。"
    )


def build_report(case_dir: str | Path, fig_dir: Path = FIG_DIR) -> dict:
    ontology = load_ontology(case_dir)
    updates = json.loads((Path(case_dir) / "updates.json").read_text(encoding="utf-8"))

    # ③ 建图（更新之前的状态）
    graph = build_graph(read_triples(case_dir))
    stats = graph_stats(graph, ontology)

    # ④ 多跳预警（带路径）
    before = all_alerts(graph)

    # ⑤ 图更新（含本体校验拒绝的）
    crud = apply_updates(graph, updates, ontology)

    # ⑥ 更新之后再看一次
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
                "参考水平（不是标准答案）：本体校验、预警口径、路径顺序都已在 task.md 里钉死，所以结果是确定的。"
                "这几项用于核对学生的建图/多跳查询/更新是否与口径一致。"
                "硬性判据见 manifest.json 的 assertions，语义判据见 judge.md。"
            ),
            "graph": report["graph"],
            "crud": report["crud"],
            "alerts_before": report["alerts_before"],
            "alerts_after": report["alerts_after"],
            "accept": {"min_path_length": 3},
        }
        out = case_dir / "expected.json"
        out.write_text(json.dumps(expected, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(
            f"[regen] {out.name}@{case_dir.name}: nodes={expected['graph']['n_nodes']} "
            f"edges={expected['graph']['n_edges']} "
            f"contra={len(expected['alerts_before']['contraindication'])}"
            f"→{len(expected['alerts_after']['contraindication'])} "
            f"inter={len(expected['alerts_before']['interaction'])}"
            f"→{len(expected['alerts_after']['interaction'])} "
            f"rejected={expected['crud']['rejected_updates']}"
        )


def main() -> None:
    ap = argparse.ArgumentParser(description="用药安全预警图谱的参考实现")
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
    print(json.dumps({k: v for k, v in report.items() if k != "alerts_after"}, ensure_ascii=False))
    for fig in report["figures"]:
        print(f"  [图] {fig['path']} —— {fig['takeaway']}")


if __name__ == "__main__":
    main()
