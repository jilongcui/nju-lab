#!/usr/bin/env python3
"""生成 ml-basics 的用例输入（input.csv + params.json）—— **教师工具，不属于 Skill**。

**可重跑**：数据全部由固定种子生成，跑两次结果逐字节一致 —— 改案例时重跑它，
再用 problem/reference/scripts/train.py --regen-cases 重算 expected.json 即可。

在与复验同一个镜像里跑（镜像内有 numpy/sklearn，版本与复验环境一致；当前 pkg3）：

  cd server/fixtures/ml-basics
  docker run --rm -v "$PWD:/w" --entrypoint python3 \
    nju-lab-verify:0.2.0-rc.2-pkg3 /w/tools/gen_cases.py

⚠️ 本目录（tools/）**不下发**：它是造题工具，学生拿到的是 problem 包（含参考实现）。
"""
import csv
import json
import sys
from pathlib import Path

import numpy as np

CASES_DIR = Path(__file__).resolve().parent.parent / "problem" / "cases"


def write_case(case, features, feature_names, target, params):
    case_dir = CASES_DIR / case
    case_dir.mkdir(parents=True, exist_ok=True)
    with (case_dir / "input.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow([*feature_names, "target"])
        for row, y in zip(features, target):
            w.writerow([*(f"{v:.4f}" for v in row), f"{y:.4f}" if isinstance(y, float) else int(y)])
    with (case_dir / "params.json").open("w", encoding="utf-8") as f:
        json.dump(params, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"[gen] {case}: {len(features)} 行 × {len(feature_names)} 特征 → {case_dir}")


def main():
    # case01 线性回归：两个特征的线性组合 + 噪声（R² 约 0.9，有区分度）
    rng = np.random.default_rng(20261001)
    n = 80
    x1 = rng.uniform(-3, 3, n)
    x2 = rng.uniform(-2, 4, n)
    y = 3.0 * x1 - 2.0 * x2 + 1.5 + rng.normal(0, 0.5, n)
    write_case(
        "case01",
        np.column_stack([x1, x2]),
        ["x1", "x2"],
        y,
        {"task": "regression", "model": "LinearRegression", "test_size": 0.25, "random_state": 42},
    )

    # case02 二分类（类别均衡）：两簇高斯有重叠，accuracy 不会正好 1.0
    rng = np.random.default_rng(20261002)
    n = 200
    y2 = rng.integers(0, 2, n)
    f1 = rng.normal(0, 1, n) + y2 * 1.6
    f2 = rng.normal(0, 1, n) + y2 * 1.4
    write_case(
        "case02",
        np.column_stack([f1, f2]),
        ["feature1", "feature2"],
        y2,
        {
            "task": "classification",
            "model": "LogisticRegression",
            "model_params": {},
            "test_size": 0.25,
            "random_state": 42,
            "stratify": True,
        },
    )

    # case03 类别不平衡 + class_weight='balanced'（考察参数透传与指标口径）
    rng = np.random.default_rng(20261003)
    n = 300
    y3 = (rng.random(n) < 0.1).astype(int)
    g1 = rng.normal(0, 1, n) + y3 * 2.2
    g2 = rng.normal(0, 1, n) + y3 * 1.8
    write_case(
        "case03",
        np.column_stack([g1, g2]),
        ["feature1", "feature2"],
        y3,
        {
            "task": "classification",
            "model": "LogisticRegression",
            "model_params": {"class_weight": "balanced"},
            "test_size": 0.25,
            "random_state": 42,
            "stratify": True,
        },
    )

    # case04 三分类（K=3）+ stratify=false + test_size=0.2 + random_state=7
    # 考点：多分类（混淆矩阵是 3×3，不是 2×2）、**不传 stratify 的分支**、非默认切分与种子。
    # 簇间距刻意只有 ~1σ，三簇互相重叠 → accuracy 落在 0.6~0.8，不会碰巧满分。
    rng = np.random.default_rng(20261004)
    n = 240
    y4 = rng.integers(0, 3, n)
    f1 = rng.normal(0, 1, n) + y4 * 1.1
    f2 = rng.normal(0, 1, n) + y4 * 0.9
    write_case(
        "case04",
        np.column_stack([f1, f2]),
        ["feature1", "feature2"],
        y4,
        {
            "task": "classification",
            "model": "LogisticRegression",
            "model_params": {},
            "test_size": 0.2,
            "random_state": 7,
            "stratify": False,
        },
    )

    # case05 回归 + model_params 透传（fit_intercept=False）+ test_size=0.3
    # 考点：`model_params` 是否**真的透传**给构造函数 —— 数据有显著截距（4.0），
    # 漏传 fit_intercept 会得到 ≈0.98 的 R²，透传后 R² 只剩 ~0.7，指标直接暴露。
    rng = np.random.default_rng(20261005)
    n = 120
    x1 = rng.uniform(-3, 3, n)
    x2 = rng.uniform(-2, 4, n)
    y5 = 4.0 + 2.5 * x1 - 1.5 * x2 + rng.normal(0, 0.8, n)
    write_case(
        "case05",
        np.column_stack([x1, x2]),
        ["x1", "x2"],
        y5,
        {
            "task": "regression",
            "model": "LinearRegression",
            "model_params": {"fit_intercept": False},
            "test_size": 0.3,
            "random_state": 42,
        },
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
