#!/usr/bin/env python3
"""第 18 章（技能 Skill）参考实现：检验报告单 → 结构化解读 `output.json` + 一张图。

📖 这份实现**随题目包一起下发**（`problem/reference/`）—— 先读懂它，再写你自己的。
   **它不是唯一正确答案**：函数怎么切、图怎么画都随你；判据只看
   "判定口径是否一致 + 危急值抓得对不对 + 不确定的项有没有如实说 + 有没有越界下诊断"。

它把 SKILL.md 里那三条工程原则真的落成了代码：

- **数值比对下沉给脚本**：`classify` 只做"数字 vs 区间"的机械比较，全程不让模型算数；
- **description / 触发边界**：`ok_to_read` 之外的东西不处理（表外项目判 `unknown`，不猜）；
- **安全边界（对应正文的 hooks 拦截）**：命中危急阈值的项一律进 `critical_alerts`，
  并在 `summary` 里给出"尽快就医"提示；全程**不下诊断**。

流程（与 task.md 的六步一致）：

  ① 看清需求      —— 报告单只有项目名/值/单位，判定依据在**参考区间表**里
  ② 读材料        —— `load_report` / `load_ranges` / 患者信息
  ③ 清洗归一      —— `clean_rows`：全角转半角、去空白、丢弃空值与非法值、同名项目只取首次
  ④ 逐项比对      —— `classify`：flag 用严格不等、危急值用闭区间（口径写死在 task.md）
  ⑤ 画图 + 报警   —— `plot_deviations` / `build_alerts`
  ⑥ 写结论        —— `compose_summary` / `compose_notes`（含"什么情况下不给结论"）

用法：

  python3 scripts/read_report.py <case目录> <output.json>   # 单个 case（图写到当前目录的 figures/）
  python3 scripts/read_report.py --regen-expected           # 重算 problem/cases/*/expected.json

请在**与复验同一个镜像内**生成 expected（当前 pkg6）：

  docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/w" --entrypoint python3 \
    nju-lab-verify:0.2.0-rc.2-pkg6 /w/problem/reference/scripts/read_report.py --regen-expected
"""
from __future__ import annotations

import argparse
import csv
import json
import tempfile
import unicodedata
from pathlib import Path

import matplotlib

matplotlib.use("Agg")  # 容器内无显示环境
import matplotlib.pyplot as plt  # noqa: E402

HERE = Path(__file__).resolve().parent
CASES_DIR = HERE.parent.parent / "cases"
FIG_DIR = Path("figures")

# 图上的文字必须用英文：容器里没有中文字体，中文会渲染成方框（见 task.md 的提醒）
FIG_NAME = "lab_report_flags.png"
COLOR = {"normal": "#9e9e9e", "high": "#d32f2f", "low": "#1976d2", "unknown": "#000000"}


# ---------- ② 读材料 ----------


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


def load_ranges(path: Path) -> dict[str, dict[str, float | None]]:
    """读参考区间表：`item → {ref_low, ref_high, critical_low, critical_high, unit}`（空串=不判）。"""
    out: dict[str, dict[str, float | None]] = {}
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


# ---------- ③ 清洗归一 ----------


def clean_rows(rows: list[dict[str, str]]) -> tuple[list[dict], dict[str, int]]:
    """按 task.md 的清洗口径过一遍：去空白+全角归一 → 丢空/非法值 → 同名项目只取首次。

    顺序**不能反**：先去重会让"第一条恰好是空值"这种情况把好行也丢掉。
    """
    kept: list[dict] = []
    seen: set[str] = set()
    invalid = 0
    duplicates = 0
    for raw in rows:
        item = normalize(raw.get("item", ""))
        unit = normalize(raw.get("unit", ""))
        value = parse_value(normalize(raw.get("value", "")))
        if not item or not unit or value is None:
            invalid += 1
            continue
        if item in seen:
            duplicates += 1
            continue
        seen.add(item)
        kept.append({"item": item, "value": value, "unit": unit})
    return kept, {"invalid": invalid, "duplicates": duplicates}


