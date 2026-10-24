"""造题 + 生成参考值（**不下发**）：知识图谱的两跳用药预警（禁忌证 / 相互作用）。

固定数据，可重跑。运行：python3 tools/gen_cases.py
"""
import csv
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
CASES = HERE / "problem" / "cases"
HEADER = ["head", "relation", "tail"]

TRIPLES = {
    "case01": [
        # 药物知识（三元组）
        ("2型糖尿病", "一线用药", "二甲双胍"),
        ("二甲双胍", "禁忌证", "严重肾功能不全"),
        ("高血压", "一线用药", "氨氯地平"),
        ("氨氯地平", "禁忌证", "严重低血压"),
        ("高脂血症", "一线用药", "辛伐他汀"),
        ("辛伐他汀", "禁忌证", "活动性肝病"),
        ("华法林", "相互作用", "阿司匹林"),
        ("阿司匹林", "不良反应", "消化道出血"),
        ("辛伐他汀", "相互作用", "克拉霉素"),
        ("克拉霉素", "不良反应", "QT间期延长"),
        # 患者事实
        ("P001", "患有", "严重肾功能不全"),
        ("P001", "医嘱使用", "二甲双胍"),
        ("P001", "正在服用", "华法林"),
        ("P001", "新开医嘱", "阿司匹林"),
        ("P002", "患有", "高血压"),
        ("P002", "医嘱使用", "氨氯地平"),
        ("P002", "正在服用", "辛伐他汀"),
        ("P002", "新开医嘱", "克拉霉素"),
    ],
    "case02": [
        ("2型糖尿病", "一线用药", "二甲双胍"),
        ("二甲双胍", "禁忌证", "严重肾功能不全"),
        ("痛风", "一线用药", "别嘌醇"),
        ("别嘌醇", "禁忌证", "严重肝功能不全"),
        ("抑郁障碍", "一线用药", "舍曲林"),
        ("舍曲林", "相互作用", "曲马多"),
        ("曲马多", "不良反应", "5-羟色胺综合征"),
        ("华法林", "相互作用", "布洛芬"),
        ("布洛芬", "不良反应", "消化道出血"),
        ("P003", "患有", "严重肾功能不全"),
        ("P003", "医嘱使用", "二甲双胍"),
        ("P003", "患有", "痛风"),
        ("P003", "医嘱使用", "别嘌醇"),
        ("P003", "正在服用", "舍曲林"),
        ("P003", "新开医嘱", "曲马多"),
        ("P004", "患有", "抑郁障碍"),
        ("P004", "正在服用", "华法林"),
        ("P004", "新开医嘱", "布洛芬"),
    ],
}


def expected_for(triples):
    """两跳查询的参考结果（口径见 task.md）。"""
    rel = {}
    for h, r, t in triples:
        rel[(h, t)] = r
    out_from = {}
    for (h, t), r in rel.items():
        out_from.setdefault(h, []).append((t, r))

    def succ(node, relation):
        return [t for t, r in out_from.get(node, []) if r == relation]

    forbidden, interactions = [], []
    for p in sorted({h for h, _, _ in triples if h.startswith("P")}):
        for drug in succ(p, "医嘱使用"):
            for cond in succ(drug, "禁忌证"):
                if rel.get((p, cond)) == "患有":
                    forbidden.append({
                        "patient": p, "drug": drug, "condition": cond,
                        "path": [f"{p} -患有-> {cond}", f"{drug} -禁忌证-> {cond}"],
                    })
        for taken in succ(p, "正在服用"):
            for new_drug in succ(taken, "相互作用"):
                if rel.get((p, new_drug)) == "新开医嘱":
                    risks = sorted(succ(new_drug, "不良反应"))
                    risk = risks[0] if risks else ""
                    path = [f"{p} -正在服用-> {taken}", f"{taken} -相互作用-> {new_drug}"]
                    if risk:
                        path.append(f"{new_drug} -不良反应-> {risk}")
                    interactions.append({"patient": p, "taken": taken, "new_drug": new_drug, "risk": risk, "path": path})

    forbidden.sort(key=lambda a: (a["patient"], a["drug"]))
    interactions.sort(key=lambda a: (a["patient"], a["new_drug"]))
    nodes = {h for h, _, _ in triples} | {t for _, _, t in triples}
    return {
        "graph": {"n_nodes": len(nodes), "n_edges": len(triples)},
        "evaluation": {"forbidden": forbidden, "interactions": interactions},
    }


def main():
    for name, triples in TRIPLES.items():
        case = CASES / name
        case.mkdir(parents=True, exist_ok=True)
        with (case / "triples.csv").open("w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(HEADER)
            w.writerows(triples)
        (case / "expected.json").write_text(
            json.dumps(expected_for(triples), ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        print(f"{name}: {len(triples)} 条三元组")


if __name__ == "__main__":
    main()
