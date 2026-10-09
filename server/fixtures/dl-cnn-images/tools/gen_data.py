#!/usr/bin/env python3
"""生成「用小图做分类」实验的数据（每个 case 一份 data.csv）。

应用场景
--------
把纸质表单上**手写的数字**（8×8 灰度缩略图，像素值 0~1）自动分拣成 0~9，
供录入系统直接建索引；分错了会串档，所以每一档都要认得出来。

数据取自 sklearn 打包的**公开数据集** `load_digits`（UCI Optical Recognition of
Handwritten Digits，1797 张真实手写数字），再按 case 做可复现的改造 —— 不是合成数据。

两个 case（同一应用的两批扫描件）
--------------------------------
  case01：原始缩略图（1797 张，10 档均衡）
  case02：**扫描质量差**的那一批 ——
          · 每个样本随机**平移** 1 像素（扫描进纸偏移）
          · 叠加高斯噪声（扫描噪点）
          · 数字 0 与 8 的样本更少（表单上这两个格子出现得少 → 类别不均衡）

可解性保证（造题的关键）
-----------------------
  现有做法（**上一版系统**：把 64 个像素直接丢给线性分类器）在 case01 上还过得去（macro F1 ≈ 0.96），
  但 case02 的平移抖动会明显打崩它（实测 ≈ 0.53：像素位置一变，固定权重就失效）；
  用卷积（局部连接 + 池化）并**在训练时也做平移增强**，能稳定在 0.9 上下。
  判据因此要求"macro F1 达标 + 每一档召回率都不低于达标线" —— 只保大类过不了。

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
from scipy.ndimage import shift as nd_shift
from sklearn.datasets import load_digits

HERE = Path(__file__).resolve().parent
CASES_DIR = HERE.parent / "problem" / "cases"

SIDE = 8
TARGET = "label"

CASES = {
    # case01：原始缩略图
    "case01": dict(seed=20270401, wobble=0, noise=0.0, scarce={}),
    # case02：扫描偏移 + 噪点 + 两档样本更少
    "case02": dict(seed=20270402, wobble=1, noise=0.05, scarce={0: 0.55, 8: 0.55}),
}


def make_case(seed: int, wobble: int, noise: float, scarce: dict[int, float]) -> pd.DataFrame:
    bunch = load_digits()
    pixels = bunch.images.astype(float) / 16.0  # 0~16 灰度 → 0~1
    labels = bunch.target.astype(int)
    rng = np.random.default_rng(seed)

    if wobble > 0:
        moved = np.empty_like(pixels)
        for i, img in enumerate(pixels):
            dx, dy = rng.integers(-wobble, wobble + 1, 2)
            moved[i] = nd_shift(img, (dy, dx), order=1, mode="constant", cval=0.0)
        pixels = moved
    if noise > 0:
        pixels = np.clip(pixels + rng.normal(0.0, noise, pixels.shape), 0.0, 1.0)

    keep = np.ones(len(labels), dtype=bool)
    for cls, rate in scarce.items():
        idx = np.flatnonzero(labels == cls)
        n_keep = int(round(len(idx) * rate))
        drop = rng.choice(idx, len(idx) - n_keep, replace=False)
        keep[drop] = False

    rows = pixels.reshape(len(labels), -1)[keep]
    y = labels[keep]
    columns = [f"pixel_{r}{c}" for r in range(SIDE) for c in range(SIDE)]
    df = pd.DataFrame(rows.round(3), columns=columns)
    df[TARGET] = y
    df = df.sample(frac=1.0, random_state=seed).reset_index(drop=True)
    return df


def main() -> None:
    ap = argparse.ArgumentParser(description="生成「用小图做分类」实验的数据")
    ap.add_argument("--case", choices=sorted(CASES), help="只生成一个 case")
    args = ap.parse_args()

    names = [args.case] if args.case else sorted(CASES)
    for name in names:
        df = make_case(**CASES[name])
        out_dir = CASES_DIR / name
        out_dir.mkdir(parents=True, exist_ok=True)
        path = out_dir / "data.csv"
        df.to_csv(path, index=False)
        counts = df[TARGET].value_counts().sort_index().to_dict()
        print(f"[gen] {path}  n={len(df)}  列数={df.shape[1] - 1}  逐档样本数={counts}")


if __name__ == "__main__":
    main()
