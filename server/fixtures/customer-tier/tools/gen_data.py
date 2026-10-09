#!/usr/bin/env python3
"""生成「会员价值分级」实验的数据（每个 case 一份 data.csv）。

应用场景
--------
一家零售/服务平台想把会员分成 **低 / 中 / 高** 三档（`tier`），好分配不同的运营资源
（优惠券、专属客服、复购提醒）。要求**每一档都分准**：只把"高价值"认出来、把中低档
混在一起，运营策略就没法落地。

数据是固定种子合成的教学数据，列名与规律都取自日常经验，不需要任何领域知识。

列（data.csv 的表头）
---------------------
  monthly_spend       月均消费（元）
  visits_per_month    月均到店/下单次数
  months_since_signup 注册至今月数
  avg_order_value     客单价（元）
  support_tickets     近半年客服工单数（越多说明体验越差）
  tier                **目标**：价值档位（0=低, 1=中, 2=高）

可解性保证（造题关键）
---------------------
  三档比例约 40% / 35% / 25% ⇒ "全判多数类（低档）"这个**不做预测的基线**：
  accuracy 约 0.40，但 macro F1 只有约 0.19（另两档 F1 为 0）—— 多分类里"准确率一样骗人"。
  判据同时要求 macro F1 与**每类召回下限**：前者防"只保大类"，后者防"完全放弃某一档"。

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
    # case01：常规门店/季度（三档比例约 40/35/25）
    "case01": dict(seed=20261030, n=900, noise=0.45),
    # case02：另一家门店（规模小、特征分布略有偏移）
    "case02": dict(seed=20261031, n=600, noise=0.55),
}

COLUMNS = ["monthly_spend", "visits_per_month", "months_since_signup", "avg_order_value", "support_tickets", "tier"]
# 分档用的分位点（低 < 40% <= 中 < 75% <= 高）
QUANTILES = (0.40, 0.75)


def make_case(case: str, seed: int, n: int, noise: float) -> None:
    rng = np.random.default_rng(seed)

    monthly_spend = np.round(rng.gamma(2.0, 400.0, n), 1)          # 长尾：多数中等、少数高消费
    visits_per_month = np.clip(np.round(rng.normal(4.0, 1.8, n), 1), 0, 15)
    months_since_signup = rng.integers(1, 61, n)
    avg_order_value = np.round(rng.gamma(2.0, 60.0, n), 1)
    support_tickets = np.clip(rng.poisson(0.8, n), 0, 6)

    # "真实规律"：消费/频次/客单价越高、注册越久、工单越少 → 价值越高（+ 个体噪声）
    latent = (
        0.0009 * monthly_spend
        + 0.35 * visits_per_month
        + 0.030 * months_since_signup
        + 0.004 * avg_order_value
        - 0.25 * support_tickets
        + rng.normal(0, noise, n)
    )
    lo, hi = np.quantile(latent, QUANTILES)
    tier = np.where(latent < lo, 0, np.where(latent < hi, 1, 2))

    rows = np.column_stack([monthly_spend, visits_per_month, months_since_signup, avg_order_value, support_tickets, tier])
    case_dir = CASES_DIR / case
    case_dir.mkdir(parents=True, exist_ok=True)
    out = case_dir / "data.csv"
    with out.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(COLUMNS)
        for r in rows:
            w.writerow([int(v) if c in ("months_since_signup", "support_tickets", "tier") else v
                        for v, c in zip(r, COLUMNS)])

    dist = [(int((tier == k).sum()), float((tier == k).mean())) for k in (0, 1, 2)]
    majority = max(dist, key=lambda x: x[1])
    print(
        f"[{case}] {out.relative_to(HERE.parent)}  n={n}  "
        f"低/中/高 = {dist[0][0]}/{dist[1][0]}/{dist[2][0]} "
        f"({dist[0][1]:.0%}/{dist[1][1]:.0%}/{dist[2][1]:.0%})  "
        f"| 基线『全判多数类』accuracy={majority[1]:.2f}, macro F1≈{2 * majority[1] / 3 / 3:.2f}"
    )


def main() -> None:
    ap = argparse.ArgumentParser(description="生成会员价值分级实验的数据")
    ap.add_argument("--case", choices=sorted(CASES), default=None)
    args = ap.parse_args()
    for name, kw in CASES.items():
        if args.case and args.case != name:
            continue
        make_case(name, **kw)


if __name__ == "__main__":
    main()
