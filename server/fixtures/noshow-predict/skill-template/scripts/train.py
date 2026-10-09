#!/usr/bin/env python3
"""你的方案骨架：`data.csv` → `output.json`（失约风险方案）。

按 `task.md` 的四条要求做：**recall ≥ 0.65 + precision ≥ 0.40 + 可复现 + 说清选择**。
参考实现在 `problem/reference/scripts/train.py` —— 建议先读它一遍（尤其它怎么处理不平衡），
再回来自己写。

模型、特征、阈值都由你决定（没有唯一答案）。骨架已经把结构搭好，你只要填两个 TODO。

用法：
  python3 scripts/train.py <case目录> <output.json>
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd
from sklearn.metrics import accuracy_score, precision_score, recall_score
from sklearn.model_selection import train_test_split

TARGET = "noshow"
TEST_SIZE = 0.25        # 测试集占比：20%~40% 之间都行
RANDOM_STATE = 42       # 固定种子，保证结果可复现
RECALL_MIN = 0.65       # 达标线（漏掉失约者越少越好）
PRECISION_MIN = 0.40    # 防退化：不能把所有预约都判成失约


def load_data(case_dir: str | Path) -> pd.DataFrame:
    """读取一个 case 的数据（已给）。"""
    return pd.read_csv(Path(case_dir) / "data.csv")


def build_baseline(y_test) -> dict:
    """TODO(1)：算出"现有做法"的成绩。

    现有做法 = **不做预测，一律认为患者会来**（即预测值全为 0）。要求返回：
      {"name": "predict_all_show", "recall": <float>, "accuracy": <float>}
    想一想：这样的"预测"对失约者的召回率会是多少？准确率又为什么看起来不低？
    提示：召回率可以用 `recall_score(y_test, np.zeros_like(y_test))`；
          准确率等于"实际会来"的人数比例。
    """
    raise NotImplementedError("TODO(1): 现有做法（一律认为会来）的成绩")


def train_and_evaluate(df: pd.DataFrame) -> dict:
    """TODO(2)：切分 → 训练 → 评估，返回报告字典。

    需要你自己做的决定（本实验的重点是第 b 条）：
      a. **用哪些特征**？想想每列的业务含义（数据字典见 task.md）。
      b. **怎么处理类别不平衡**？失约的人只占约 1/4：
         - 让模型知道少数类更重要（例如 `LogisticRegression(class_weight="balanced")`）
         - 或者用 `predict_proba` + 自己挑一个概率**阈值**
         - 或者重采样（上采样少数类 / 下采样多数类）
         **先试试什么都不做**，你会看到模型学会了"全判会来"（recall 很低）。
      c. **怎么切分**？测试集占比 20%~40%，固定种子；不平衡数据建议 `stratify=y`。

    返回的字典必须包含（结构见 task.md 的"交付格式"）：
      model / n_train / n_test / metrics{recall, precision[, accuracy]} /
      baseline{name, recall, accuracy} / notes[, threshold]
    notes 要写清"用了哪些特征、为什么、**怎么处理不平衡**"（≥20 字）。
    """
    features = [c for c in df.columns if c != TARGET]
    X_train, X_test, y_train, y_test = train_test_split(
        df[features], df[TARGET], test_size=TEST_SIZE, random_state=RANDOM_STATE, stratify=df[TARGET]
    )
    raise NotImplementedError("TODO(2): 训练 + 评估 + 组装报告")


def main() -> None:
    ap = argparse.ArgumentParser(description="门诊预约失约预测")
    ap.add_argument("case_dir")
    ap.add_argument("out")
    args = ap.parse_args()

    result = train_and_evaluate(load_data(args.case_dir))
    Path(args.out).write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    m = result["metrics"]
    ok = m["recall"] >= RECALL_MIN and m["precision"] >= PRECISION_MIN
    print(json.dumps(result, ensure_ascii=False))
    print(
        f"[{'达标' if ok else '未达标'}] recall={m['recall']} precision={m['precision']} "
        f"（要求 recall ≥ {RECALL_MIN} 且 precision ≥ {PRECISION_MIN}）"
    )


if __name__ == "__main__":
    main()
