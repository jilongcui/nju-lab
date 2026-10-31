"""造 case01 / case02 的工具清单、数据与请求序列，并标定 expected.json（可重跑；不下发）。

口径（与 problem/task.md 一致）：
  · 通知（没有 id 的请求）不产生响应
  · initialize → protocolVersion/capabilities/serverInfo 固定
  · tools/list → 原样返回 tools.json 的数组
  · tools/call 成功 → {content:[{type:"text",text}], isError}；查不到 → isError=true，text="未收录…"
  · 未知工具 / 缺必填参数 → error -32602；未知方法 → error -32601
  · 相互作用表按「两个药名排序后用 | 连接」查
"""
import json
from pathlib import Path

SERVER_INFO = {"name": "drug-info", "version": "0.1"}

TOOLS_2 = [
    {
        "name": "get_drug_info",
        "description": "查询一种药品的适应证与禁忌证；只接受中文通用名，查不到时返回未收录。",
        "inputSchema": {
            "type": "object",
            "properties": {"drug_name": {"type": "string", "description": "药品通用名，如 二甲双胍"}},
            "required": ["drug_name"],
        },
    },
    {
        "name": "check_interaction",
        "description": "查询两种药之间已知的相互作用；没有收录时返回未收录。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "drug_a": {"type": "string", "description": "药品甲"},
                "drug_b": {"type": "string", "description": "药品乙"},
            },
            "required": ["drug_a", "drug_b"],
        },
    },
]

DATA = {
    "drugs": {
        "二甲双胍": {"indication": "2 型糖尿病一线用药", "contraindication": "eGFR<30 禁用；碘造影检查前后 48 小时停用"},
        "华法林": {"indication": "房颤抗凝", "contraindication": "妊娠、活动性出血"},
        "阿司匹林": {"indication": "抗血小板", "contraindication": "活动性消化道溃疡"},
    },
    "interactions": {
        "华法林|阿司匹林": "出血风险明显增加，需监测 INR",
    },
}

CASES = {
    "case01": {
        "tools": TOOLS_2,
        "data": DATA,
        "requests": [
            {"jsonrpc": "2.0", "id": 1, "method": "initialize",
             "params": {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "demo-host", "version": "0.1"}}},
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
            {"jsonrpc": "2.0", "id": 3, "method": "tools/call",
             "params": {"name": "get_drug_info", "arguments": {"drug_name": "二甲双胍"}}},
            {"jsonrpc": "2.0", "id": 4, "method": "tools/call",
             "params": {"name": "get_drug_info", "arguments": {"drug_name": "布洛芬"}}},
            {"jsonrpc": "2.0", "id": 5, "method": "tools/call",
             "params": {"name": "check_interaction", "arguments": {"drug_a": "阿司匹林", "drug_b": "华法林"}}},
            {"jsonrpc": "2.0", "id": 6, "method": "tools/call",
             "params": {"name": "delete_patient", "arguments": {"patient_id": "P001"}}},
            {"jsonrpc": "2.0", "id": 7, "method": "resources/read", "params": {"uri": "drug://formulary"}},
            {"jsonrpc": "2.0", "id": 8, "method": "tools/call",
             "params": {"name": "check_interaction", "arguments": {"drug_a": "华法林"}}},
        ],
    },
    "case02": {
        "tools": TOOLS_2 + [{
            "name": "query_labs",
            "description": "查询某位患者某项目的最近若干次检验结果。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "patient_id": {"type": "string", "description": "患者号，如 P001"},
                    "item": {"type": "string", "description": "检验项目，如 HbA1c"},
                    "limit": {"type": "integer", "description": "最多返回几条，默认 3"},
                },
                "required": ["patient_id", "item"],
            },
        }],
        "data": dict(DATA, labs={
            "P001|HbA1c": [{"date": "2026-03-10", "value": 8.6}, {"date": "2026-06-15", "value": 8.2}, {"date": "2026-09-20", "value": 7.4}],
            "P002|HbA1c": [{"date": "2026-09-20", "value": 6.4}],
        }),
        "requests": [
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            {"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
            {"jsonrpc": "2.0", "id": 2, "method": "tools/call",
             "params": {"name": "query_labs", "arguments": {"patient_id": "P001", "item": "HbA1c", "limit": 2}}},
            {"jsonrpc": "2.0", "id": 3, "method": "tools/call",
             "params": {"name": "query_labs", "arguments": {"patient_id": "P900", "item": "HbA1c"}}},
            {"jsonrpc": "2.0", "id": 4, "method": "tools/call",
             "params": {"name": "get_drug_info", "arguments": {"drug_name": "华法林"}}},
            {"jsonrpc": "2.0", "id": 5, "method": "prompts/list"},
        ],
    },
}


def drug_text(drug_name, data):
    d = data["drugs"].get(drug_name)
    if not d:
        return "未收录该药品", True
    return f"适应证：{d['indication']}；禁忌证：{d['contraindication']}。", False


def interaction_text(a, b, data):
    key = "|".join(sorted([a, b]))
    text = data["interactions"].get(key)
    if not text:
        return "未收录该相互作用组合", True
    return f"相互作用：{text}。", False


def handle(req, tools, data):
    method, rid = req.get("method"), req.get("id")
    if rid is None:
        return {"seq": None, "request_id": None, "responded": False, "response": None}
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
            key = f"{args['patient_id']}|{args['item']}"
            rows = data["labs"].get(key)
            if rows is None:
                text, bad = "未收录该检验记录", True
            else:
                limit = int(args.get("limit", 3))
                picked = rows[-limit:]
                text = "；".join(f"{r['date']} {r['value']}" for r in picked)
                bad = False
        return {"jsonrpc": "2.0", "id": rid, "result": {"content": [{"type": "text", "text": text}], "isError": bad}}
    return {"jsonrpc": "2.0", "id": rid, "error": {"code": -32601, "message": f"不支持的方法 {method}"}}


def run(case):
    responses, errors, is_error_true = [], 0, 0
    for seq, req in enumerate(case["requests"], 1):
        resp = handle(req, case["tools"], case["data"])
        rid = req.get("id")
        if rid is None:
            responses.append({"seq": seq, "request_id": None, "responded": False, "response": None})
            continue
        if "error" in resp:
            errors += 1
        if resp.get("result", {}).get("isError") is True:
            is_error_true += 1
        responses.append({"seq": seq, "request_id": rid, "responded": True, "response": resp})
    return {
        "n_requests": len(case["requests"]),
        "responses": responses,
        "discovered": {"tools": [t["name"] for t in case["tools"]], "count": len(case["tools"])},
        "stats": {
            "requests": len(case["requests"]),
            "responded": sum(1 for r in responses if r["responded"]),
            "notified": sum(1 for r in responses if not r["responded"]),
            "errors": errors,
            "is_error_true": is_error_true,
        },
    }


def main():
    root = Path(__file__).resolve().parent.parent / "problem" / "cases"
    for name, case in CASES.items():
        d = root / name
        d.mkdir(parents=True, exist_ok=True)
        (d / "tools.json").write_text(json.dumps(case["tools"], ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        (d / "data.json").write_text(json.dumps(case["data"], ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        (d / "requests.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in case["requests"]), encoding="utf-8")
        (d / "expected.json").write_text(json.dumps({k: run(case)[k] for k in ("responses", "discovered", "stats")},
                                                    ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print("写出", name)


if __name__ == "__main__":
    main()
