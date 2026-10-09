#!/usr/bin/env python3
"""你的方案骨架：`data.csv` → `output.json`（达标报告）。

按 `task.md` 的三条要求做：**比持久性基线好 20% + 可复现 + 说清选择**。
参考实现在 `problem/reference/scripts/train.py` —— 建议先读它一遍，再回来自己写。

模型、特征、切分比例都由你决定（没有唯一答案）。骨架已经把"结构"搭好，
你只要填两个 TODO。

用法：
  python3 scripts/train.py <case目录> <output.json>
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.model_selection import train_test_split

TARGET = "pm25_next"
LAG_COL = "pm25_lag1"
TEST_SIZE = 0.25        # 测试集占比：20%~40% 之间都行
RANDOM_STATE = 42       # 固定种子，保证结果可复现


def load_data(case_dir: str | Path) -> pd.DataFrame:
    """读取一个 case 的数据（已给）。"""
    return pd.read_csv(Path(case_dir) / "data.csv")


def build_baseline(y_true, X_test) -> float:
    """TODO(1)：算出"现有做法"的成绩。

    现有做法（持久性基线）= 把 `pm25_lag1` 直接当作下一小时的预测值。
    要求：在**同一个测试集**上算平均绝对误差（MAE），返回 float。
    提示：`mean_absolute_error(y_true, X_test[LAG_COL])`
    """
    raise NotImplementedError("TODO(1): 持久性基线的 MAE")


def train_and_evaluate(df: pd.DataFrame) -> dict:
    """TODO(2)：切分 → 选模型 → 训练 → 评估，返回报告字典。

    需要你自己做的决定：
      a. **用哪些特征**？至少试一下 `pm25_lag1 + pm25_neighbor + wind_speed` 的组合，
         想想每个特征为什么可能有帮助（数据字典见 task.md）。
      b. **用什么模型**？线性/Ridge、随机森林、梯度提升都可以 —— 选你自己能解释清楚的。
      c. **怎么切分**？测试集占比 20%~40%，固定随机种子。

    返回的字典必须包含（结构见 task.md 的"交付格式"）：
      model / n_train / n_test / metrics{mae[, r2]} / baseline{name, mae} / notes
    其中 notes 写清"用了哪些特征、为什么这么选"（≥20 字）。

    提示：先在训练集上 fit，再在测试集上 predict；
          `mean_absolute_error` / `r2_score` 用来算指标；
          最后 `build_baseline(y_test, X_test)` 得到基线成绩。
    """
    features = [c for c in df.columns if c != TARGET]
    X_train, X_test, y_train, y_test = train_test_split(
        df[features], df[TARGET], test_size=TEST_SIZE, random_state=RANDOM_STATE
    )
    raise NotImplementedError("TODO(2): 训练 + 评估 + 组装报告")


def main() -> None:
    ap = argparse.ArgumentParser(description="估算下一小时 PM2.5")
    ap.add_argument("case_dir")
    ap.add_argument("out")
    args = ap.parse_args()

    result = train_and_evaluate(load_data(args.case_dir))
    Path(args.out).write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    ratio = result["metrics"]["mae"] / result["baseline"]["mae"]
    print(json.dumps(result, ensure_ascii=False))
    print(
        f"[{'达标' if ratio <= 0.8 else '未达标'}] MAE={result['metrics']['mae']} "
        f"基线={result['baseline']['mae']}（比值 {ratio:.2f}，要求 ≤ 0.80）"
    )


if __name__ == "__main__":
    main()
