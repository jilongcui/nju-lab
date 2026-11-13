"""参考实现（随题目包下发，**先读后仿**）：把三类附件整理成一份能复核的报告。

这一档（easy）只要三件事：

1. `parse_attachment()`：把 PDF / Word / 截图读成"指标, 数值, 单位"的行；
   - PDF / DOCX 用标准库自己解（环境里没有 `pypdf` / `python-docx`）；
   - 图片没有文本层，交给宿主的 `app_host.vision_extract()`（走平台模型代理）。
2. `build_report()`：按 `report_format.json` 出四节报告 + 指标表 + 计数。
3. `load()`：应用元信息（这一档用不到，占位）。

口径见题目包 `task.md`；改了这里的实现，记得用 `--regen-expected` 重算期望值。
"""
from __future__ import annotations

import hashlib
import json
import re
import struct
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app_host import vision_extract  # noqa: E402  （图片走视觉，容器里没有 key）

# TODO 1：把附件读成"指标, 数值, 单位"的行
ROW_PATTERN = re.compile(r"^([A-Za-z][A-Za-z0-9_]*)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(\S+)$")


def text_checksum(lines):
    """行文本的校验和（口径见 task.md）：每行 strip 后用换行连接，取 sha256 前 12 位。"""
    raise NotImplementedError("TODO: 实现")


def parse_pdf(path):
    """PDF：找 `stream … endstream`，抽 `(...) Tj` 里的文本，按出现顺序成行。

    最小示例：`stream` 里出现 `(PLT,18,10^9/L) Tj` → 这一行就是 `PLT,18,10^9/L`。
    """
    raise NotImplementedError("TODO: 实现（标准库：re + bytes）")


def parse_docx(path):
    """Word：`zipfile` 读 `word/document.xml`，每个 `<w:p>` 取其 `<w:t>` 文本拼成一行。"""
    raise NotImplementedError("TODO: 实现（标准库：zipfile + re）")


def parse_attachment(info):
    """按类型分流，返回 {name, kind, via, chars, lines, rows, checksum}。

    图片：`from app_host import vision_extract` 交给宿主（视觉调用走平台代理）。
    """
    raise NotImplementedError("TODO: 实现（三类附件 + via 标注）")


def flag_of(item, value, thresholds):
    """参考区间 → flag：低于下限 low、高于上限 high、其余 normal。"""
    raise NotImplementedError("TODO: 实现（三行代码）")


def build_report(state, ctx):
    """按 `ctx["formats"]` 出四节 + 指标表 + counts(total/abnormal/listed)。"""
    raise NotImplementedError("TODO: 实现（见 task.md 的交付格式）")


def load(app_dir):
    """应用元信息：这一档用不到，返回 {} 即可。"""
    return {}
