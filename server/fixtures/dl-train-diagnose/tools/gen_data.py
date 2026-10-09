#!/usr/bin/env python3
"""生成「训练诊断」实验的数据（每个 case 一份 data.csv）。

应用场景
--------
细胞核形态测量 → 判断样本是**恶性**还是良性（辅助筛查：宁可多报，不能漏报）。
数据取自 sklearn 打包的**公开数据集** `load_breast_cancer`（UCI Breast Cancer
Wisconsin，569 条真实测量记录），再按 case 做可复现的改造 —— 不是合成数据。

两个 case（同一应用的两批数据）
-------------------------------
  case01：全量 569 条，原始尺度（恶性 37%）
  case02：模拟"**另一台仪器**"送来的 320 条 ——
          · 每一列的**量程/增益**都不同（某些列比 case01 大两个数量级以上）
          · 叠加约 5% 的相对测量噪声（仪器重复性误差）
          · 恶性样本更少（约 22%，样本量也更小 → 更容易过拟合）

可解性保证（造题的关键）
-----------------------
  现有做法（**按出厂参考上限判**：`mean_radius > 15` 即报恶性）在 case02 上直接失效
  （量程变了 → 几乎全部判良性，recall ≈ 0）；
  只做标准化 + 训练一个小 MLP 就能在两批数据上把恶性样本的 recall 做到 0.9 以上。
  判据因此要求 "recall ≥ 0.90 且 precision ≥ 0.80" —— 不真训练、不做标准化都过不了。

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
from sklearn.datasets import load_breast_cancer

HERE = Path(__file__).resolve().parent
CASES_DIR = HERE.parent / "problem" / "cases"

TARGET = "malignant"  # 1 = 恶性（需要检出的那一类）

CASES = {
    # case01：全量、原始尺度
    "case01": dict(seed=20270301, n_rows=None, malignant_rate=None, gain_span=0.0, noise=0.0),
    # case02：另一台仪器（量程/增益不同）+ 样本更少 + 恶性更少（不平衡）
    "case02": dict(seed=20270302, n_rows=320, malignant_rate=0.22, gain_span=2.5, noise=0.05),
}


def feature_frame() -> pd.DataFrame:
    """公开数据集 → 特征表（列名统一成 snake_case）。"""
    bunch = load_breast_cancer()
    names = [n.replace(" ", "_") for n in bunch.feature_names]
    df = pd.DataFrame(bunch.data, columns=names)
    df[TARGET] = 1 - bunch.target  # sklearn: 0 = malignant → 我们让 1 = 恶性
    return df


def make_case(seed: int, n_rows: int | None, malignant_rate: float | None, gain_span: float, noise: float):
    df = feature_frame()
    rng = np.random.default_rng(seed)
    features = [c for c in df.columns if c != TARGET]

    if n_rows is not None:
        # 分层下采样：恶性比例按 malignant_rate 控制（其余取良性）
        pos = df[df[TARGET] == 1]
        neg = df[df[TARGET] == 0]
        n_pos = int(round(n_rows * malignant_rate))
        n_neg = n_rows - n_pos
        if n_pos > len(pos) or n_neg > len(neg):
            raise SystemExit(f"case 参数不可行：需要 {n_pos} 恶性 / {n_neg} 良性（只有 {len(pos)}/{len(neg)}）")
        picked = np.concatenate(
            [
                rng.choice(pos.index.to_numpy(), n_pos, replace=False),
                rng.choice(neg.index.to_numpy(), n_neg, replace=False),
            ]
        )
        df = df.loc[picked]

    if gain_span > 0:
        # "另一台仪器"：每一列乘一个固定增益（10^±gain_span 之间），量程差别被放大；
        # 再叠加一点相对测量噪声（不同仪器的重复性误差）
        gains = np.power(10.0, rng.uniform(-gain_span, gain_span, len(features)))
        values = df[features].to_numpy() * gains
        if noise > 0:
            values = values * (1.0 + rng.normal(0.0, noise, values.shape))
        df[features] = values

    df = df.sample(frac=1.0, random_state=seed).reset_index(drop=True)  # 打乱行序
    out = df[features + [TARGET]].round(4)
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description="生成「训练诊断」实验的数据")
    ap.add_argument("--case", choices=sorted(CASES), help="只生成一个 case")
    args = ap.parse_args()

    names = [args.case] if args.case else sorted(CASES)
    for name in names:
        df = make_case(**CASES[name])
        out_dir = CASES_DIR / name
        out_dir.mkdir(parents=True, exist_ok=True)
        path = out_dir / "data.csv"
        df.to_csv(path, index=False)
        rate = df[TARGET].mean()
        print(f"[gen] {path}  n={len(df)}  恶性占比={rate:.3f}  列数={df.shape[1] - 1}")


if __name__ == "__main__":
    main()
