"""你的方案：记忆四操作（写入 / 检索 / 更新 / 遗忘），写 output.json + 一张图。

**代码里的 TODO 才是你要改的地方**（文档 `SKILL.md` 不用改）。
用法：python3 scripts/solve.py <case目录> <output.json> [--fig-dir figures]
"""
import argparse
import json
from pathlib import Path

STATUSES = ["active", "superseded", "forgotten"]


def load_case(case_dir: Path):
    seed = json.loads((case_dir / "memory_seed.json").read_text(encoding="utf-8"))
    ops = [json.loads(line) for line in (case_dir / "ops.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
    return [dict(r) for r in seed], ops


def store(mem, item):
    # TODO: 追加一条（不要覆盖任何旧条目）
    pass


def update(mem, mid, fact):
    # TODO: 旧条目必须是 active：改成 superseded，再追加 {id: mid + "v2", ...}
    #       不是 active 就跳过（不要产生 v2 条目）
    pass


def forget(mem, mid):
    # TODO: 只把 active 的改成 forgotten
    pass


def retrieve(mem, patient, kinds):
    # TODO: patient 匹配 + status == "active" + kind 命中，按 id 升序
    return []


def plot(snapshots, fig_dir: Path) -> dict:
    # TODO: 画每步三种状态的堆叠柱状图；轴标签用英文（复验镜像没有中文字体），中文写进 takeaway
    fig_dir.mkdir(parents=True, exist_ok=True)
    return {"path": f"{fig_dir.as_posix()}/status_per_step.png", "takeaway": ""}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("case_dir")
    ap.add_argument("out")
    ap.add_argument("--fig-dir", default="figures")
    a = ap.parse_args()

    mem, ops = load_case(Path(a.case_dir))
    snapshots, retrievals = [], []
    for step, op in enumerate(ops, 1):
        kind = op["op"]
        if kind == "store":
            store(mem, op["item"])
        elif kind == "update":
            update(mem, op["id"], op["fact"])
        elif kind == "forget":
            forget(mem, op["id"])
        elif kind == "retrieve":
            hit = retrieve(mem, op["patient"], op["kinds"])
            retrievals.append({"op_id": f"o{step}", "patient": op["patient"],
                               "kinds": list(op["kinds"]), "ids": [m["id"] for m in hit]})
        snapshots.append({"step": step, "op": kind,
                          "rows": [{"id": m["id"], "status": m["status"]} for m in mem]})

    counts = {st: sum(1 for m in mem if m["status"] == st) for st in STATUSES}
    out = {
        "snapshots": snapshots,
        "retrievals": retrievals,
        "final": {"counts": counts, "rows": mem},
        "figures": [plot(snapshots, Path(a.fig_dir))],
        "notes": "",
    }
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
