"""三个工具（参考实现）：全部真读 assets.csv / kb/。"""
from __future__ import annotations

import math
from datetime import date

from .data import Packet

CATEGORY_BY_KEYWORD = (("真空泵", "真空泵"), ("空压机", "空压机"), ("风机", "风机"), ("水泵", "水泵"))


def category_of(name: str) -> str:
    for keyword, label in CATEGORY_BY_KEYWORD:
        if keyword in name:
            return label
    return "水泵" if "泵" in name else ""  # 污水处理泵这类没写"水泵"


def query_assets(args: dict, packet: Packet) -> str:
    site, category, status = args.get("site"), args.get("category"), args.get("status")
    rows = [
        r for r in packet.assets
        if (not site or r["site"] == site)
        and (not category or category_of(r["name"]) == category)
        and (not status or r["status"] == status)
    ]
    if not rows:
        return "没有匹配的设备（站点 / 类别 / 状态可能写得比台账更窄）。"
    lines = [
        f"{r['asset_id']} {r['name']}（{r['site']}{r['location']}，{r['model']}，{r['status']}，上次保养 {r['last_service_on']}）"
        for r in rows
    ]
    return f"共 {len(rows)} 台：\n" + "\n".join(lines)


def overdue_assets(args: dict, packet: Packet) -> str:
    site = args.get("site")
    as_of = date.fromisoformat(packet.limits["as_of"])
    cycles = packet.limits["cycle_days"]
    rows = []
    for r in packet.assets:
        if site and r["site"] != site:
            continue
        cycle = cycles.get(category_of(r["name"]))
        if not cycle:
            continue
        overdue = (as_of - date.fromisoformat(r["last_service_on"])).days - cycle
        if overdue > 0:
            rows.append((overdue, r, cycle))
    if not rows:
        return "按基准日计算，没有逾期设备。"
    rows.sort(key=lambda x: -x[0])
    lines = [
        f"{r['asset_id']} {r['name']}（{r['site']}）逾期 {days} 天，周期 {cycle} 天，上次保养 {r['last_service_on']}"
        for days, r, cycle in rows
    ]
    return f"逾期 {len(rows)} 台（基准日 {packet.limits['as_of']}，按逾期天数降序）：\n" + "\n".join(lines)


def _grams(text: str) -> list[str]:
    clean = "".join(ch for ch in text.lower() if ch.isalnum())
    return [clean[i:i + 2] for i in range(max(1, len(clean) - 1))]


def search_manual(args: dict, packet: Packet) -> str:
    query = str(args.get("query") or "").strip()
    if not query:
        return "检索词为空。"
    q = _grams(query)
    scored = []
    for pid, text in packet.kb.items():
        g = _grams(text)
        hits = sum(g.count(gram) for gram in q)
        if hits:
            scored.append((hits / math.sqrt(len(g) or 1), pid, text))
    if not scored:
        return f"手册里没有和「{query}」相关的段落。"
    scored.sort(key=lambda x: (-x[0], x[1]))
    top_k = int(packet.limits.get("top_k") or 3)
    blocks = [f"{pid}：{text.strip()[:220]}" for _, pid, text in scored[:top_k]]
    return f"命中 {len(scored)} 段，取前 {min(top_k, len(scored))}：\n" + "\n\n".join(blocks)


TOOLS = {
    "query_assets": query_assets,
    "overdue_assets": overdue_assets,
    "search_manual": search_manual,
}


def run_tool(name: str, args: dict | None, packet: Packet) -> tuple[str, bool]:
    fn = TOOLS.get(name)
    if fn is None:
        known = "、".join(sorted(TOOLS))
        return (f"未知工具：{name}（可用：{known}）", True)
    if args is not None and not isinstance(args, dict):
        return (f"工具 {name} 的参数必须是 JSON 对象，收到 {type(args).__name__}", True)
    try:
        return (str(fn(args or {}, packet)), False)
    except Exception as exc:  # noqa: BLE001
        return (f"工具 {name} 执行失败：{exc}", True)