# ---------- ④ 逐项比对（确定性任务下沉脚本） ----------


def classify(value: float, rng: dict[str, float | None]) -> tuple[str, bool]:
    """返回 `(flag, critical)`。口径写死在 task.md：

    - flag 用**严格不等**：`value > ref_high` → high、`value < ref_low` → low，其余 normal
      （所以**恰好等于参考上限/下限算正常**）；
    - 危急值用**闭区间**：`value >= critical_high` 或 `value <= critical_low` → 报警
      （安全侧：恰好等于危急阈值就要提示）。
    """
    ref_low, ref_high = rng.get("ref_low"), rng.get("ref_high")
    if ref_high is not None and value > ref_high:
        flag = "high"
    elif ref_low is not None and value < ref_low:
        flag = "low"
    else:
        flag = "normal"

    crit_low, crit_high = rng.get("critical_low"), rng.get("critical_high")
    critical = (crit_high is not None and value >= crit_high) or (
        crit_low is not None and value <= crit_low
    )
    return flag, bool(critical)


def build_items(rows: list[dict], ranges: dict[str, dict]) -> list[dict]:
    """逐项判定；参考区间表里没有的项目判 `unknown`（**不猜**），按 item 的 ASCII 升序输出。"""
    items: list[dict] = []
    for row in rows:
        rng = ranges.get(row["item"])
        if rng is None:
            items.append(
                {
                    "item": row["item"],
                    "value": row["value"],
                    "unit": row["unit"],
                    "ref_low": None,
                    "ref_high": None,
                    "flag": "unknown",
                    "critical": False,
                }
            )
            continue
        flag, critical = classify(row["value"], rng)
        items.append(
            {
                "item": row["item"],
                "value": row["value"],
                "unit": row["unit"],
                "ref_low": rng.get("ref_low"),
                "ref_high": rng.get("ref_high"),
                "flag": flag,
                "critical": critical,
            }
        )
    items.sort(key=lambda x: x["item"])
    return items


def fmt(value: float | None) -> str:
    if value is None:
        return "-"
    return str(int(value)) if float(value).is_integer() else str(value)


def build_alerts(items: list[dict], ranges: dict[str, dict]) -> list[dict]:
    """危急值清单：`reason` 必须说清"依据哪条阈值"，这是判据里的语义项。"""
    alerts: list[dict] = []
    for it in items:
        if not it["critical"]:
            continue
        rng = ranges.get(it["item"], {})
        crit_high, crit_low = rng.get("critical_high"), rng.get("critical_low")
        if crit_high is not None and it["value"] >= crit_high:
            reason = f"value {fmt(it['value'])} {it['unit']} 达到危急上限 {fmt(crit_high)} {it['unit']}"
        elif crit_low is not None and it["value"] <= crit_low:
            reason = f"value {fmt(it['value'])} {it['unit']} 低于危急下限 {fmt(crit_low)} {it['unit']}"
        else:  # 理论上不会走到这里
            reason = f"value {fmt(it['value'])} {it['unit']} 触发了危急阈值"
        alerts.append(
            {"item": it["item"], "value": it["value"], "unit": it["unit"], "reason": reason}
        )
    return alerts


# ---------- ⑤ 画图 ----------


