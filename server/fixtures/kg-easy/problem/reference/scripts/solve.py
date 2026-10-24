"""参考实现：用 networkx 建图 → 两条两跳查询 → 写 output.json + 一张图。

用法：python3 scripts/solve.py <case目录> <output.json> [--fig-dir figures]
"""
import argparse
import csv
import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import networkx as nx  # noqa: E402

PATIENT_RELATIONS = ("患有", "医嘱使用", "正在服用", "新开医嘱")


def build(case_dir: Path) -> nx.DiGraph:
    g = nx.DiGraph()
    with (case_dir / "triples.csv").open(encoding="utf-8") as f:
        for row in csv.DictReader(f):
            g.add_edge(row["head"], row["tail"], relation=row["relation"])
    return g


def succ(g: nx.DiGraph, node: str, relation: str) -> list[str]:
    return [t for t in g.successors(node) if g.edges[node, t]["relation"] == relation]


def forbidden_alerts(g: nx.DiGraph) -> list[dict]:
    """两跳①：患者患有某病 + 药对该病禁忌 + 医嘱用了该药。"""
    out = []
    for patient in sorted(n for n in g if n.startswith("P")):
        for drug in succ(g, patient, "医嘱使用"):
            for condition in succ(g, drug, "禁忌证"):
                if g.has_edge(patient, condition) and g.edges[patient, condition]["relation"] == "患有":
                    out.append({
                        "patient": patient,
                        "drug": drug,
                        "condition": condition,
                        "path": [f"{patient} -患有-> {condition}", f"{drug} -禁忌证-> {condition}"],
                    })
    out.sort(key=lambda a: (a["patient"], a["drug"]))
    return out


def interaction_alerts(g: nx.DiGraph) -> list[dict]:
    """两跳②：正在服用 A + A 与 B 相互作用 + 新开医嘱 B（risk 取 B 的不良反应）。"""
    out = []
    for patient in sorted(n for n in g if n.startswith("P")):
        for taken in succ(g, patient, "正在服用"):
            for new_drug in succ(g, taken, "相互作用"):
                if not (g.has_edge(patient, new_drug) and g.edges[patient, new_drug]["relation"] == "新开医嘱"):
                    continue
                risks = sorted(succ(g, new_drug, "不良反应"))
                risk = risks[0] if risks else ""
                path = [f"{patient} -正在服用-> {taken}", f"{taken} -相互作用-> {new_drug}"]
                if risk:
                    path.append(f"{new_drug} -不良反应-> {risk}")
                out.append({"patient": patient, "taken": taken, "new_drug": new_drug, "risk": risk, "path": path})
    out.sort(key=lambda a: (a["patient"], a["new_drug"]))
    return out


def plot(forbidden: list[dict], interactions: list[dict], fig_dir: Path) -> dict:
    """每个患者的预警条数（轴标签用英文：复验镜像没有中文字体）。"""
    fig_dir.mkdir(parents=True, exist_ok=True)
    counts: dict[str, int] = {}
    for a in forbidden + interactions:
        counts[a["patient"]] = counts.get(a["patient"], 0) + 1
    patients = sorted(counts)
    values = [counts[p] for p in patients]
    fig, ax = plt.subplots(figsize=(4.6, 3.4))
    ax.bar(patients, values, color="#E15759")
    ax.set_ylabel("alerts")
    ax.set_title("Alerts by patient")
    for i, v in enumerate(values):
        ax.text(i, v + 0.02, str(v), ha="center", fontsize=9)
    fig.tight_layout()
    fig.savefig(fig_dir / "alerts_by_patient.png", dpi=110)
    plt.close(fig)
    detail = "，".join(f"{p} {counts[p]} 条" for p in patients) or "无预警"
    return {
        "path": f"{fig_dir.as_posix()}/alerts_by_patient.png",
        "takeaway": f"共 {len(forbidden) + len(interactions)} 条预警：{detail}；两条查询都是沿两条边各走一步得到的。",
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("case_dir")
    ap.add_argument("out")
    ap.add_argument("--fig-dir", default="figures")
    a = ap.parse_args()

    g = build(Path(a.case_dir))
    forbidden = forbidden_alerts(g)
    interactions = interaction_alerts(g)
    fig = plot(forbidden, interactions, Path(a.fig_dir))
    out = {
        "graph": {"n_nodes": g.number_of_nodes(), "n_edges": g.number_of_edges()},
        "evaluation": {"forbidden": forbidden, "interactions": interactions},
        "figures": [fig],
        "notes": (
            f"把 {g.number_of_edges()} 条三元组用 networkx 加成有向边（边属性 relation）。"
            "禁忌证查询的判断条件是：患者「患有」的疾病，正好是该药「禁忌证」指向的疾病 —— "
            "两条边在同一个疾病上汇合，所以每条预警的 path 是 2 段。"
            "相互作用查询的判断条件是：患者「正在服用」的药 A 与「新开医嘱」的药 B 之间存在「相互作用」，"
            "所以 path 是 3 段（患者→药A、药A→药B、药B→不良反应），最后一段给出风险名称。"
            f"共得到 {len(forbidden)} 条禁忌证预警、{len(interactions)} 条相互作用预警；"
            "每条都带 path —— 医生能看到「因为哪条边所以报警」，这就是图谱在医疗场景的可解释性。"
        ),
    }
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
