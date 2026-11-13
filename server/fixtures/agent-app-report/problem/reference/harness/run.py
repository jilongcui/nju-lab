#!/usr/bin/env python3
"""胶水（**不用改**）：读 case 目录里的附件与报告模板，调你的 core，写出 `output.json`。

    python3 harness/run.py <case目录> <output.json>      # 例如：python3 harness/run.py . output.json
    python3 harness/run.py --regen-expected             # 教师侧：重算 expected.json
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import tempfile
from pathlib import Path

import matplotlib

matplotlib.use("Agg")  # 容器内无显示环境
import matplotlib.pyplot as plt  # noqa: E402

HERE = Path(__file__).resolve().parent
APP_DIR = HERE.parent
FIG_NAME = "attachments_overview.png"


def load_core():
    spec = importlib.util.spec_from_file_location("app_harness_api", APP_DIR / "harness" / "api.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)  # type: ignore[union-attr]
    return module


def run_case(case_dir: Path, fig_dir: Path) -> dict:
    core = load_core()
    state = core.load(APP_DIR)
    fmt = json.loads((case_dir / "report_format.json").read_text(encoding="utf-8"))
    att_dir = case_dir / "attachments"

    parsed: list[dict] = []
    rows: list[dict] = []
    for path in sorted(att_dir.iterdir()):
        if not path.is_file():
            continue
        info = {"name": path.name, "kind": kind_of(path.name), "path": str(path),
                "size": path.stat().st_size}
        info.update(core.parse_attachment(info))
        parsed.append(info)
        for row in info["rows"]:
            rows.append({"item": row[0], "value": row[1], "unit": row[2],
                         "flag": core.flag_of(row[0], row[1], fmt["thresholds"])})

    report = core.build_report(state, {"rows": rows, "formats": fmt, "parsed": parsed})
    plot(parsed, fig_dir)

    return {
        "attachments": [{"name": p["name"], "kind": p["kind"], "via": p["via"],
                         "rows": len(p["rows"]), "chars": p["chars"]} for p in parsed],
        "report": report,
        "metrics": {
            "attachments_parsed": len(parsed),
            "total_rows": len(rows),
            "abnormal_rows": report["counts"]["abnormal"],
        },
        "figures": [{
            "path": f"figures/{FIG_NAME}",
            "takeaway": f"三份附件共登记 {len(rows)} 行指标，其中 "
                        f"{report['counts']['abnormal']} 行超出参考区间。",
        }],
        "notes": (
            "先把附件读成结构化行，报告才可能逐行复核：PDF 抽未压缩内容流里的文本操作符、"
            "Word 解 zip 读 document.xml，二者都是标准库；图片没有文本层，只能交给视觉模型。"
            "flag 必须由参考区间判，不能凭感觉；超出区间的行只提示复核，不下诊断结论。"
            "局限：本实验的 PDF 是约定形态（未压缩 + ASCII），真实 PDF 有压缩流与中文字体；"
            "视觉模型对模糊/倾斜的扫描件会读错，需要人工复核。"
        ),
    }


def kind_of(name: str) -> str:
    suffix = Path(name).suffix.lower().lstrip(".")
    if suffix == "pdf":
        return "pdf"
    if suffix == "docx":
        return "docx"
    if suffix in ("png", "jpg", "jpeg"):
        return "image"
    return "other"


def plot(parsed: list[dict], fig_dir: Path) -> None:
    fig_dir.mkdir(parents=True, exist_ok=True)
    labels = [p["name"] for p in parsed]
    values = [len(p["rows"]) for p in parsed]
    plt.figure(figsize=(6, 3.2))
    plt.bar(labels, values, color="#4c72b0")
    plt.title("Metric rows per attachment")
    plt.xlabel("attachment")
    plt.ylabel("rows")
    plt.tight_layout()
    plt.savefig(fig_dir / FIG_NAME, dpi=110)
    plt.close()


def regen_expected() -> None:
    cases = APP_DIR.parent / "cases"
    for case_dir in sorted(p for p in cases.iterdir() if p.is_dir()):
        with tempfile.TemporaryDirectory() as tmp:
            out = run_case(case_dir, Path(tmp))
        fmt = json.loads((case_dir / "report_format.json").read_text(encoding="utf-8"))
        expected = {
            "attachments": out["attachments"],
            "report": {
                "section_names": [s["name"] for s in out["report"]["sections"]],
                "section_min_chars": [s["min_chars"] for s in fmt["sections"]],
                "metric_rows": out["report"]["metric_rows"],
                "counts": out["report"]["counts"],
            },
            "metrics": out["metrics"],
        }
        (case_dir / "expected.json").write_text(
            json.dumps(expected, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"[regen] {case_dir / 'expected.json'}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("case_dir", nargs="?")
    ap.add_argument("out_path", nargs="?")
    ap.add_argument("--regen-expected", action="store_true")
    args = ap.parse_args()
    if args.regen_expected:
        regen_expected()
        return
    if not args.case_dir or not args.out_path:
        ap.error("需要 <case目录> <output.json>，或用 --regen-expected")
    out = run_case(Path(args.case_dir), Path("figures"))
    Path(args.out_path).write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n",
                                   encoding="utf-8")
    print(f"[ok] {args.case_dir} → {args.out_path}")


if __name__ == "__main__":
    main()
