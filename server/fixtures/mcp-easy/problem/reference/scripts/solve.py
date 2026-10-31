"""参考实现：最小 MCP 服务器（一行一条 JSON-RPC），写 output.json + 一张图。

用法：python3 scripts/solve.py <case目录> <output.json> [--fig-dir figures]
"""
import argparse
import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

SERVER_INFO = {"name": "drug-info", "version": "0.1"}


def load_case(case_dir: Path):
    tools = json.loads((case_dir / "tools.json").read_text(encoding="utf-8"))
    data = json.loads((case_dir / "data.json").read_text(encoding="utf-8"))
    reqs = [json.loads(line) for line in (case_dir / "requests.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
    return tools, data, reqs


def drug_text(name, data):
    d = data["drugs"].get(name)
    if not d:
        return "未收录该药品", True
    return f"适应证：{d['indication']}；禁忌证：{d['contraindication']}。", False


def interaction_text(a, b, data):
    text = data["interactions"].get("|".join(sorted([a, b])))
    if not text:
        return "未收录该相互作用组合", True
    return f"相互作用：{text}。", False


def lab_text(patient_id, item, limit, data):
    rows = data["labs"].get(f"{patient_id}|{item}")
    if not rows:
        return "未收录该检验记录", True
    return "；".join(f"{r['date']} {r['value']}" for r in rows[-limit:]), False


def handle(req, tools, data):
    method, rid = req.get("method"), req.get("id")
    if rid is None:
        return None                      # 通知：不产生响应
    if method == "initialize":
        return {"jsonrpc": "2.0", "id": rid, "result": {
            "protocolVersion": "2024-11-05", "capabilities": {"tools": {}}, "serverInfo": SERVER_INFO}}
    if method == "tools/list":
        return {"jsonrpc": "2.0", "id": rid, "result": {"tools": tools}}
    if method == "tools/call":
        name = req.get("params", {}).get("name")
        args = req.get("params", {}).get("arguments", {}) or {}
        tool = next((t for t in tools if t["name"] == name), None)
        if tool is None:
            return {"jsonrpc": "2.0", "id": rid, "error": {"code": -32602, "message": f"未知工具 {name}"}}
        missing = [p for p in tool["inputSchema"].get("required", []) if p not in args]
        if missing:
            return {"jsonrpc": "2.0", "id": rid, "error": {"code": -32602, "message": f"缺少必填参数 {missing[0]}"}}
        if name == "get_drug_info":
            text, bad = drug_text(args["drug_name"], data)
        elif name == "check_interaction":
            text, bad = interaction_text(args["drug_a"], args["drug_b"], data)
        else:
            text, bad = lab_text(args["patient_id"], args["item"], int(args.get("limit", 3)), data)
        return {"jsonrpc": "2.0", "id": rid, "result": {"content": [{"type": "text", "text": text}], "isError": bad}}
    return {"jsonrpc": "2.0", "id": rid, "error": {"code": -32601, "message": f"不支持的方法 {method}"}}


def plot(stats, fig_dir: Path) -> dict:
    fig_dir.mkdir(parents=True, exist_ok=True)
    labels = ["ok", "isError", "protocol error", "no response"]
    values = [
        stats["responded"] - stats["errors"] - stats["is_error_true"],
        stats["is_error_true"],
        stats["errors"],
        stats["notified"],
    ]
    fig, ax = plt.subplots(figsize=(4.8, 3.6))
    ax.bar(range(len(labels)), values, color="#4C78A8")
    ax.set_xticks(range(len(labels)), labels, rotation=15)
    ax.set_ylabel("requests")
    ax.set_title("MCP responses by kind")
    fig.tight_layout()
    fig.savefig(fig_dir / "responses.png", dpi=110)
    plt.close(fig)
    return {
        "path": f"{fig_dir.as_posix()}/responses.png",
        "takeaway": (
            f"{stats['requests']} 条请求里 {stats['responded']} 条有响应、{stats['notified']} 条是通知不用回；"
            f"另有 {stats['errors']} 条协议错误、{stats['is_error_true']} 条工具正常返回但标记 isError。"
        ),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("case_dir")
    ap.add_argument("out")
    ap.add_argument("--fig-dir", default="figures")
    a = ap.parse_args()

    tools, data, reqs = load_case(Path(a.case_dir))
    responses, errors, is_error_true, notified = [], 0, 0, 0
    for seq, req in enumerate(reqs, 1):
        resp = handle(req, tools, data)
        if resp is None:
            notified += 1
            responses.append({"seq": seq, "request_id": None, "responded": False, "response": None})
            continue
        if "error" in resp:
            errors += 1
        if resp.get("result", {}).get("isError") is True:
            is_error_true += 1
        responses.append({"seq": seq, "request_id": req.get("id"), "responded": True, "response": resp})

    stats = {
        "requests": len(reqs),
        "responded": sum(1 for r in responses if r["responded"]),
        "notified": notified,
        "errors": errors,
        "is_error_true": is_error_true,
    }
    out = {
        "responses": responses,
        "discovered": {"tools": [t["name"] for t in tools], "count": len(tools)},
        "stats": stats,
        "figures": [plot(stats, Path(a.fig_dir))],
        "notes": (
            f"逐条处理 {len(reqs)} 个报文：没有 id 的通知（notifications/initialized）不回；"
            "initialize 回协议版本与 serverInfo；tools/list 原样回工具清单（含 inputSchema 说明书）；"
            "tools/call 先查工具名、再查必填参数，都通过才执行，执行结果用 content + isError 区分"
            "「正常回答」与「查不到」。未知工具和缺参数都回 -32602，未知方法回 -32601 —— "
            "错误码用错了，客户端就没法判断该重试还是该改请求。"
        ),
    }
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
