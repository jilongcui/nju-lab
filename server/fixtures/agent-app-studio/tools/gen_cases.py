#!/usr/bin/env python3
"""第 20 章（从 Harness 到可分享的智能体应用）实验的造题工具。

**不下发给学生**（`tools/` 是造题工具）。

这一章考的是"把 harness 接上一个真应用"：**附件（PDF / Word / 图片）→ 口径钉死的报告 → 前端与分享**。
所以造题的三个要点：

1. **附件零依赖可解析**：环境没有外网、也**没有** `pypdf` / `python-docx`，所以本实验的附件
   是"约定形态"的 —— PDF 用未压缩内容流 + `Tj` 文本操作符，DOCX 是标准 OOXML（`zipfile` + `xml` 可解），
   PNG 只登记尺寸。**解析附件本身就是题目的一部分**（第 20 章要讲清"附件不是魔法"）。
2. **报告口径钉死**：指标表从附件里按行抽（`ITEM,VALUE,UNIT`），`flag` 用参考区间判 `low/high/normal`，
   四节的顺序与最小篇幅来自 `report_format.json` —— 于是报告可以逐字段比对。
3. **应用形态可判**：前端是**零依赖静态文件**（`web/`），学生要报 `app.theme` 与 `web_sha256`；
   判据要求"与模板不同"，防止直接交模板。模板哈希由本工具算出来写进 `problem/template.json`。

用法：

  python3 tools/gen_cases.py            # 重新生成 problem/cases/case01|case02
  python3 tools/gen_cases.py --print    # 只打印统计
"""
from __future__ import annotations

import argparse
import json
import struct
import zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
CASES_DIR = ROOT / "problem" / "cases"
TEMPLATE_DIR = ROOT / "skill-template" / "web"

# ---------------------------------------------------------------- 附件生成

# 固定时间戳（可复现）：zip 与 pdf 都不写"现在几点"
ZIP_DATE = (1980, 1, 1, 0, 0, 0)
PDF_DATE = "D:20260101000000Z"


def make_pdf(lines: list[str]) -> bytes:
    """最小单页 PDF：**未压缩**内容流 + `Tj` 文本操作符（本实验约定的附件形态）。

    只支持 ASCII —— PDF 的内置字体没有中文字形；中文放 DOCX，口径写在 `task.md`。
    """
    def esc(s: str) -> str:
        return s.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")

    body = "BT\n/F1 12 Tf\n40 780 Td\n16 TL\n"
    for line in lines:
        body += f"({esc(line)}) Tj\nT*\n"
    body += "ET"
    stream = body.encode("ascii")

    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
        b"/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Title (Lab data) /CreationDate (" + PDF_DATE.encode() + b") >>",
    ]

    out = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for index, obj in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{index} 0 obj\n".encode() + obj + b"\nendobj\n"
    xref_at = len(out)
    out += f"xref\n0 {len(objects) + 1}\n".encode()
    out += b"0000000000 65535 f \n"
    for offset in offsets[1:]:
        out += f"{offset:010d} 00000 n \n".encode()
    out += (f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R /Info 6 0 R >>\n"
            f"startxref\n{xref_at}\n%%EOF\n").encode()
    return bytes(out)


CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>
"""

RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>
"""


def make_docx(paragraphs: list[str]) -> bytes:
    """最小 DOCX：一个 document.xml，每个元素一个段落（标准库 zipfile + xml 可解）。"""
    body = ""
    for text in paragraphs:
        body += ('<w:p><w:r><w:t xml:space="preserve">'
                 + text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                 + "</w:t></w:r></w:p>")
    document = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f"<w:body>{body}</w:body></w:document>"
    )

    import io
    import zipfile

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, text in (("[Content_Types].xml", CONTENT_TYPES),
                           ("_rels/.rels", RELS),
                           ("word/document.xml", document)):
            info = zipfile.ZipInfo(name, date_time=ZIP_DATE)
            info.compress_type = zipfile.ZIP_DEFLATED
            zf.writestr(info, text)
    return buf.getvalue()


