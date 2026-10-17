#!/usr/bin/env python3
"""生成「手写数字分拣」实验的数据（每个 case 一份 data.csv）。

应用场景
--------
邮局/图书馆的表单上有一堆手写数字（单号、借书号……），要自动把 **3 / 8 / 9** 三个数字分开。
选这三个而不是 0/1/2，是因为它们**笔画结构相近、容易混**（3 和 8、8 和 9、3 和 9 都有相似部分），
入门实验里也能看到"网络到底学到了什么"。
数据是 8×8 的小图（每个像素 0~16 的灰度），每行就是一张"压平"的图片 ——
这是深度学习最经典的入门问题之一：**输入是一组数字，输出是类别**。

数据来源
--------
`sklearn.datasets.load_digits`（8×8 手写数字，共 1797 张）。本实验只取 **3 / 8 / 9** 三类，
让网络小、训练快；这三类的笔画结构相近，正好能看出"混淆矩阵"的意义。

两个 case
---------
  case01：全部 3/8/9（约 540 张）
  case02：每类抽 120 张（共 360 张）+ 轻微扫描噪声（±2 灰度的像素抖动）

可解性保证
----------
  · "一律猜最多的数字"（不建模）accuracy ≈ 0.33；
  · 一个 64→32→3 的两层 MLP 训练几十轮，accuracy ≈ 0.95~0.98（3 与 8 偶尔会混）；
  · 判据要求 accuracy ≥ 0.92 且 macro F1 ≥ 0.90 —— 不建模过不了；
    只认两个数字、放弃第三个也过不了（macro F1 会掉下来）。

用法
----
  python3 tools/gen_data.py                 # 生成全部 case 的 data.csv
  python3 tools/gen_data.py --case case01   # 只生成一个

⚠️ 本目录（tools/）**不下发**：它是造题工具，学生拿到的是 problem 包。
"""
from __future__ import annotations

import argparse
import csv
from pathlib import Path

import numpy as np
from sklearn.datasets import load_digits

HERE = Path(__file__).resolve().parent
CASES_DIR = HERE.parent / "problem" / "cases"

CASES = {
    "case01": dict(seed=20261121, per_class=None, jitter=0),
    # case02：每类 120 张 + 扫描噪声（更小、更脏，检验网络稳不稳）
    "case02": dict(seed=20261122, per_class=120, jitter=2),
}

CLASSES = [3, 8, 9]
COLUMNS = [f"p{r}{c}" for r in range(8) for c in range(8)] + ["digit"]


def make_case(case: str, seed: int, per_class: int | None, jitter: int):
    digits = load_digits()
    X = digits.data.astype(np.int16)  # 每行 64 个像素（0~16）
    y = digits.target.astype(np.int16)

    keep = np.isin(y, CLASSES)
    X, y = X[keep], y[keep]

    rng = np.random.default_rng(seed)
    if per_class is None:
        idx = np.arange(len(y))
    else:
        picked = []
        for cls in CLASSES:
            members = np.flatnonzero(y == cls)
            picked.append(rng.choice(members, size=min(per_class, len(members)), replace=False))
        idx = np.sort(np.concatenate(picked))
        rng.shuffle(idx)
    X, y = X[idx], y[idx]

    if jitter > 0:
        # 扫描质量差：每个像素以 10% 的概率抖动 ±jitter 个灰度
        noise = rng.integers(-jitter, jitter + 1, X.shape)
        mask = rng.random(X.shape) < 0.10
        X = np.clip(X + noise * mask, 0, 16)

    case_dir = CASES_DIR / case
    case_dir.mkdir(parents=True, exist_ok=True)
    out = case_dir / "data.csv"
    with out.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(COLUMNS)
        for row, label in zip(X, y):
            w.writerow([*row.tolist(), int(label)])

    counts = {int(c): int((y == c).sum()) for c in CLASSES}
    majority = max(counts.values())
    print(
        f"[{case}] {out.relative_to(HERE.parent)}  n={len(y)}  各类 {counts}  "
        f"像素取值 {int(X.min())}~{int(X.max())}"
    )
    print(
        f"       全判多数类基线：accuracy≈{majority / len(y):.2f}；"
        f"macro F1 更低（只认一类时另外两类的 F1 为 0）"
    )


def main() -> None:
    ap = argparse.ArgumentParser(description="生成手写数字分拣实验的数据")
    ap.add_argument("--case", choices=sorted(CASES), default=None)
    args = ap.parse_args()
    for name, kw in CASES.items():
        if args.case and args.case != name:
            continue
        make_case(name, **kw)


if __name__ == "__main__":
    main()
