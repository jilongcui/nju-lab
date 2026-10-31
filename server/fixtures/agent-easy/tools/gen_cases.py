"""造 case01 / case02 的数据并标定 expected.json（固定数据，可重跑；不下发学生）。

口径（与 problem/task.md 一致）：
  · pid = 请求里第一个 P\\d{3}
  · today = 2026-10-01（写死，跨平台可比）
  · days = (today - last_visit).days
  · action 优先级：urgent(hba1c>=9.0) → recall(days>=90 且 hba1c>=7.0) → annual(days>=180) → none
  · 消息里的"上次联系"取**处理本条请求之前**的记忆（没有 → 未联系）
"""
import json
from pathlib import Path

TODAY = "2026-10-01"

CASES = {
    "case01": {
        "patients": [
            {"patient_id": "P001", "name": "张阿姨", "hba1c": 8.2, "last_visit": "2026-06-15", "drugs": "二甲双胍"},
            {"patient_id": "P002", "name": "李叔叔", "hba1c": 6.4, "last_visit": "2026-09-20", "drugs": "达格列净"},
            {"patient_id": "P003", "name": "王大爷", "hba1c": 9.4, "last_visit": "2026-07-02", "drugs": "胰岛素"},
            {"patient_id": "P004", "name": "赵阿姨", "hba1c": 7.5, "last_visit": "2025-12-01", "drugs": "阿卡波糖"},
            {"patient_id": "P005", "name": "孙叔叔", "hba1c": 6.8, "last_visit": "2025-11-10", "drugs": "格列美脲"},
        ],
        "requests": [
            "帮我看下 P001 这次要不要复查",
            "P003 的结果出来了，看看",
            "P002 需要复查吗",
            "帮我查 P005",
            "P999 帮我看看",
            "今天天气不错",
        ],
        "memory_seed": {},
    },
    "case02": {
        "patients": [
            {"patient_id": "P001", "name": "张阿姨", "hba1c": 8.6, "last_visit": "2026-05-20", "drugs": "二甲双胍"},
            {"patient_id": "P002", "name": "李叔叔", "hba1c": 9.1, "last_visit": "2026-09-28", "drugs": "达格列净"},
            {"patient_id": "P003", "name": "王大爷", "hba1c": 6.9, "last_visit": "2025-10-15", "drugs": "胰岛素"},
            {"patient_id": "P004", "name": "赵阿姨", "hba1c": 6.2, "last_visit": "2026-08-30", "drugs": "阿卡波糖"},
        ],
        "requests": [
            "P001 该复查了吧",
            "P002 最近怎么样",
            "P001 再确认一下",
            "请帮我看 P004",
            "P777 的呢",
        ],
        # 种子里已有 P001 的接触记录：用来验证"消息读的是处理本条请求之前的记忆"
        "memory_seed": {"P001": {"last_contact": "2026-08-01", "last_action": "recall"}},
    },
}


def load_patients(rows):
    return {r["patient_id"]: r for r in rows}


def perceive(text):
    pid = None
    for i in range(len(text) - 3):
        seg = text[i:i + 4]
        if seg[0] == "P" and seg[1:].isdigit():
            pid = seg
            break
    return {"pid": pid, "intent": "复查" if "复查" in text else "一般咨询"}


def decide(p, today):
    days = (today - __import__("datetime").date.fromisoformat(p["last_visit"])).days
    if p["hba1c"] >= 9.0:
        action = "urgent"
    elif days >= 90 and p["hba1c"] >= 7.0:
        action = "recall"
    elif days >= 180:
        action = "annual"
    else:
        action = "none"
    return action, days


def run(case):
    from datetime import date
    today = date.fromisoformat(TODAY)
    patients = load_patients(case["patients"])
    memory = json.loads(json.dumps(case["memory_seed"]))
    perceive_out, decisions, messages = [], [], []
    for i, text in enumerate(case["requests"], 1):
        req_id = f"r{i}"
        pr = perceive(text)
        perceive_out.append({"req_id": req_id, "pid": pr["pid"], "intent": pr["intent"]})
        if pr["pid"] is None:
            decisions.append({"req_id": req_id, "pid": None, "action": "invalid_request", "days_since_visit": None})
            messages.append({"req_id": req_id, "text": f"[invalid_request] 请求里没有患者号：{text}"})
            continue
        if pr["pid"] not in patients:
            decisions.append({"req_id": req_id, "pid": pr["pid"], "action": "unknown_patient", "days_since_visit": None})
            messages.append({"req_id": req_id, "text": f"[unknown_patient] 未找到患者 {pr['pid']}"})
            continue
        p = patients[pr["pid"]]
        action, days = decide(p, today)
        last = memory.get(pr["pid"], {}).get("last_contact", "未联系")
        decisions.append({"req_id": req_id, "pid": pr["pid"], "action": action, "days_since_visit": days})
        messages.append({"req_id": req_id, "text": f"[{action}] {p['name']}：上次联系 {last}，HbA1c {p['hba1c']}。"})
        memory[pr["pid"]] = {"last_contact": TODAY, "last_action": action}
    counts = {}
    for d in decisions:
        counts[d["action"]] = counts.get(d["action"], 0) + 1
    return {
        "n_requests": len(case["requests"]),
        "n_patients": len(case["patients"]),
        "perceive": perceive_out,
        "decisions": decisions,
        "messages": messages,
        "memory_after": memory,
        "counts": counts,
    }


def main():
    root = Path(__file__).resolve().parent.parent / "problem" / "cases"
    for name, case in CASES.items():
        d = root / name
        d.mkdir(parents=True, exist_ok=True)
        with (d / "patients.csv").open("w", encoding="utf-8") as f:
            f.write("patient_id,name,hba1c,last_visit,drugs\n")
            for r in case["patients"]:
                f.write(f"{r['patient_id']},{r['name']},{r['hba1c']},{r['last_visit']},{r['drugs']}\n")
        (d / "requests.txt").write_text("\n".join(case["requests"]) + "\n", encoding="utf-8")
        (d / "memory_seed.json").write_text(
            json.dumps(case["memory_seed"], ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        (d / "expected.json").write_text(
            json.dumps({k: run(case)[k] for k in ("perceive", "decisions", "messages", "memory_after", "counts")},
                       ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print("写出", name)


if __name__ == "__main__":
    main()
