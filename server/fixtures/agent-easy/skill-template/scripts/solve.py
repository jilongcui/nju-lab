"""你的方案：四环随访助手（感知 → 决策 → 行动 → 记忆），写 output.json + 一张图。

**代码里的 TODO 才是你要改的地方**（文档 `SKILL.md` 不用改）。
用法：python3 scripts/solve.py <case目录> <output.json> [--fig-dir figures]
"""
import argparse
import csv
import json
from datetime import date
from pathlib import Path

TODAY = date(2026, 10, 1)


def load_case(case_dir: Path):
    with (case_dir / "patients.csv").open(encoding="utf-8") as f:
        patients = {r["patient_id"]: r for r in csv.DictReader(f)}
    requests = [line.strip() for line in (case_dir / "requests.txt").read_text(encoding="utf-8").splitlines() if line.strip()]
    seed = json.loads((case_dir / "memory_seed.json").read_text(encoding="utf-8"))
    return patients, requests, seed


def perceive(text: str) -> dict:
    # TODO: 找第一个 "P" + 三位数字的子串作为 pid（找不到 → None）；
    #       文本含"复查" → intent="复查"，否则 "一般咨询"
    return {"pid": None, "intent": "一般咨询"}


def decide(pid, patients, today: date):
    # TODO: 按 task.md 的六条规则（顺序不能变）返回 (action, days_since_visit)：
    #   invalid_request / unknown_patient 的 days_since_visit 是 None
    return "none", None


def act(req_id, text, pid, action, patients, memory):
    # TODO: 按消息模板拼（三种情况：正常决策 / 无患者号 / 患者不存在）
    return {"req_id": req_id, "text": ""}


def plot(counts: dict, fig_dir: Path) -> dict:
    # TODO: 画各类动作条数柱状图；轴标签用英文（复验镜像没有中文字体），中文写进 takeaway
    fig_dir.mkdir(parents=True, exist_ok=True)
    return {"path": f"{fig_dir.as_posix()}/actions.png", "takeaway": ""}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("case_dir")
    ap.add_argument("out")
    ap.add_argument("--fig-dir", default="figures")
    a = ap.parse_args()

    patients, requests, memory = load_case(Path(a.case_dir))
    perceive_out, decisions, messages = [], [], []
    for i, text in enumerate(requests, 1):
        req_id = f"r{i}"
        pr = perceive(text)
        perceive_out.append({"req_id": req_id, "pid": pr["pid"], "intent": pr["intent"]})
        action, days = decide(pr["pid"], patients, TODAY)
        decisions.append({"req_id": req_id, "pid": pr["pid"], "action": action, "days_since_visit": days})
        messages.append(act(req_id, text, pr["pid"], action, patients, memory))
        # TODO: 只对正常决策写记忆（invalid_request / unknown_patient 不写）

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
        "notes": "",
    }
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
