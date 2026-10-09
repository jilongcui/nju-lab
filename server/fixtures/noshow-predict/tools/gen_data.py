#!/usr/bin/env python3
"""生成「门诊预约失约预测」实验的数据（每个 case 一份 data.csv）。

应用场景
--------
门诊预约制下，患者预约后可能不来（no-show）。运营团队想提前找出**高风险**预约，
打电话提醒或调整排班 —— 漏掉一个高风险预约，就等于浪费一个号源。

数据是固定种子合成的**教学数据**（不是真实患者数据），规律符合常识、可重复生成。

列（data.csv 的表头）
---------------------
  age              年龄
  lead_days        预约提前天数（越早约，越容易变卦）
  prior_noshow     既往失约次数
  distance_km      到院距离（km，越远越容易失约）
  reminder_called  是否已电话提醒（1=已提醒）
  noshow           **目标**：是否失约（1=没来）

可解性保证（造题关键）
---------------------
  失约率约 20% ⇒ "一律认为患者会来"（现有做法）的 accuracy ≈ 0.8，但对失约者的
  recall = 0（一个都没抓到）—— 所以：
    * 只看 accuracy 会得出"现有做法已经 80% 正确"的错误结论；
    * 达标线同时要求 recall 与 precision，既防"什么都不抓"，也防"全判失约"（precision 会很低）。

用法
----
  python3 tools/gen_data.py                 # 生成全部 case
  python3 tools/gen_data.py --case case01

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
    # case01：常规门诊（失约率约 20%）
    "case01": dict(seed=20261020, n=800, intercept=-2.86, reminder_effect=-1.00),
    # case02：另一家医院/另一季度（失约率略高、电话提醒的效果略弱）
    "case02": dict(seed=20261021, n=600, intercept=-2.70, reminder_effect=-0.90),
}

COLUMNS = ["age", "lead_days", "prior_noshow", "distance_km", "reminder_called", "noshow"]


def make_case(case: str, seed: int, n: int, intercept: float, reminder_effect: float) -> None:
    rng = np.random.default_rng(seed)

    age = rng.integers(18, 80, n)
    lead_days = rng.integers(1, 31, n)
    prior_noshow = np.clip(rng.poisson(0.35, n), 0, 5)
    distance_km = np.round(rng.gamma(2.0, 3.0, n), 1)
    reminder_called = rng.integers(0, 2, n)

    # "真实规律"：越早约、既往失约越多、越远，越可能失约；已电话提醒则明显降低
    logit = (
        intercept
        + 0.12 * lead_days
        + 1.20 * prior_noshow
        + 0.08 * distance_km
        + reminder_effect * reminder_called
        - 0.015 * age
    )
    p = 1.0 / (1.0 + np.exp(-logit))
    noshow = (rng.random(n) < p).astype(int)

    rows = np.column_stack([age, lead_days, prior_noshow, distance_km, reminder_called, noshow])
    case_dir = CASES_DIR / case
    case_dir.mkdir(parents=True, exist_ok=True)
    out = case_dir / "data.csv"
    with out.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(COLUMNS)
        for r in rows:
            w.writerow([int(v) if c in ("age", "lead_days", "prior_noshow", "reminder_called", "noshow") else v
                        for v, c in zip(r, COLUMNS)])

    rate = float(noshow.mean())
    print(
        f"[{case}] {out.relative_to(HERE.parent)}  n={n}  失约率={rate:.1%}  "
        f"（现有做法『一律认为会来』: accuracy={1 - rate:.2f}, recall=0.00）"
    )


def main() -> None:
    ap = argparse.ArgumentParser(description="生成门诊预约失约预测实验的数据")
    ap.add_argument("--case", choices=sorted(CASES), default=None)
    args = ap.parse_args()
    for name, kw in CASES.items():
        if args.case and args.case != name:
            continue
        make_case(name, **kw)


if __name__ == "__main__":
    main()
