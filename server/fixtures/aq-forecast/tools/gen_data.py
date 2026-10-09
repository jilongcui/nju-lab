#!/usr/bin/env python3
"""生成「空气质量估算」实验的数据（每个 case 一份 data.csv）。

应用场景
--------
估算某监测点**下一小时**的 PM2.5 浓度（µg/m³），供值班人员提前提示敏感人群。
数据是用固定种子合成的教学数据（物理直觉合理、可重复生成），不是真实监测数据。

列（data.csv 的表头）
---------------------
  temp            气温 ℃
  humidity        相对湿度 %
  wind_speed      风速 m/s
  pm25_lag1       本监测点**上一小时**的 PM2.5
  pm25_neighbor   周边站点当前 PM2.5（平均）
  hour            当前小时（0-23）
  pm25_next       **目标**：下一小时 PM2.5

可解性保证（这是造题的关键）
---------------------------
  "直接报上一小时"（持久性基线，persistence）的 MAE ≈ 10 µg/m³；
  用上 `pm25_neighbor` / `wind_speed` / `humidity` 的回归模型 MAE ≈ 6 µg/m³。
  判据要求"比持久性基线好 20%"，因此**必须真的用上额外特征**才能达标 ——
  拿 `pm25_lag1` 一列硬套模型是过不了的。

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
    # case01：常规季节
    "case01": dict(seed=20261010, n=600, neighbor_scale=30.0, temp_base=15.0, noise=4.5),
    # case02：冬季重污染（浓度整体更高、波动更大）—— 同一套判据下的另一批数据
    "case02": dict(seed=20261011, n=420, neighbor_scale=48.0, temp_base=4.0, noise=6.0),
}

COLUMNS = ["temp", "humidity", "wind_speed", "pm25_lag1", "pm25_neighbor", "hour", "pm25_next"]


def make_case(case: str, seed: int, n: int, neighbor_scale: float, temp_base: float, noise: float):
    rng = np.random.default_rng(seed)

    hour = rng.integers(0, 24, n)
    humidity = rng.uniform(30.0, 95.0, n)
    wind_speed = np.round(rng.gamma(2.0, 1.1, n), 1)  # 偏态：多数小风、偶尔大风
    temp = temp_base + 7.0 * np.sin((hour - 6) / 24.0 * 2 * np.pi) + rng.normal(0, 3.0, n)

    pm25_neighbor = rng.gamma(3.0, neighbor_scale / 3.0, n)
    pm25_lag1 = np.clip(0.85 * pm25_neighbor + rng.normal(0, neighbor_scale / 5.0, n), 5.0, None)
    pm25_lag1 = np.round(pm25_lag1, 1)

    # "真实规律"：本点前一小时浓度是主因；附近监测站读数、风速（风大浓度低）、湿度也有影响
    pm25_next = (
        0.55 * pm25_lag1
        + 0.30 * pm25_neighbor
        + 0.02 * humidity
        - 1.8 * wind_speed
        + 2.5 * np.cos((hour - 17) / 24.0 * 2 * np.pi)
        + rng.normal(0, noise, n)
    )
    pm25_next = np.round(np.clip(pm25_next, 2.0, None), 1)

    rows = np.column_stack(
        [np.round(temp, 1), np.round(humidity, 1), wind_speed, pm25_lag1, np.round(pm25_neighbor, 1), hour, pm25_next]
    )

    case_dir = CASES_DIR / case
    case_dir.mkdir(parents=True, exist_ok=True)
    out = case_dir / "data.csv"
    with out.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(COLUMNS)
        for r in rows:
            w.writerow([int(v) if c == "hour" else v for v, c in zip(r, COLUMNS)])

    persist_mae = float(np.mean(np.abs(pm25_lag1 - pm25_next)))
    mean_mae = float(np.mean(np.abs(pm25_next.mean() - pm25_next)))
    print(
        f"[{case}] {out.relative_to(HERE.parent)}  n={n}  "
        f"persistence MAE={persist_mae:.2f}  mean-baseline MAE={mean_mae:.2f}  "
        f"达标线(基线的 80%)={persist_mae * 0.8:.2f}"
    )


def main() -> None:
    ap = argparse.ArgumentParser(description="生成空气质量估算实验的数据")
    ap.add_argument("--case", choices=sorted(CASES), default=None)
    args = ap.parse_args()
    for name, kw in CASES.items():
        if args.case and args.case != name:
            continue
        make_case(name, **kw)


if __name__ == "__main__":
    main()
