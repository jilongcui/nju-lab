"""你的方案：最小 MCP 服务器（一行一条 JSON-RPC），写 output.json + 一张图。

**代码里的 TODO 才是你要改的地方**（文档 `SKILL.md` 不用改）。
用法：python3 scripts/solve.py <case目录> <output.json> [--fig-dir figures]
"""
import argparse
import json
from pathlib import Path

SERVER_INFO = {"name": "drug-info", "version": "0.1"}


def load_case(case_dir: Path):
    tools = json.loads((case_dir / "tools.json").read_text(encoding="utf-8"))
    data = json.loads((case_dir / "data.json").read_text(encoding="utf-8"))
    reqs = [json.loads(line) for line in (case_dir / "requests.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
    return tools, data, reqs


def handle(req, tools, data):
    # TODO: 按 task.md 的口径返回响应字典；通知（没有 id）返回 None
    #   initialize / tools/list / tools/call / 其它方法（-32601）
    #   tools/call 里先查工具名（-32602）、再查 required（-32602）、最后执行
    return None


def plot(stats, fig_dir: Path) -> dict:
    # TODO: 画响应类型柱状图；轴标签用英文（复验镜像没有中文字体），中文写进 takeaway
    fig_dir.mkdir(parents=True, exist_ok=True)
    return {"path": f"{fig_dir.as_posix()}/responses.png", "takeaway": ""}


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
        "notes": "",
    }
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