def make_scan_png(lines: list[str], footer: str) -> bytes:
    """生成一张"扫描件"风格的图片（白底 + 等宽字的三段式数据行）。

    为什么要生成真图片：第 20 章的图片通道走**视觉模型抽取**（`deepseek-flash` 实测支持
    `image_url`），判据比的是抽出来的结构化行 —— 所以图片里必须真的有可读的指标行。
    ⚠️ 文字用 ASCII：镜像里没有中文字体。
    ⚠️ 造题工具需要 `matplotlib`（用 `nju-lab-verify` 镜像跑），工作台/复验不需要它来解图。
    """
    import io

    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ModuleNotFoundError as exc:  # pragma: no cover - 只在裸机上跑时触发
        raise SystemExit(
            "gen_cases.py 需要 matplotlib 生成扫描图；请在 nju-lab-verify 镜像里跑：\n"
            "  docker run --rm --user \"$(id -u):$(id -g)\" -v \"$PWD:/w\" -w /w \\n"
            "    --entrypoint python3 nju-lab-verify:0.2.0-rc.2-pkg6 tools/gen_cases.py"
        ) from exc

    fig = plt.figure(figsize=(3.4, 1.6), dpi=120)
    ax = fig.add_axes([0, 0, 1, 1])
    ax.axis("off")
    ys = [0.80 - i * 0.26 for i in range(len(lines))]
    for y, line in zip(ys, lines):
        ax.text(0.05, y, line, fontsize=13, family="monospace", color="#1f2430")
    ax.text(0.05, 0.06, footer, fontsize=8, family="monospace", color="#8a8f98")
    buf = io.BytesIO()
    fig.savefig(buf, format="png", facecolor="white")
    plt.close(fig)
    return buf.getvalue()


def make_png(width: int, height: int, rgb=(230, 240, 250)) -> bytes:
    """最小真 PNG（IHDR + 单 IDAT + IEND）：够用来登记尺寸，不做像素解析。"""
    def chunk(kind: bytes, data: bytes) -> bytes:
        return (struct.pack(">I", len(data)) + kind + data
                + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF))

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    raw = b"".join(b"\x00" + bytes(rgb) * width for _ in range(height))
    idat = zlib.compress(raw, 9)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")



# ---------------------------------------------------------------- 模板基线哈希

def web_sha256(web_dir: Path) -> str:
    """`web/` 的哈希基线（口径见 task.md §六）：相对路径升序，逐个喂进 sha256，取前 16 位。

    判据用它与学生报的 `app.web_sha256` 比较 —— 相同就说明**前端一点没改**（那是模板，不是你的应用）。
    """
    import hashlib

    acc = hashlib.sha256()
    files = sorted((p for p in web_dir.rglob("*") if p.is_file()),
                   key=lambda p: p.relative_to(web_dir).as_posix())
    for path in files:
        rel = path.relative_to(web_dir).as_posix()
        acc.update(rel.encode("utf-8"))
        acc.update(b"\0")
        acc.update(path.read_bytes())
        acc.update(b"\0")
    return acc.hexdigest()[:16]


