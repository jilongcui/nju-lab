#!/usr/bin/env python3
"""第 18 章（技能 Skill）的**起点骨架**：把你的实现写在标了 TODO 的地方。

结构已经搭好，与 `problem/reference/scripts/read_report.py` 的函数划分**完全一致** ——
先跑通参考实现、读懂它的输出，再回来把自己的 TODO 填掉。

要填的三处：
  ① `clean_rows`      —— 清洗口径（task.md 的 5 条，顺序不能反）
  ② `classify`        —— 逐项判定（flag 用严格不等、危急值用闭区间）
  ③ `plot_deviations` / `build_alerts` / `compose_summary` / `compose_notes` —— 报警、图与结论

已经给出的部分（最小示例）：读三份输入文件、全角转半角（`normalize`）、数字解析（`parse_value`）。

用法：
  python3 scripts/read_report.py <case目录> <output.json>   # 单个 case（图写到当前目录的 figures/）
"""
from __future__ import annotations

import argparse
import csv
import json
import unicodedata
from pathlib import Path

import matplotlib

matplotlib.use("Agg")  # 容器内无显示环境
import matplotlib.pyplot as plt  # noqa: E402

FIG_DIR = Path("figures")
FIG_NAME = "lab_report_flags.png"

CASES_DIR = Path(__file__).resolve().parent.parent.parent / "problem" / "cases"


# ---------------------------------------------------------------- 已给出：读数据 / 全角归一


def normalize(text: str) -> str:
    """全角 → 半角（NFKC）并去掉首尾空白：`６．４` → `6.4`、` 8.2 ` → `8.2`。"""
    return unicodedata.normalize("NFKC", text or "").strip()


def parse_value(text: str) -> float | None:
    """能解析成数字就返回 float，否则 None（口径：整行丢弃）。"""
    try:
        return float(text)
    except (TypeError, ValueError):
        return None


def load_report(path: Path) -> list[dict[str, str]]:
    """读报告单（`item,value,unit`），保持文件里的原始顺序与原始文本。"""
    with path.open(encoding="utf-8", newline="") as fh:
        return [dict(row) for row in csv.DictReader(fh)]


def load_ranges(path: Path) -> dict[str, dict]:
    """读参考区间表：`item → {ref_low, ref_high, critical_low, critical_high, unit}`（空串=不判）。"""
    out: dict[str, dict] = {}
    with path.open(encoding="utf-8", newline="") as fh:
        for row in csv.DictReader(fh):
            item = normalize(row.get("item", ""))
            if not item:
                continue
            out[item] = {
                "unit": normalize(row.get("unit", "")),
                "ref_low": parse_value(normalize(row.get("ref_low", ""))),
                "ref_high": parse_value(normalize(row.get("ref_high", ""))),
                "critical_low": parse_value(normalize(row.get("critical_low", ""))),
                "critical_high": parse_value(normalize(row.get("critical_high", ""))),
            }
    return out


