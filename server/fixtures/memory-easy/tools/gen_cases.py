"""造 case01 / case02 的记忆种子与操作序列，并标定 expected.json（可重跑；不下发）。

口径（与 problem/task.md 一致）：
  · store：追加一条，id 由输入给出
  · update：旧条目 status→superseded，新条目 id=<旧id>v2、patient/kind 沿用；**旧条目不是 active 就跳过**
  · forget：只把 active 改成 forgotten；非 active 不动
  · retrieve：patient 匹配 + status=active + kind 命中，按 id 升序；未知患者返回空数组
"""
import json
from pathlib import Path

CASES = {
    "case01": {
        "seed": [
            {"id": "M01", "patient": "P001", "fact": "HbA1c 8.2%，超标", "kind": "检验", "status": "active"},
            {"id": "M02", "patient": "P001", "fact": "磺胺类药物过敏", "kind": "过敏", "status": "active"},
            {"id": "M03", "patient": "P001", "fact": "在用二甲双胍 0.5g bid", "kind": "用药", "status": "active"},
            {"id": "M04", "patient": "P001", "fact": "主诉胃胀 2 周", "kind": "症状", "status": "active"},
            {"id": "M05", "patient": "P002", "fact": "在用达格列净 10mg qd", "kind": "用药", "status": "active"},
        ],
        "ops": [
            {"op": "store", "item": {"id": "M06", "patient": "P001", "fact": "低血糖发作一次（3.1 mmol/L）", "kind": "症状", "status": "active"}},
            {"op": "retrieve", "patient": "P001", "kinds": ["过敏", "用药"]},
            {"op": "update", "id": "M03", "fact": "二甲双胍已停用，改达格列净 10mg qd"},
            {"op": "retrieve", "patient": "P001", "kinds": ["用药"]},
            {"op": "forget", "id": "M02"},
            {"op": "retrieve", "patient": "P001", "kinds": ["过敏", "用药"]},
        ],
    },
    "case02": {
        "seed": [
            {"id": "M01", "patient": "P003", "fact": "HbA1c 7.8%", "kind": "检验", "status": "active"},
            {"id": "M02", "patient": "P003", "fact": "青霉素过敏（旧记录）", "kind": "过敏", "status": "superseded"},
            {"id": "M03", "patient": "P003", "fact": "在用格列美脲 2mg qd", "kind": "用药", "status": "active"},
            {"id": "M04", "patient": "P003", "fact": "主诉夜尿增多", "kind": "症状", "status": "active"},
        ],
        "ops": [
            {"op": "update", "id": "M02", "fact": "青霉素过敏（已复核确认）"},
            {"op": "forget", "id": "M02"},
            {"op": "retrieve", "patient": "P003", "kinds": ["过敏"]},
            {"op": "retrieve", "patient": "P999", "kinds": ["过敏"]},
            {"op": "store", "item": {"id": "M05", "patient": "P003", "fact": "近期体重下降 3kg", "kind": "症状", "status": "active"}},
            {"op": "update", "id": "M01", "fact": "HbA1c 7.2%（复查）"},
        ],
    },
}


def run(case):
    mem = [dict(r) for r in case["seed"]]
    snapshots, retrievals = [], []
    for step, op in enumerate(case["ops"], 1):
        kind = op["op"]
        if kind == "store":
            mem.append(dict(op["item"]))
        elif kind == "update":
            old = next((m for m in mem if m["id"] == op["id"]), None)
            if old and old["status"] == "active":
                old["status"] = "superseded"
                mem.append({"id": op["id"] + "v2", "patient": old["patient"],
                            "fact": op["fact"], "kind": old["kind"], "status": "active"})
        elif kind == "forget":
            for m in mem:
                if m["id"] == op["id"] and m["status"] == "active":
                    m["status"] = "forgotten"
        elif kind == "retrieve":
            hit = sorted((m for m in mem if m["patient"] == op["patient"]
                          and m["status"] == "active" and m["kind"] in op["kinds"]),
                         key=lambda m: m["id"])
            retrievals.append({"op_id": f"o{step}", "patient": op["patient"],
                               "kinds": list(op["kinds"]), "ids": [m["id"] for m in hit]})
        snapshots.append({"step": step, "op": kind,
                          "rows": [{"id": m["id"], "status": m["status"]} for m in mem]})
    counts = {"active": 0, "superseded": 0, "forgotten": 0}
    for m in mem:
        counts[m["status"]] = counts.get(m["status"], 0) + 1
    return {"n_ops": len(case["ops"]), "snapshots": snapshots,
            "retrievals": retrievals, "final": {"counts": counts, "rows": mem}}


def main():
    root = Path(__file__).resolve().parent.parent / "problem" / "cases"
    for name, case in CASES.items():
        d = root / name
        d.mkdir(parents=True, exist_ok=True)
        (d / "memory_seed.json").write_text(json.dumps(case["seed"], ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        (d / "ops.jsonl").write_text("".join(json.dumps(o, ensure_ascii=False) + "\n" for o in case["ops"]), encoding="utf-8")
        (d / "expected.json").write_text(json.dumps({k: run(case)[k] for k in ("snapshots", "retrievals", "final")},
                                                    ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print("写出", name)


if __name__ == "__main__":
    main()