def deviation(item: dict) -> float:
    """偏离参考区间"中点"多少个半区间 —— >1 表示高于上限、<-1 表示低于下限。"""
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
    fig_root.mkdir(parents=True, exist_ok=True)
    rel = f"{FIG_DIR}/{FIG_NAME}"
    labels = [it["item"] for it in items]
    devs = [deviation(it) for it in items]
    colors = [COLOR.get(it["flag"], "#9e9e9e") for it in items]

    fig, ax = plt.subplots(figsize=(7.2, 4.6))
    ax.barh(labels, devs, color=colors)
    ax.axvline(1, color="#666666", linestyle="--", linewidth=0.8)
    ax.axvline(-1, color="#666666", linestyle="--", linewidth=0.8)
    ax.set_xlabel("Deviation from reference midpoint (half-range units)")
    ax.set_ylabel("Lab item")
    ax.set_title("Lab report: deviation from reference range\n(grey normal / red high / blue low / black unknown)")
    ax.tick_params(axis="y", labelsize=8)
    fig.tight_layout()
    fig.savefig(fig_root / FIG_NAME, dpi=110)
    plt.close(fig)

    n_high = sum(1 for i in items if i["flag"] == "high")
    n_low = sum(1 for i in items if i["flag"] == "low")
    n_normal = sum(1 for i in items if i["flag"] == "normal")
    n_unknown = sum(1 for i in items if i["flag"] == "unknown")
    crit = [i["item"] for i in items if i["critical"]]
    takeaway = (
        f"{len(items)} 个可判定项目：{n_normal} 项在参考区间内、{n_high} 项偏高、{n_low} 项偏低"
        f"（虚线为参考区间上下限，柱越长偏离越大）；达到危急阈值的 {len(crit)} 项是 "
        f"{'、'.join(crit) if crit else '（无）'}；另有 {n_unknown} 项因参考区间缺失无法判定。"
    )
    return [{"path": rel, "takeaway": takeaway}]


# ---------- ⑥ 写结论 ----------


def compose_summary(items: list[dict], alerts: list[dict], patient: dict) -> str:
    n_high = sum(1 for i in items if i["flag"] == "high")
    n_low = sum(1 for i in items if i["flag"] == "low")
    n_normal = sum(1 for i in items if i["flag"] == "normal")
    n_unknown = sum(1 for i in items if i["flag"] == "unknown")
    who = ""
    if patient:
        who = f"患者 {patient.get('name', '')}（{patient.get('sex', '')}，{patient.get('age', '')} 岁）："
    names = "、".join(a["item"] for a in alerts) or "（无）"
    head = f"{who}这份检验报告共有 {len(items)} 个可判定项目：{n_normal} 项在参考区间内，"
    body = f"{n_high} 项高于上限、{n_low} 项低于下限。"
    if alerts:
        crit = (
            f"其中 {len(alerts)} 项达到危急阈值（{names}），属于需要尽快处理的信号，"
            f"请立即联系临床医生核对并处理。"
        )
    else:
        crit = "本次没有项目达到危急阈值。"
    tail = (
        f"另有 {n_unknown} 项因参考区间表里没有对应条目而无法判定，"
        f"建议补充区间后重判。本解读只做「数值 vs 参考区间」的机械比对，"
        f"不构成诊断；是否患病、要不要用药，需要医生结合病史与其它检查判断。"
    )
    return head + body + crit + tail


def compose_notes(items: list[dict], dropped: dict, alerts: list[dict], patient: dict) -> str:
    unknown = [i["item"] for i in items if i["flag"] == "unknown"]
    return (
        "口径与做法：报告单先做全角转半角与首尾去空白，空值或非数字的行整行丢弃；"
        "同一个项目只保留**首次出现**，后面的重复行丢弃（哪怕后面那条更严重）—— 丢弃计数 "
        f"{dropped['invalid']} 条非法 / {dropped['duplicates']} 条重复。"
        "判定拆成两步：① flag 用严格不等（恰好等于参考上限或下限算正常）；"
        "② 危急值用闭区间（恰好等于危急阈值就报警，安全侧优先）。所有比较都由脚本完成，不让模型算数。"
        "不确定就说不确定：" + ("、".join(unknown) if unknown else "本次没有表外项目")
        + " 不在参考区间表里，所以判 unknown 而不是猜一个正常/异常。"
        f"本次共 {len(alerts)} 项危急值，已在 critical_alerts 里逐条给出依据阈值；"
        "若在本课程平台上运行，正文里说的 hooks 拦截在实验里落成"
        "「危急值一律进 critical_alerts，并在 summary 里给出尽快就医的提示」，不下诊断性结论。"
        "局限：只能看这一次的结果，判断不了趋势（需要历史结果）；不识别项目之间的组合意义"
        "（例如阴离子间隙）；参考区间表也没有按性别、年龄与方法学细分，换成别的方法学要换表。"
    )


