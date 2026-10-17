#!/usr/bin/env python3
"""生成「按练习情况估算期末成绩」实验的数据（每个 case 一份 data.csv）。

应用场景
--------
辅导班的老师想按学生的**每周练习时长**和**出勤率**，估一个期末成绩，好提前发现需要补课的人。
这是个**入门级回归**问题：两个特征、一个数值目标，散点图就能看出规律。

数据规律（为什么需要"会拐弯"的模型）
----------------------------------
  成绩 ≈ 100 × (1 − e^(−0.09 × 练习时长 − 0.9 × 出勤率)) + 噪声
  —— 典型的**饱和曲线**：练得越多分数越高，但**收益递减**（练到一定程度再练也提不了几分）。
  用一条直线去拟合，中间段一定系统性偏差；一层隐藏层的小网络就能把这条曲线学出来。

可解性保证
----------
  · "一律报平均分"（不建模）的 MAE ≈ 12~16 分；
  · 只用一条直线拟合的 MAE ≈ 7~9 分（饱和曲线学不像：中间段被系统性低估/高估）；
  · 两层小网络的 MAE ≈ 4~5 分（能把曲线学出来）；
  · 判据要求"MAE 比平均分基线低 ≥45%"，不建模过不了；线卡在直线与网络之间，
    所以**真的拟合出曲线**才稳。

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
    # case01：正常一个班
    "case01": dict(seed=20261201, n=240, noise=5.0, hours=(0.0, 26.0), att=(0.50, 1.00)),
    # case02：另一个班，考核更松、记录更粗（噪声更大）
    "case02": dict(seed=20261202, n=180, noise=6.0, hours=(0.0, 24.0), att=(0.55, 1.00)),
}

COLUMNS = ["weekly_hours", "attendance_rate", "final_score"]


def fit_line(x: np.ndarray, y: np.ndarray) -> tuple[float, float]:
    """最小二乘闭式解（造题时量"直线能做到多少"，不是学生要写的代码）。"""
    b = float(np.cov(x, y, bias=True)[0, 1] / np.var(x))
    a = float(y.mean() - b * x.mean())
    return a, b


def make_case(
    case: str,
    seed: int,
    n: int,
    noise: float,
    hours: tuple[float, float],
    att: tuple[float, float],
):
    rng = np.random.default_rng(seed)
    weekly_hours = np.round(rng.uniform(hours[0], hours[1], n), 1)
    attendance = np.round(rng.uniform(att[0], att[1], n), 2)

    # "真实规律"：饱和曲线 + 噪声
    true_score = 100.0 * (1.0 - np.exp(-0.16 * weekly_hours - 0.8 * attendance))
    score = np.clip(true_score + rng.normal(0.0, noise, n), 0.0, 100.0)
    score = np.round(score, 1)

    rows = [
        (f"{h:.1f}", f"{a:.2f}", f"{s:.1f}")
        for h, a, s in zip(weekly_hours, attendance, score)
    ]
    case_dir = CASES_DIR / case
    case_dir.mkdir(parents=True, exist_ok=True)
    out = case_dir / "data.csv"
    with out.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(COLUMNS)
        w.writerows(rows)

    # 量出两端：一律报平均分 vs 线性回归
    mean_mae = float(np.mean(np.abs(score - score.mean())))
    a, b1 = fit_line(weekly_hours, score)
    a2, b2 = fit_line(attendance, score)
    linear_pred = a + b1 * weekly_hours
    linear_pred2 = a2 + b2 * attendance
    linear_mae = float(min(np.mean(np.abs(score - linear_pred)), np.mean(np.abs(score - linear_pred2))))
    print(
        f"[{case}] {out.relative_to(HERE.parent)}  n={n}  "
        f"练习 {weekly_hours.min():.1f}~{weekly_hours.max():.1f}h/周  出勤 {attendance.min():.2f}~{attendance.max():.2f}  "
        f"成绩 {score.min():.1f}~{score.max():.1f}（均值 {score.mean():.1f}）"
    )
    print(
        f"       平均分基线 MAE≈{mean_mae:.2f}；单特征直线 MAE≈{linear_mae:.2f}"
        f"（比值 {linear_mae / mean_mae:.2f}）；达标线 {mean_mae * 0.55:.2f}（基线的 55%）"
    )


def main() -> None:
    ap = argparse.ArgumentParser(description="生成按练习情况估算成绩实验的数据")
    ap.add_argument("--case", choices=sorted(CASES), default=None)
    args = ap.parse_args()
    for name, kw in CASES.items():
        if args.case and args.case != name:
            continue
        make_case(name, **kw)


if __name__ == "__main__":
    main()
