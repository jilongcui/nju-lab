#!/usr/bin/env python3
"""你的方案骨架：`data.csv` → `output.json`（达标报告）。

按 `task.md` 的三条要求做：**accuracy ≥ 0.90 且 macro F1 ≥ 0.85 + 可复现 + 用图说清**。
参考实现在 `problem/reference/scripts/train.py` —— 建议先读它一遍，再回来自己写。

模型、特征用法、切分比例都由你决定（没有唯一答案）。骨架已经把"结构"搭好，
你只要填两个 TODO。

用法：
  python3 scripts/train.py <case目录> <output.json>
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd
from sklearn.metrics import accuracy_score, f1_score
from sklearn.model_selection import train_test_split

TARGET = "species"
FEATURES = ["petal_length_cm", "petal_width_cm"]
TEST_SIZE = 0.25        # 测试集占比：20%~40% 之间都行
RANDOM_STATE = 42       # 固定种子，保证结果可复现


def load_data(case_dir: str | Path) -> pd.DataFrame:
    """读取一个 case 的数据（已给）。"""
    return pd.read_csv(Path(case_dir) / "data.csv")


def build_baseline(y_train: pd.Series, y_test: pd.Series) -> dict:
    """TODO(1)：算出"现有做法"的成绩。

    现有做法（不建模）= 一律猜训练集里**最多的那个品种**。
    要求：在**同一个测试集**上算 accuracy，返回 {"name": "most_frequent", "accuracy": ...}。
    提示：`y_train.value_counts().idxmax()` 得到多数类；再算预测全等于它的 accuracy。
    """
    raise NotImplementedError("TODO(1): 多数类基线的 accuracy")


def train_and_evaluate(df: pd.DataFrame) -> dict:
    """TODO(2)：切分 → 选模型 → 训练 → 评估，返回报告字典。

    需要你自己做的决定：
      a. **用哪些特征**？两个都用，还是只用花瓣长度？（看图判断）
      b. **用什么模型**？逻辑回归、决策树、KNN 都可以 —— 选你自己能解释清楚的。
      c. **怎么切分**？测试集占比 20%~40%，固定随机种子。

    返回的字典必须包含（结构见 task.md 的"交付格式"）：
      model / n_train / n_test / metrics{accuracy, macro_f1} / baseline{name, accuracy} / notes
    其中 notes 写清"用了什么模型、为什么、比基线好多少"（≥20 字）。

    提示：`accuracy_score` / `f1_score(average="macro")` 用来算指标；
          `train_test_split(..., stratify=y)` 可以让三个类别在训练/测试集里比例一致。
    """
    X_train, X_test, y_train, y_test = train_test_split(
        df[FEATURES], df[TARGET], test_size=TEST_SIZE, random_state=RANDOM_STATE, stratify=df[TARGET]
    )
    raise NotImplementedError("TODO(2): 训练 + 评估 + 组装报告")


def main() -> None:
    ap = argparse.ArgumentParser(description="按花瓣尺寸识别鸢尾花品种")
    ap.add_argument("case_dir")
    ap.add_argument("out")
    args = ap.parse_args()

    result = train_and_evaluate(load_data(args.case_dir))
    Path(args.out).write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    m = result["metrics"]
    ok = m["accuracy"] >= 0.90 and m["macro_f1"] >= 0.85
    print(json.dumps(result, ensure_ascii=False))
    print(
        f"[{'达标' if ok else '未达标'}] accuracy={m['accuracy']} macro_f1={m['macro_f1']} "
        f"（要求 accuracy ≥ 0.90 且 macro F1 ≥ 0.85）"
    )


if __name__ == "__main__":
    main()
