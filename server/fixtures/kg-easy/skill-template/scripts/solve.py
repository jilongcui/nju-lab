"""你的方案：用 networkx 把三元组建图 → 两条两跳查询 → 写 output.json + 一张图。

**代码里的 TODO 才是你要改的地方**（文档 `SKILL.md` 不用改）。
用法：python3 scripts/solve.py <case目录> <output.json> [--fig-dir figures]
"""
import argparse
import csv
import json
from pathlib import Path

import networkx as nx


def build(case_dir: Path) -> nx.DiGraph:
    g = nx.DiGraph()
    with (case_dir / "triples.csv").open(encoding="utf-8") as f:
        for row in csv.DictReader(f):
            # TODO: 把每条三元组加成一条有向边，边属性名用 relation
            raise NotImplementedError
    return g


def forbidden_alerts(g: nx.DiGraph) -> list[dict]:
    # TODO: 两跳① —— 患者 -患有-> 病，且该药 -禁忌证-> 同一病，且患者 -医嘱使用-> 该药
    #   每条预警带 path：["<患者> -患有-> <病>", "<药> -禁忌证-> <病>"]
    return []


def interaction_alerts(g: nx.DiGraph) -> list[dict]:
    # TODO: 两跳② —— 患者 -正在服用-> A，A -相互作用-> B，患者 -新开医嘱-> B
    #   risk 取 B 的「不良反应」（字典序第一条，没有就 ""）；path 2~3 段
    return []


def plot(forbidden: list[dict], interactions: list[dict], fig_dir: Path) -> dict:
    # TODO: 画每个患者的预警条数（轴标签用英文：复验镜像没有中文字体）
    fig_dir.mkdir(parents=True, exist_ok=True)
    return {"path": f"{fig_dir.as_posix()}/alerts_by_patient.png", "takeaway": ""}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("case_dir")
    ap.add_argument("out")
    ap.add_argument("--fig-dir", default="figures")
    a = ap.parse_args()

    g = build(Path(a.case_dir))
    forbidden = forbidden_alerts(g)
    interactions = interaction_alerts(g)
    out = {
        "graph": {"n_nodes": g.number_of_nodes(), "n_edges": g.number_of_edges()},
        "evaluation": {"forbidden": forbidden, "interactions": interactions},
        "figures": [plot(forbidden, interactions, Path(a.fig_dir))],
        "notes": "",
    }
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
