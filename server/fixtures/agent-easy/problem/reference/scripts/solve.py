"""参考实现：四环随访助手（感知 → 决策 → 行动 → 记忆），写 output.json + 一张图。

用法：python3 scripts/solve.py <case目录> <output.json> [--fig-dir figures]
"""
import argparse
import csv
import json
from datetime import date
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

TODAY = date(2026, 10, 1)
ACTION_EN = {
    "urgent": "urgent",
    "recall": "recall",
    "annual": "annual",
    "none": "none",
    "unknown_patient": "unknown",
    "invalid_request": "invalid",
}


def load_case(case_dir: Path):
    with (case_dir / "patients.csv").open(encoding="utf-8") as f:
        patients = {r["patient_id"]: r for r in csv.DictReader(f)}
    requests = [line.strip() for line in (case_dir / "requests.txt").read_text(encoding="utf-8").splitlines() if line.strip()]
    seed = json.loads((case_dir / "memory_seed.json").read_text(encoding="utf-8"))
    return patients, requests, seed


def perceive(text: str) -> dict:
    pid = None
    for i in range(len(text) - 3):
        seg = text[i:i + 4]
        if seg[0] == "P" and seg[1:].isdigit():
            pid = seg
            break
    return {"pid": pid, "intent": "复查" if "复查" in text else "一般咨询"}


def decide(pid, patients, today: date):
    if pid is None:
        return "invalid_request", None
    if pid not in patients:
        return "unknown_patient", None
    p = patients[pid]
    days = (today - date.fromisoformat(p["last_visit"])).days
    hba1c = float(p["hba1c"])
    if hba1c >= 9.0:
        return "urgent", days
    if days >= 90 and hba1c >= 7.0:
        return "recall", days
    if days >= 180:
        return "annual", days
    return "none", days


def act(req_id, text, pid, action, patients, memory):
    if action == "invalid_request":
        return {"req_id": req_id, "text": f"[invalid_request] 请求里没有患者号：{text}"}
    if action == "unknown_patient":
        return {"req_id": req_id, "text": f"[unknown_patient] 未找到患者 {pid}"}
    p = patients[pid]
    last = memory.get(pid, {}).get("last_contact", "未联系")
    return {"req_id": req_id, "text": f"[{action}] {p['name']}：上次联系 {last}，HbA1c {float(p['hba1c'])}。"}


def plot(counts: dict, fig_dir: Path) -> dict:
    fig_dir.mkdir(parents=True, exist_ok=True)
    order = ["urgent", "recall", "annual", "none", "unknown_patient", "invalid_request"]
    keys = [k for k in order if k in counts]
    fig, ax = plt.subplots(figsize=(4.8, 3.6))
    ax.bar(range(len(keys)), [counts[k] for k in keys], color="#4C78A8")
    ax.set_xticks(range(len(keys)), [ACTION_EN.get(k, k) for k in keys], rotation=20)
    ax.set_ylabel("requests")
    ax.set_title("Actions per request")
    fig.tight_layout()
    fig.savefig(fig_dir / "actions.png", dpi=110)
    plt.close(fig)
    top = max(counts, key=counts.get)
    return {
        "path": f"{fig_dir.as_posix()}/actions.png",
        "takeaway": f"{top} 类动作最多（{counts[top]} 条）；六个动作类别一共覆盖了 {sum(counts.values())} 条请求。",
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("case_dir")
    ap.add_argument("out")
    ap.add_argument("--fig-dir", default="figures")
    a = ap.parse_args()

    case_dir = Path(a.case_dir)
    patients, requests, memory = load_case(case_dir)
    perceive_out, decisions, messages = [], [], []
    for i, text in enumerate(requests, 1):
        req_id = f"r{i}"
        pr = perceive(text)
        perceive_out.append({"req_id": req_id, "pid": pr["pid"], "intent": pr["intent"]})
        action, days = decide(pr["pid"], patients, TODAY)
        decisions.append({"req_id": req_id, "pid": pr["pid"], "action": action, "days_since_visit": days})
        messages.append(act(req_id, text, pr["pid"], action, patients, memory))
        if action not in ("invalid_request", "unknown_patient"):
            memory[pr["pid"]] = {"last_contact": TODAY.isoformat(), "last_action": action}
    counts = {}
    for d in decisions:
        counts[d["action"]] = counts.get(d["action"], 0) + 1

    out = {
        "perceive": perceive_out,
        "decisions": decisions,
        "messages": messages,
        "memory_after": memory,
        "counts": counts,
        "figures": [plot(counts, Path(a.fig_dir))],
        "notes": (
            f"逐条走了 {len(requests)} 个请求：感知只取第一个 P\\d{{3}} 子串，取不到就判 invalid_request；"
            "决策按六条规则的先后顺序落，先看患者号是否有效，再按 hba1c 和距上次复查的天数分档；"
            "行动严格照消息模板拼；记忆只写正常决策，无效请求和未知患者不写。"
            "最容易错的是记忆边界（把 unknown_patient 也写进记忆）和优先级顺序（hba1c 很高但刚复查过，"
            "仍应判 urgent 而不是 none）。案例里同一位患者出现两次时，第二次的\"上次联系\"会读到第一次写下的日期，"
            "这正是记忆在同一次运行内生效的证据。"
        ),
    }
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