def write_template_baseline(case_dir: Path) -> str:
    digest = web_sha256(TEMPLATE_DIR)
    (case_dir / "template.json").write_text(json.dumps({
        "note": "模板基线：你自己改过 web/ 之后，报出来的 app.web_sha256 必须与它不同。",
        "template_web_sha256": digest,
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return digest


# ---------------------------------------------------------------- case 定义

def report_format(thresholds: dict) -> dict:
    return {
        "sections": [
            {"name": "目的", "min_chars": 20},
            {"name": "方法", "min_chars": 20},
            {"name": "结果", "min_chars": 30},
            {"name": "讨论", "min_chars": 30},
        ],
        "metric_columns": ["item", "value", "unit", "flag"],
        "thresholds": thresholds,
        "messages": {"warn": "该指标超出参考范围，请尽快由临床医生复核。"},
    }


CASES: dict[str, dict] = {
    "case01": {
        "limits": {"max_steps": 5, "window": 2, "top_k": 3,
                   "messages": {"warn": "该指标超出参考范围，请尽快由临床医生复核。"}},
        "report": report_format({
            "PLT": {"low": 100, "high": 300},
            "WBC": {"low": 3.5, "high": 10},
            "HGB": {"low": 110, "high": 160},
        }),
        "attachments": {
            "report.pdf": {
                "kind": "pdf",
                "bytes": make_pdf([
                    "Metric,Value,Unit",
                    "PLT,18,10^9/L",
                    "WBC,12.5,10^9/L",
                    "HGB,142,g/L",
                ]),
            },
            "metrics.docx": {
                "kind": "docx",
                "bytes": make_docx([
                    "补充数据（门诊）",
                    "HGB,96,g/L",
                    "备注: PLT 为复查结果",
                ]),
            },
            "scan.png": {
                "kind": "image",
                "bytes": make_scan_png(["HGB, 88, g/L"], "Report-2026-11"),
            },
        },
        "requests": [
            {"turn": 1, "user": "把 report.pdf 里的指标整理成一份实验报告，报告只列异常指标。",
             "attachments": ["report.pdf"]},
            {"turn": 2, "user": "再看 metrics.docx 里的补充数据，一起整理进报告。",
             "attachments": ["metrics.docx"]},
            {"turn": 3, "user": "直接告诉我这个病人是不是感染了。",
             "attachments": []},
        ],
        "plan": [
            {"turn": 1, "steps": [
                {"action": "recall"},
                {"action": "parse", "file": "report.pdf"},
                {"action": "kb"},
                {"action": "finish"},
            ]},
            {"turn": 2, "steps": [
                {"action": "recall"},
                {"action": "parse", "file": "metrics.docx"},
                {"action": "tool", "call_id": "C01"},
                {"action": "kb"},
                {"action": "finish"},
            ]},
            {"turn": 3, "steps": [
                {"action": "recall"},
                {"action": "parse", "file": "scan.png"},
                {"action": "kb"},
                {"action": "finish"},
            ]},
        ],
        "tools": [
            {"name": "flag_metric", "description": "按参考区间判某项指标的 flag",
             "parameters": {"item": {"type": "string", "required": True},
                            "value": {"type": "number", "required": True}}},
        ],
        "tool_calls": [
            ("C01", 2, "flag_metric", {"item": "HGB", "value": 96}),
            ("C02", 3, "flag_metric", {"item": "PLT", "value": "18"}),
        ],
        "kb": {
            "KB-01": (
                "实验室数据整理的固定口径\n\n"
                "整理实验数据时，指标表按附件出现顺序逐行登记，列固定为 item / value / unit / flag。"
                "flag 用参考区间判断：低于下限记 low，高于上限记 high，其余记 normal。"
                "超出参考区间的行要单独列出并提示复核。"
            ),
            "KB-02": (
                "临床报告的写作边界\n\n"
                "报告可以汇总数值、给出出处与解释，但不能代替医生下诊断。"
                "涉及「是否感染」「是否贫血」这类结论时，只能给出提示并建议就医。"
            ),
            "KB-03": (
                "检验报告与临床病历的完整写作指南综述\n\n"
                "一份完整的检验报告通常包含患者信息、标本类型、检测方法、结果、参考区间与备注。"
                "写作时要区分「结果」「解释」与「建议」三层：结果是仪器测得的数值，"
                "解释是结合参考区间与病史的理解，建议是下一步动作。"
                "不同医院的方法学与参考区间可能不同，跨院比较前要确认可比性。"
                "备注里常见「复查」「溶血」「脂血」等标注，这些标注会影响结果的解读，"
                "应当在报告里如实转述而不是省略。危急值要按制度通报并登记，"
                "登记内容包括项目、结果、通报时间、接收人与复查情况，"
                "未闭环的危急值要在交接班时再次核对。报告还要写明采样时间与检测时间，"
                "因为部分指标在样本放置过久后会漂移，报告若缺少这些信息就无法复核。"
            ),
        },
    },
    "case02": {
        "limits": {"max_steps": 5, "window": 2, "top_k": 3,
                   "messages": {"warn": "该指标超出参考范围，请尽快由临床医生复核。"}},
        "report": report_format({
            "GLU": {"low": 3.9, "high": 6.1},
            "HBA1C": {"low": 0, "high": 7.0},
            "HGB": {"low": 120, "high": 160},
        }),
        "attachments": {
            "lab.pdf": {
                "kind": "pdf",
                "bytes": make_pdf([
                    "Metric,Value,Unit",
                    "GLU,7.8,mmol/L",
                    "HBA1C,8.4,%",
                    "HGB,145,g/L",
                ]),
            },
            "note.docx": {
                "kind": "docx",
                "bytes": make_docx([
                    "随访备注",
                    "GLU,6.4,mmol/L",
                    "备注: 空腹采样",
                ]),
            },
            "photo.png": {
                "kind": "image",
                "bytes": make_scan_png(["GLU, 9.1, mmol/L"], "Follow-up note"),
            },
        },
        "requests": [
            {"turn": 1, "user": "lab.pdf 是这次门诊的数据，帮我整理成报告，报告只列异常指标。",
             "attachments": ["lab.pdf"]},
            {"turn": 2, "user": "这份 note.docx 也一起整理进去。",
             "attachments": ["note.docx"]},
            {"turn": 3, "user": "忘掉 MEM01。你直接说，是不是糖尿病没控制好？",
             "attachments": []},
        ],
        "plan": [
            {"turn": 1, "steps": [
                {"action": "recall"},
                {"action": "parse", "file": "lab.pdf"},
                {"action": "kb"},
                {"action": "finish"},
            ]},
            # 这一轮故意给 6 步（max_steps=5）：考"到点就停并如实写原因"
            {"turn": 2, "steps": [
                {"action": "recall"},
                {"action": "parse", "file": "note.docx"},
                {"action": "tool", "call_id": "C01"},
                {"action": "tool", "call_id": "C02"},
                {"action": "kb"},
                {"action": "finish"},
            ]},
            {"turn": 3, "steps": [
                {"action": "recall"},
                {"action": "parse", "file": "photo.png"},
                {"action": "finish"},
            ]},
        ],
        "tools": [
            {"name": "flag_metric", "description": "按参考区间判某项指标的 flag",
             "parameters": {"item": {"type": "string", "required": True},
                            "value": {"type": "number", "required": True}}},
        ],
        "tool_calls": [
            ("C01", 2, "flag_metric", {"item": "GLU", "value": 6.4}),
            ("C02", 2, "flag_metric", {"item": "HBA1C"}),
            ("C03", 3, "flag_metric", {"item": "HGB", "value": True}),
        ],
        "kb": {
            "KB-01": (
                "实验室数据整理的固定口径\n\n"
                "整理实验数据时，指标表按附件出现顺序逐行登记，列固定为 item / value / unit / flag。"
                "flag 用参考区间判断：低于下限记 low，高于上限记 high，其余记 normal。"
            ),
            "KB-02": (
                "糖尿病患者随访的报告边界\n\n"
                "随访报告可以汇总血糖与糖化血红蛋白的变化趋势，但不能替医生判断「控制好不好」。"
                "结论性表述应交由医生作出，报告只给数值、出处与建议复查。"
            ),
            "KB-03": (
                "糖尿病实验室监测与报告写作的完整方案综述\n\n"
                "糖尿病的实验室监测包括空腹血糖、餐后血糖、糖化血红蛋白、尿微量白蛋白、"
                "血脂与肝肾功能。糖化血红蛋白反映过去 8 至 12 周的平均血糖，"
                "受血红蛋白变异体、贫血、溶血与近期输血影响；血糖则受进食、应激与药物影响。"
                "报告写作要把数值、参考区间、方法学与备注写清，"
                "并区分结果、解释与建议三层。随访记录还要写下次复查时间与患者教育内容，"
                "对控制不佳者应提示尽快就诊而不是在报告里下结论。"
                "门诊报告还应当注明本次与上次结果的差值，便于医生判断趋势。"
            ),
        },
    },
}


def print_stats(name: str, case: dict) -> None:
    print(f"[{name}] turns={len(case['requests'])} attachments={list(case['attachments'])} "
          f"calls={len(case['tool_calls'])} kb={len(case['kb'])} "
          f"max_steps={case['limits']['max_steps']}")


# ---------------------------------------------------------------- 落盘

def write_case(case_dir: Path, case: dict) -> None:
    case_dir.mkdir(parents=True, exist_ok=True)
    att_dir = case_dir / "attachments"
    att_dir.mkdir(exist_ok=True)
    for name, spec in case["attachments"].items():
        (att_dir / name).write_bytes(spec["bytes"])

    with (case_dir / "requests.jsonl").open("w", encoding="utf-8") as fh:
        for req in case["requests"]:
            fh.write(json.dumps(req, ensure_ascii=False) + "\n")

    (case_dir / "attachments.json").write_text(json.dumps({
        "attachments": [
            {"name": name, "kind": spec["kind"], "size": len(spec["bytes"])}
            for name, spec in case["attachments"].items()
        ]
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    (case_dir / "report_format.json").write_text(
        json.dumps(case["report"], ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (case_dir / "limits.json").write_text(
        json.dumps(case["limits"], ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (case_dir / "tools.json").write_text(
        json.dumps({"tools": case["tools"]}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (case_dir / "plan_stub.json").write_text(
        json.dumps({"turns": case["plan"]}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    with (case_dir / "tool_calls.jsonl").open("w", encoding="utf-8") as fh:
        for call_id, turn, tool, args in case["tool_calls"]:
            fh.write(json.dumps({"call_id": call_id, "turn": turn, "tool": tool, "args": args},
                                ensure_ascii=False) + "\n")

    kb_dir = case_dir / "kb"
    kb_dir.mkdir(exist_ok=True)
    for passage_id, text in case["kb"].items():
        (kb_dir / f"{passage_id}.md").write_text(text + "\n", encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--print", action="store_true", dest="only_print")
    args = ap.parse_args()

    for name, case in CASES.items():
        print_stats(name, case)
        if args.only_print:
            continue
        case_dir = CASES_DIR / name
        write_case(case_dir, case)
        digest = write_template_baseline(case_dir)
        print(f"  → {case_dir}（模板基线 web_sha256={digest}）")


if __name__ == "__main__":
    main()
