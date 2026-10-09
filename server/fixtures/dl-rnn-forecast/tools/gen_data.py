#!/usr/bin/env python3
"""生成「传感器时序下一值预测」实验的数据（每个 case 一份 data.csv）。

应用场景
--------
某车间/机房按分钟采集设备传感器读数。运维同学需要**提前一分钟**估计设备温度
（`temp_next`），用于在过热前调低负载 —— 这是排班表上真实存在的需求。

数据是**固定种子合成的教学时序**（不是真实设备日志）：规律符合常识、可重复生成。
生成方式（与 task.md 的数据字典一致）：

    work_cycle_t = 3.2·sin(2π·t / 45 − π/2)                  （**工作循环约 45 分钟**：负载的节奏）
    day_cycle_t  = 0.8·sin(2π·t / 1440)                       （日周期，幅度小、慢）
    current_t    = 20 + work_cycle_t + day_cycle_t + N(0, 0.6)      （负载/电流读数）
    thermal_t    = thermal_{t-1} + 0.35·(current_t − thermal_{t-1}) （热惯性：约 3 分钟时间常数）
    vibration_t  = 0.6·vibration_{t-1} + 0.4·current_t + N(0, 0.2)
    slow_t       = 34 + 1.6·work_cycle_t + 0.6·(thermal_t − 20) + 工况台阶
    temp_t       = slow_t + N(0, σ)                           （仪表读数带噪声，噪声很小）
    temp_next    = temp_{t+1}                                 （目标：下一分钟的温度）

关键点：温度由**45 分钟的工作循环**带动（每循环上下 ~10 ℃），而"下一分钟往哪走"
取决于当前处在循环的哪个位置（上升 / 下降 / 拐点）—— 这个位置**只能从最近一段读数看出来**
（它不是"整点"，没有现成的时间特征可用），而单个当前值给不出方向。
所以"直接把当前时刻的读数当下一秒"（持久性基线）误差明显更大，**用上一段历史窗口**才能明显更好。

两个 case（同一应用的两批数据）
--------------------------------
  case01：常规工况（1500 分钟）
  case02：**工况变了**的那一批（1200 分钟）—— 工作循环变成 37 分钟、中段负载整体抬升 6 ℃、
          读数噪声更大，死记"上一段历史"的做法会吃亏，窗口里必须真的学到规律

用法
----
  python3 tools/gen_data.py              # 生成全部 case 的 data.csv
  python3 tools/gen_data.py --case case02

⚠️ 本目录（tools/）**不下发**：它是造题工具，学生拿到的是 problem 包。
"""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
CASES_DIR = HERE.parent / "problem" / "cases"

PER_DAY = 1440  # 一分钟一个点，一天 1440 点

CASES = {
    # case01：常规工况
    "case01": dict(seed=20270601, n=1500, load_shift=0.0, cycle_scale=45.0, noise=0.12),
    # case02：工况漂移（中段负载抬升 + 周期幅度变化 + 噪声更大）
    "case02": dict(seed=20270602, n=1200, load_shift=6.0, cycle_scale=37.0, noise=0.20),
}


def make_case(seed: int, n: int, load_shift: float, cycle_scale: float, noise: float) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    t = np.arange(n + 2)  # 多生成两步：好让最后一行也有 temp_next

    day_phase = 2 * np.pi * (t % PER_DAY) / PER_DAY
    work_cycle = 3.2 * np.sin(2 * np.pi * t / cycle_scale - np.pi / 2)      # 工作循环（周期 = cycle_scale 分钟）
    day_cycle = 0.8 * np.sin(day_phase)
    # 工况台阶（case02 才有）：后 40% 时间整体抬升
    step = np.where(t >= 0.6 * n, load_shift, 0.0)

    ambient = 22.0 + 4.0 * np.sin(day_phase) + rng.normal(0, 0.4, len(t))
    current = 20.0 + work_cycle + day_cycle + rng.normal(0, 0.6, len(t))    # 负载读数

    thermal = np.zeros(len(t))
    vibration = np.zeros(len(t))
    thermal[0] = current[0]
    for i in range(1, len(t)):
        thermal[i] = thermal[i - 1] + 0.35 * (current[i] - thermal[i - 1])  # 热惯性
        vibration[i] = 0.6 * vibration[i - 1] + 0.4 * current[i] + rng.normal(0, 0.2)
    slow = 34.0 + 1.6 * work_cycle + 0.6 * (thermal - 20.0) + step
    temp = slow + rng.normal(0, noise)                                      # 读数噪声

    df = pd.DataFrame(
        {
            "minute_of_day": (t[:-1] % PER_DAY).astype(int),
            "ambient": ambient[:-1].round(3),
            "current": current[:-1].round(3),
            "vibration": vibration[:-1].round(3),
            "temp": temp[:-1].round(3),
            "temp_next": temp[1:].round(3),
        }
    ).iloc[:-1]  # 最后一行没有"下一分钟"
    return df.reset_index(drop=True)


def main() -> None:
    ap = argparse.ArgumentParser(description="生成「传感器时序下一值预测」实验的数据")
    ap.add_argument("--case", choices=sorted(CASES), help="只生成一个 case")
    args = ap.parse_args()

    names = [args.case] if args.case else sorted(CASES)
    for name in names:
        df = make_case(**CASES[name])
        out_dir = CASES_DIR / name
        out_dir.mkdir(parents=True, exist_ok=True)
        path = out_dir / "data.csv"
        df.to_csv(path, index=False)
        print(
            f"[gen] {path}  n={len(df)}  temp {df['temp'].min():.1f}~{df['temp'].max():.1f}  "
            f"temp_next {df['temp_next'].min():.1f}~{df['temp_next'].max():.1f}  "
            f"持久性基线(相邻差)MAE≈{df['temp_next'].sub(df['temp']).abs().mean():.3f}"
        )


if __name__ == "__main__":
    main()
