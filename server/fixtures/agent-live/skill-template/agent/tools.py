"""三个工具：**要真读题目包里的文件**。标了 TODO 的函数体要你写。

名册见题目包的 `tools.json`。参数校验、异常包装、未知工具的兜底已经在
`run_tool()` 里给好了 —— 你只写"工具本身干什么"。
"""
from __future__ import annotations

from datetime import date

from .data import Packet


# ---------------------------------------------------------------- 工具实现（TODO）
def query_assets(args: dict, packet: Packet) -> str:
    """按 `site` / `category` / `status` 过滤台账，返回可读的多行文本。

    - 三个参数都可选；给了就过滤，没给就不限；
    - 每行至少带 `asset_id` 与 `name`，让人一眼能对上；
    - 一台都没匹配上时，返回一句明确的话（不要返回空字符串）。

    提示：`packet.assets` 是 `assets.csv` 读出来的 dict 列表；
    类别（空压机/水泵/风机/真空泵）要从 `name` 里判断。
    """
    raise NotImplementedError("TODO: 实现 query_assets")


def overdue_assets(args: dict, packet: Packet) -> str:
    """按手册的保养周期算逾期设备，按逾期天数**降序**返回。

    逾期天数 = `limits.as_of` − `last_service_on` − 该类设备的 `cycle_days`。
    只报大于 0 的；每行带 `asset_id`、逾期天数、上次保养日期。

    提示：`packet.limits["cycle_days"]` 是类别 → 天数的映射，
    `packet.limits["as_of"]` 是判定基准日（别用 `date.today()`，否则复验时结果会漂）。
    """
    raise NotImplementedError("TODO: 实现 overdue_assets")


def search_manual(args: dict, packet: Packet) -> str:
    """在 `kb/` 里检索，返回**带段落编号**的命中（取前 `limits.top_k` 条）。

    返回文本里必须能看到编号（如 `KB-03`）—— 后面给引用就靠它，
    编一个编号出来会被判"引用无据"。

    提示：`packet.kb` 是 `{编号: 正文}`；切词不必复杂，按字符 2-gram 就够，
    再按"命中次数 / 文档长度"排一下序。
    """
    raise NotImplementedError("TODO: 实现 search_manual")


# ---------------------------------------------------------------- 注册表 + 执行（已给好）
TOOLS = {
    "query_assets": query_assets,
    "overdue_assets": overdue_assets,
    "search_manual": search_manual,
}


def run_tool(name: str, args: dict | None, packet: Packet) -> tuple[str, bool]:
    """执行一个工具，返回 `(观察文本, 是否出错)`。**不用改。**

    观察文本会原样进 `steps[].observation`，也会回填给模型 ——
    所以不要在这里吞掉错误：出错就如实写"工具 X 执行失败：…"。
    """
    fn = TOOLS.get(name)
    if fn is None:
        known = "、".join(sorted(TOOLS))
        return (f"未知工具：{name}（可用：{known}）", True)
    if args is not None and not isinstance(args, dict):
        return (f"工具 {name} 的参数必须是 JSON 对象，收到 {type(args).__name__}", True)
    try:
        return (str(fn(args or {}, packet)), False)
    except Exception as exc:  # noqa: BLE001 - 工具的异常要变成可观察的结果
        return (f"工具 {name} 执行失败：{exc}", True)