def read_case(case_dir: Path, fig_root: Path | None = None) -> tuple[dict, dict]:
    """跑完六步，返回 `(output, expected)`。`expected` 只留判分要比对的确定值。"""
    rows = load_report(case_dir / "lab_report.csv")
    ranges = load_ranges(case_dir / "reference_ranges.csv")
    patient = load_patient(case_dir / "patient.json")

    kept, dropped = clean_rows(rows)
    items = build_items(kept, ranges)
    alerts = build_alerts(items, ranges)
    figures = plot_deviations(items, fig_root or Path("."))

    out = {
        "skill_card": {
            "name": "lab-report-reader",
            "description": (
                "检验报告解读 Skill：读取检验报告单（项目/结果/单位）与参考区间表，"
                "逐项做「数值 vs 参考区间」的机械比对，判断偏高/偏低/正常，挑出达到危急阈值的项目并给出"
                "依据阈值；当用户贴出或上传检验报告单、问「这些指标正常吗 / 有没有危急值 / 帮我解读报告」时触发。"
                "只做健康科普层面的区间比对，不给诊断结论、不做治疗建议，也不适用于影像与病理报告。"
            ),
            "triggers": [
                "用户贴出或上传检验报告单（项目 + 结果 + 单位）",
                "用户问「这些指标正常吗 / 有没有异常 / 有没有危急值」",
                "用户要求按参考区间生成一份结构化解读",
            ],
            "not_applicable": [
                "影像报告、病理报告、心电报告 —— 没有「数值 vs 参考区间」这个结构",
                "没有参考区间表、也不能提供区间的场景（无从判断，只能转人工）",
                "需要下诊断或给治疗建议的场景（超出本 Skill 的安全边界）",
            ],
            "safety_rules": [
                "命中危急阈值（value 达到 critical_high 或落到 critical_low 及以下）时，"
                "必须写进 critical_alerts 并在结论里给出「尽快就医/联系临床医生」的提示",
                "全程禁止诊断性断言与用药建议，只描述「数值与参考区间的关系」",
            ],
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
        "note": (
            "参考水平（不是标准答案）：判定口径已在 task.md 里钉死，所以这些值是确定的 —— "
            "用于核对学生的清洗口径、逐项判定、危急值集合与「表外项目判 unknown」是否正确。"
            "硬性判据见 manifest.json 的 assertions，语义判据见 judge.md。"
        ),
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


def run_case(case_dir: Path, out_path: Path) -> None:
    out, _ = read_case(case_dir, Path("."))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[ok] {case_dir.name} → {out_path}")


def regen_expected() -> None:
    """重算 cases/*/expected.json（图写临时目录，不污染用例目录）。"""
    for case_dir in sorted(p for p in CASES_DIR.iterdir() if p.is_dir()):
        with tempfile.TemporaryDirectory() as tmp:
            _, expected = read_case(case_dir, Path(tmp))
        path = case_dir / "expected.json"
        path.write_text(json.dumps(expected, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"[regen] {path}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("case_dir", nargs="?", help="case 目录（含 lab_report.csv / reference_ranges.csv）")
    ap.add_argument("out_path", nargs="?", help="输出 output.json 的路径")
    ap.add_argument("--regen-expected", action="store_true", help="重算 cases/*/expected.json")
    args = ap.parse_args()

    if args.regen_expected:
        regen_expected()
        return
    if not args.case_dir or not args.out_path:
        ap.error("需要 <case目录> <output.json>，或用 --regen-expected")
    run_case(Path(args.case_dir), Path(args.out_path))


if __name__ == "__main__":
    main()