def load_patient(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


# ---------------------------------------------------------------- TODO ①：清洗口径


def clean_rows(rows: list[dict[str, str]]) -> tuple[list[dict], dict[str, int]]:
    """按 `task.md` 的清洗口径过一遍，返回 `(保留下来的行, {"invalid": n, "duplicates": m})`。

    TODO ①：这里要做的（**顺序不能反**）：
      1. `item` / `value` / `unit` 三个字段都做 `normalize()`
      2. 任一为空 → 整行丢弃，计入 `invalid`
      3. `value` 解析不出数字 → 整行丢弃，计入 `invalid`
      4. 同一个 `item` 第二次出现 → 整行丢弃，计入 `duplicates`（**保留首次出现**）
    保留下来的每行是一个 dict：`{"item": str, "value": float, "unit": str}`。
    """
    raise NotImplementedError("TODO ①：按 task.md 的清洗口径实现 clean_rows")


# ---------------------------------------------------------------- TODO ②：逐项判定


def classify(value: float, rng: dict) -> tuple[str, bool]:
    """返回 `(flag, critical)`。

    TODO ②：口径写死在 `task.md`，两处不等号方向**不同**：
      - `flag` 用**严格不等**：`value > ref_high` → `"high"`、`value < ref_low` → `"low"`，其余 `"normal"`
        （所以**恰好等于参考上限/下限算正常**）；
      - `critical` 用**闭区间**（安全侧）：`value >= critical_high` 或 `value <= critical_low` → `True`；
      - 区间表里某一侧是空（`None`）→ 这一侧不判。
    """
    raise NotImplementedError("TODO ②：实现 flag 与 critical 的判定")


def build_items(rows: list[dict], ranges: dict[str, dict]) -> list[dict]:
    """逐项判定；参考区间表里没有的项目判 `unknown`（**不猜**），按 item 的 ASCII 升序输出。

    每项的字段与 `task.md` 的交付格式一致：
    `{"item", "value", "unit", "ref_low", "ref_high", "flag", "critical"}`；
    `unknown` 的项目 `ref_low` / `ref_high` 写 `None`、`critical` 为 `False`。
    """
    raise NotImplementedError("TODO ②：实现 build_items（含 unknown 处理与排序）")


def fmt(value) -> str:
    """把数字写进文案里：整数不带小数点（`6.0` → `6`），便于与报告对照。"""
    if value is None:
        return "-"
    return str(int(value)) if float(value).is_integer() else str(value)


# ---------------------------------------------------------------- TODO ③：报警 / 图 / 结论


def build_alerts(items: list[dict], ranges: dict[str, dict]) -> list[dict]:
    """危急值清单：`[{"item", "value", "unit", "reason"}]`，按 item 升序。

    TODO ③：`reason` 必须说清依据 —— 触发的是哪一侧阈值、阈值是多少（含单位）。
    判据里有一条语义项专门看这个：只写"结果异常，请复查"是不通过的。
    """
    raise NotImplementedError("TODO ③：实现 build_alerts")


def deviation(item: dict) -> float:
    """偏离参考区间"中点"多少个半区间 —— >1 表示高于上限、<-1 表示低于下限，`unknown` 记 0。"""
    lo, hi = item["ref_low"], item["ref_high"]
    if lo is not None and hi is not None:
        mid, half = (lo + hi) / 2, (hi - lo) / 2
    elif hi is not None:
        mid, half = hi, abs(hi)
    elif lo is not None:
        mid, half = lo, abs(lo)
    else:
        return 0.0
    return 0.0 if not half else (item["value"] - mid) / half


def plot_deviations(items: list[dict], fig_root: Path) -> list[dict]:
    """画一张图，返回 `[{"path", "takeaway"}]`。

    TODO ③：给出最小示例 —— **图上的标题与轴标签用英文**（镜像里没有中文字体，中文会变方框），
    存到 `<工作目录>/figures/` 下；`takeaway` 里的数字要与 `items` 自洽（judge 会核对）。
    """
    fig_root.mkdir(parents=True, exist_ok=True)
    labels = [it["item"] for it in items]
    devs = [deviation(it) for it in items]
    fig, ax = plt.subplots(figsize=(7.2, 4.6))
    ax.barh(labels, devs)
    ax.axvline(1, color="#666666", linestyle="--", linewidth=0.8)
    ax.axvline(-1, color="#666666", linestyle="--", linewidth=0.8)
    ax.set_xlabel("Deviation from reference midpoint (half-range units)")
    ax.set_ylabel("Lab item")
    ax.set_title("Lab report: deviation from reference range")
    fig.tight_layout()
    fig.savefig(fig_root / FIG_NAME, dpi=110)
    plt.close(fig)
    # TODO ③：把 takeaway 换成"看图说话"的一句话（正常/偏高/偏低各几项、哪几项是危急值）
    return [{"path": f"{FIG_DIR}/{FIG_NAME}", "takeaway": "TODO：用一句话说清这张图告诉了我们什么"}]


def compose_summary(items: list[dict], alerts: list[dict], patient: dict) -> str:
    """`summary`：≥60 字。TODO ③ —— 讲清正常/异常各几项、哪几项达到危急阈值、
    给出就医提示，并说明**不构成诊断**（越界下诊断判不通过）。"""
    raise NotImplementedError("TODO ③：实现 compose_summary")


def compose_notes(items: list[dict], dropped: dict, alerts: list[dict], patient: dict) -> str:
    """`notes`：≥60 字。TODO ③ —— 讲清口径与做法（含两处不等号的差别、清洗顺序）
    与至少一条真实局限。"""
    raise NotImplementedError("TODO ③：实现 compose_notes")


# ---------------------------------------------------------------- 串起来（不用改）


def read_case(case_dir: Path, fig_root: Path | None = None) -> tuple[dict, dict]:
    rows = load_report(case_dir / "lab_report.csv")
    ranges = load_ranges(case_dir / "reference_ranges.csv")
    patient = load_patient(case_dir / "patient.json")

    kept, dropped = clean_rows(rows)
    items = build_items(kept, ranges)
    alerts = build_alerts(items, ranges)
    figures = plot_deviations(items, fig_root or Path("."))

    out = {
        # TODO：`skill_card` 是这一章的"脸面"—— description 要写清触发与**不适用场景**，
        # 平台断言要求 description ≥ 40 字、not_applicable ≥ 2 条、safety_rules ≥ 1 条。
        "skill_card": {
            "name": "lab-report-reader",
            "description": "TODO：解决什么任务 + 什么指令触发 + 适用场景 + 不适用场景",
            "triggers": ["TODO"],
            "not_applicable": ["TODO", "TODO"],
            "safety_rules": ["TODO"],
        },
        "items": [
            {
                "item": i["item"],
                "value": i["value"],
                "unit": i["unit"],
                "ref_low": i["ref_low"],
                "ref_high": i["ref_high"],
                "flag": i["flag"],
                "critical": i["critical"],
            }
            for i in items
        ],
        "critical_alerts": alerts,
        "unknown_items": [i["item"] for i in items if i["flag"] == "unknown"],
        "dropped": dropped,
        "summary": compose_summary(items, alerts, patient),
        "figures": figures,
        "notes": compose_notes(items, dropped, alerts, patient),
    }

    expected = {
        "n_report_rows": len(rows),
        "n_items": len(items),
        "dropped": dropped,
        "items": [
            {"item": i["item"], "value": i["value"], "flag": i["flag"], "critical": i["critical"]}
            for i in items
        ],
        "critical_item_names": [a["item"] for a in alerts],
        "unknown_items": [i["item"] for i in items if i["flag"] == "unknown"],
    }
    return out, expected


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("case_dir", help="case 目录（含 lab_report.csv / reference_ranges.csv）")
    ap.add_argument("out_path", help="输出 output.json 的路径")
    args = ap.parse_args()
    case_dir, out_path = Path(args.case_dir), Path(args.out_path)
    out, _ = read_case(case_dir, Path("."))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[ok] {case_dir.name} → {out_path}")


if __name__ == "__main__":
    main()
