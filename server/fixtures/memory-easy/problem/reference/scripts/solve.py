"""参考实现：记忆四操作（写入 / 检索 / 更新 / 遗忘），写 output.json + 一张图。

用法：python3 scripts/solve.py <case目录> <output.json> [--fig-dir figures]
"""
import argparse
import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

STATUSES = ["active", "superseded", "forgotten"]


def load_case(case_dir: Path):
    seed = json.loads((case_dir / "memory_seed.json").read_text(encoding="utf-8"))
    ops = [json.loads(line) for line in (case_dir / "ops.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
    return [dict(r) for r in seed], ops


def store(mem, item):
    mem.append(dict(item))


def update(mem, mid, fact):
    old = next((m for m in mem if m["id"] == mid), None)
    if old is None or old["status"] != "active":
        return  # 边界：只有 active 的条目才能被更新，否则跳过
    old["status"] = "superseded"
    mem.append({"id": mid + "v2", "patient": old["patient"], "fact": fact,
                "kind": old["kind"], "status": "active"})


def forget(mem, mid):
    for m in mem:
        if m["id"] == mid and m["status"] == "active":
            m["status"] = "forgotten"


def retrieve(mem, patient, kinds):
    hit = [m for m in mem if m["patient"] == patient and m["status"] == "active" and m["kind"] in kinds]
    return sorted(hit, key=lambda m: m["id"])


def plot(snapshots, fig_dir: Path) -> dict:
    fig_dir.mkdir(parents=True, exist_ok=True)
    steps = [s["step"] for s in snapshots]
    series = {st: [sum(1 for r in s["rows"] if r["status"] == st) for s in snapshots] for st in STATUSES}
    fig, ax = plt.subplots(figsize=(5.2, 3.6))
    bottom = [0] * len(steps)
    colors = {"active": "#4C78A8", "superseded": "#F58518", "forgotten": "#BAB0AC"}
    for st in STATUSES:
        ax.bar(steps, series[st], bottom=bottom, label=st, color=colors[st])
        bottom = [b + v for b, v in zip(bottom, series[st])]
    ax.set_xticks(steps)
    ax.set_xlabel("step")
    ax.set_ylabel("memories")
    ax.set_title("Memory status per step")
    ax.legend(fontsize=8)
    fig.tight_layout()
    fig.savefig(fig_dir / "status_per_step.png", dpi=110)
    plt.close(fig)
    last = snapshots[-1]
    return {
        "path": f"{fig_dir.as_posix()}/status_per_step.png",
        "takeaway": (
            f"最后一步表里 active {sum(1 for r in last['rows'] if r['status'] == 'active')} 条、"
            f"superseded {sum(1 for r in last['rows'] if r['status'] == 'superseded')} 条、"
            f"forgotten {sum(1 for r in last['rows'] if r['status'] == 'forgotten')} 条：更新是作废旧条而不是删掉它。"
        ),
    }


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
        "notes": (
            f"按 {len(ops)} 个操作逐步执行：写入只追加；更新是「旧条目作废 + 新条目顶上」（不是删掉旧行），"
            "所以 superseded 会一直留在表里；遗忘只处理 active 的条目；检索每次都要按 status=active 过滤，"
            "否则被更正和被遗忘的内容还会命中。最容易错的是三个边界：更新一条已经 superseded 的条目要跳过、"
            "遗忘一条已作废的条目不应把它改成 forgotten、以及检索排序要按 id 升序（M03v2 排在 M04 之前）。"
        ),
    }
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
