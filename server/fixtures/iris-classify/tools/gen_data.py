#!/usr/bin/env python3
"""生成「鸢尾花品种识别」实验的数据（每个 case 一份 data.csv）。

应用场景
--------
园艺场的同学量了一批鸢尾花的花瓣尺寸，想按尺寸判断品种（setosa / versicolor / virginica），
好分类摆放、也方便给顾客介绍。这是一个**入门级三分类**问题：只有两个特征，
画出来就是一张散点图，肉眼也能看出大概规律。

数据来源
--------
`sklearn.datasets.load_iris` 是机器学习里最经典的入门数据集（150 行，3 类各 50 行）。
本脚本只取其中**两个特征**（花瓣长度、花瓣宽度，单位 cm）—— 两个特征刚好能画成一张图，
"看数据"这一步才真的看得懂。目标列换成品种名（英文），避免中文列名在容器里出问题。

两个 case（同一套判据下的两批数据）
----------------------------------
  case01：全部 150 行（3 类各 50）
  case02：每类抽 40 行、共 120 行（固定种子）—— 样本更少，看方案是否还稳

可解性保证
----------
  · "一律猜最常见的品种"（不建模）accuracy ≈ 0.33、macro F1 ≈ 0.17；
  · 用两个花瓣特征做逻辑回归 accuracy ≈ 0.95；
  · 判据要求 accuracy ≥ 0.90 且 macro F1 ≥ 0.85 —— 不建模过不了；
    只认 setosa / versicolor 而放弃 virginica 也过不了（macro F1 会掉下来）。

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
from sklearn.datasets import load_iris

HERE = Path(__file__).resolve().parent
CASES_DIR = HERE.parent / "problem" / "cases"

CASES = {
    # case01：全量 150 行
    "case01": dict(seed=20261101, per_class=None),
    # case02：每类 40 行 + 手工测量误差（更小的样本量、更脏的数据，检验方案稳不稳）
    "case02": dict(seed=20261102, per_class=40, noise=0.15),
}

COLUMNS = ["petal_length_cm", "petal_width_cm", "species"]
CLASS_NAMES = ["setosa", "versicolor", "virginica"]
PETAL_LENGTH, PETAL_WIDTH = 2, 3  # load_iris 的特征下标


def make_case(case: str, seed: int, per_class: int | None, noise: float = 0.0):
    iris = load_iris()
    X = iris.data[:, [PETAL_LENGTH, PETAL_WIDTH]]
    y = np.asarray(iris.target)

    rng = np.random.default_rng(seed)
    if noise > 0:
        # 手工用尺子量的误差：±0.15cm 左右（高斯），让"完全分开"变成"大部分分得开"
        X = np.clip(X + rng.normal(0.0, noise, X.shape), 0.0, None)
    if per_class is None:
        idx = np.arange(len(y))
    else:
        picked = []
        for cls in range(len(CLASS_NAMES)):
            members = np.flatnonzero(y == cls)
            picked.append(rng.choice(members, size=min(per_class, len(members)), replace=False))
        idx = np.sort(np.concatenate(picked))
        rng.shuffle(idx)

    rows = [
        (f"{X[i, 0]:.1f}", f"{X[i, 1]:.1f}", CLASS_NAMES[int(y[i])])
        for i in idx
    ]

    case_dir = CASES_DIR / case
    case_dir.mkdir(parents=True, exist_ok=True)
    out = case_dir / "data.csv"
    with out.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(COLUMNS)
        w.writerows(rows)

    counts = {name: sum(1 for r in rows if r[2] == name) for name in CLASS_NAMES}
    lengths = np.array([float(r[0]) for r in rows])
    widths = np.array([float(r[1]) for r in rows])
    majority = max(counts.values())
    print(
        f"[{case}] {out.relative_to(HERE.parent)}  n={len(rows)}  "
        f"各类 {counts}  "
        f"花瓣长 {lengths.min():.1f}~{lengths.max():.1f}cm / 宽 {widths.min():.1f}~{widths.max():.1f}cm"
    )
    # "一律猜最常见品种"的成绩（这就是实验里的基线）
    print(
        f"       全判多数类基线：accuracy≈{majority / len(rows):.2f}；"
        f"macro F1 更低（只认一类时另外两类的 F1 为 0，具体值由参考实现在测试集上算）"
    )


def main() -> None:
    ap = argparse.ArgumentParser(description="生成鸢尾花品种识别实验的数据")
    ap.add_argument("--case", choices=sorted(CASES), default=None)
    args = ap.parse_args()
    for name, kw in CASES.items():
        if args.case and args.case != name:
            continue
        make_case(name, **kw)


if __name__ == "__main__":
    main()
