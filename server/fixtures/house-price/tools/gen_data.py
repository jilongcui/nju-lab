#!/usr/bin/env python3
"""生成「按面积估算房价」实验的数据（每个 case 一份 data.csv）。

应用场景
--------
房产中介要按**面积**给房子估一个挂牌价：客户报个面积，中介先给个参考价，
再带看、再细谈。这是一个**入门级回归**问题：只有一个特征，画出来就是一张散点图。

数据规律（为什么需要模型）
------------------------
  总价 = 固定价值（地段/装修）+ 单价 × 面积 + 噪声
  —— 所以"直接用平均单价乘面积"会**系统性高估小户型、低估大户型**（固定价值被摊薄了）。
  这正是"不建模 vs 建模"的差距来源。

可解性保证
----------
  · 现有做法（按全市平均单价 × 面积报价）的 MAE ≈ 9~10 万元；
  · 一元线性回归（面积 + 截距）的 MAE ≈ 5~6 万元；
  · 判据要求"MAE 比现有做法低 ≥25%"，因此**必须真的拟合出截距**（不能只乘一个单价）。

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

HERE = Path(__file__).resolve().parent
CASES_DIR = HERE.parent / "problem" / "cases"

CASES = {
    # case01：一线城市，单价高、房子大
    "case01": dict(seed=20261111, n=200, intercept=30.0, per_m2=2.8, noise=8.0, area=(40.0, 150.0)),
    # case02：小城市，单价低、房子小（同一套判据下的另一批数据）
    "case02": dict(seed=20261112, n=150, intercept=22.0, per_m2=2.2, noise=7.0, area=(35.0, 130.0)),
}

COLUMNS = ["area_m2", "total_price_wan"]


def fit_line(x: np.ndarray, y: np.ndarray) -> tuple[float, float]:
    """最小二乘闭式解（只为在造题时量出"模型能做到多少"，不是学生要写的代码）。"""
    b = float(np.cov(x, y, bias=True)[0, 1] / np.var(x))
    a = float(y.mean() - b * x.mean())
    return a, b


def make_case(
    case: str,
    seed: int,
    n: int,
    intercept: float,
    per_m2: float,
    noise: float,
    area: tuple[float, float],
):
    rng = np.random.default_rng(seed)
    area_m2 = np.round(rng.uniform(area[0], area[1], n), 1)
    total = intercept + per_m2 * area_m2 + rng.normal(0.0, noise, n)
    total = np.round(np.clip(total, 20.0, None), 1)

    rows = [(f"{a:.1f}", f"{p:.1f}") for a, p in zip(area_m2, total)]
    case_dir = CASES_DIR / case
    case_dir.mkdir(parents=True, exist_ok=True)
    out = case_dir / "data.csv"
    with out.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(COLUMNS)
        w.writerows(rows)

    # 量出两端的成绩：现有做法（平均单价 × 面积）vs 一元线性回归
    unit = float((total / area_m2).mean())
    baseline_mae = float(np.mean(np.abs(total - unit * area_m2)))
    a, b = fit_line(area_m2, total)
    model_mae = float(np.mean(np.abs(total - (a + b * area_m2))))
    print(
        f"[{case}] {out.relative_to(HERE.parent)}  n={n}  "
        f"面积 {area_m2.min():.1f}~{area_m2.max():.1f}m²  总价 {total.min():.1f}~{total.max():.1f} 万元"
    )
    print(
        f"       平均单价 {unit:.2f} 万元/m²；现有做法 MAE≈{baseline_mae:.2f}；"
        f"线性回归 MAE≈{model_mae:.2f}（比值 {model_mae / baseline_mae:.2f}）；"
        f"达标线 {baseline_mae * 0.75:.2f}"
    )


def main() -> None:
    ap = argparse.ArgumentParser(description="生成按面积估算房价实验的数据")
    ap.add_argument("--case", choices=sorted(CASES), default=None)
    args = ap.parse_args()
    for name, kw in CASES.items():
        if args.case and args.case != name:
            continue
        make_case(name, **kw)


if __name__ == "__main__":
    main()
