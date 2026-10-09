#!/usr/bin/env python3
"""你的方案骨架：`data.csv` → `output.json`（会员分档方案）。

按 `task.md` 的四条要求做：**macro F1 ≥ 0.60 + 每一档召回 ≥ 0.50 + 可复现 + 说清选择**。
参考实现在 `problem/reference/scripts/train.py` —— 建议先读它一遍（注意它怎么预处理），
再回来自己写。

模型、特征、参数都由你决定（没有唯一答案）。骨架已经把结构搭好，你只要填两个 TODO。

用法：
  python3 scripts/train.py <case_dir> <output.json>
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd
from sklearn.metrics import accuracy_score, f1_score, recall_score
from sklearn.model_selection import train_test_split

TARGET = "tier"          # 0=低, 1=中, 2=高
TEST_SIZE = 0.25         # 测试集占比：20%~40% 之间都行
RANDOM_STATE = 42        # 固定种子，保证结果可复现
MACRO_F1_MIN = 0.60      # 达标线：三档的平均表现
PER_CLASS_RECALL_MIN = 0.50  # 防退化：每一档都不能被放弃


def load_data(case_dir: str | Path) -> pd.DataFrame:
    """读取一个 case 的数据（已给）。"""
    return pd.read_csv(Path(case_dir) / "data.csv")


def build_baseline(y_test) -> dict:
    """TODO(1)：算出"现有做法"的成绩。

    现有做法 = **不做预测，一律判为多数类**（通常是最低档 0）。要求返回：
      {"name": "majority_class", "accuracy": <float>, "macro_f1": <float>}
    想一想：这样的"预测"准确率为什么看起来还行？macro F1 又为什么很低？
    提示：`accuracy_score` / `f1_score(..., average="macro", zero_division=0)`；
          `pd.Series(y_test).value_counts()` 可以找出多数类。
    """
    raise NotImplementedError("TODO(1): 现有做法（一律判多数类）的成绩")


def train_and_evaluate(df: pd.DataFrame) -> dict:
    """TODO(2)：切分 → 训练 → 评估，返回报告字典。

    需要你自己做的决定：
      a. **要不要预处理**？各列量纲差很多（月均消费到几千、到访次数只有十几）——
         有些模型（如逻辑回归）不标准化会很难收敛。试试看会不会报 ConvergenceWarning。
      b. **用哪个模型**？多分类逻辑回归、随机森林、梯度提升都可以 —— 选你能讲清楚的。
      c. **怎么切分**？测试集占比 20%~40%，固定种子；三档人数不平均，建议 `stratify=y`。

    返回的字典必须包含（结构见 task.md 的"交付格式"）：
      model / n_train / n_test /
      metrics{macro_f1, accuracy, per_class_recall[3]} /
      baseline{name, accuracy, macro_f1} / notes
    其中 per_class_recall 要按 0/1/2 顺序给出**每一档**的召回率；
    notes 要写清"用了哪些特征、为什么、为什么用 macro F1"（≥20 字）。

    提示：`f1_score(..., average="macro")` 是 macro F1；
          `recall_score(..., average=None)` 得到逐档召回率。
    """
    features = [c for c in df.columns if c != TARGET]
    X_train, X_test, y_train, y_test = train_test_split(
        df[features], df[TARGET], test_size=TEST_SIZE, random_state=RANDOM_STATE, stratify=df[TARGET]
    )
    raise NotImplementedError("TODO(2): 预处理 + 训练 + 评估 + 组装报告")


def main() -> None:
    ap = argparse.ArgumentParser(description="会员价值分级")
    ap.add_argument("case_dir")
    ap.add_argument("out")
    args = ap.parse_args()

    result = train_and_evaluate(load_data(args.case_dir))
    Path(args.out).write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    m = result["metrics"]
    ok = m["macro_f1"] >= MACRO_F1_MIN and all(r >= PER_CLASS_RECALL_MIN for r in m["per_class_recall"])
    print(json.dumps(result, ensure_ascii=False))
    print(
        f"[{'达标' if ok else '未达标'}] macro F1={m['macro_f1']} 逐档召回={m['per_class_recall']} "
        f"（要求 macro F1 ≥ {MACRO_F1_MIN} 且每档召回 ≥ {PER_CLASS_RECALL_MIN}）"
    )


if __name__ == "__main__":
    main()
