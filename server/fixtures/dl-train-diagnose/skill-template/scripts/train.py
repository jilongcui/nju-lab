#!/usr/bin/env python3
"""你的方案骨架：`data.csv` → `output.json`（达标报告 + 训练过程）。

按 `task.md` 的三条要求做：**recall/precision 达标 + 记录逐轮训练过程 + 用图讲清楚**。
参考实现在 `problem/reference/scripts/train.py` —— 建议先读它一遍，再回来自己写。

网络结构、优化器、epoch 数、早停策略都由你决定（没有唯一答案）。骨架已经把"结构"搭好，
你只要填两处 TODO。

用法：
  python3 scripts/train.py <case目录> <output.json>
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")  # 容器内无显示环境
import matplotlib.pyplot as plt  # noqa: E402
import pandas as pd  # noqa: E402
import torch  # noqa: E402
from sklearn.metrics import precision_score, recall_score  # noqa: E402
from sklearn.model_selection import train_test_split  # noqa: E402
from torch import nn  # noqa: E402

TARGET = "defect"
RADIUS_LIMIT = 15.0  # 现有做法用的出厂参考上限（测量仪读数，任意单位）
TEST_SIZE = 0.25     # 测试集占比：20%~40% 之间都行
VAL_SIZE = 0.2       # 训练集内部再划一块做验证（早停用）
RANDOM_STATE = 42    # 固定种子，保证结果可复现
FIG_DIR = Path("figures")


def load_data(case_dir: str | Path) -> pd.DataFrame:
    """读取一个 case 的数据（已给）。"""
    return pd.read_csv(Path(case_dir) / "data.csv")


def plot_data_overview(df: pd.DataFrame, fig_dir: Path = FIG_DIR) -> dict:
    """② 看一眼数据（并画图）——**最小示例**，照这个样子写你自己的。

    这里画两件事：两类各占多少（`Class balance`）、以及最区分两类的特征在两个类里的分布。
    """
    fig_dir.mkdir(parents=True, exist_ok=True)
    feature = str(df.drop(columns=[TARGET]).corrwith(df[TARGET]).abs().idxmax())
    fig, axes = plt.subplots(1, 2, figsize=(10, 4))
    counts = df[TARGET].value_counts().sort_index()
    axes[0].bar([str(i) for i in counts.index], counts.to_numpy(), color="#4C78A8")
    axes[0].set_xlabel("defect (0 = ok, 1 = defect)")
    axes[0].set_ylabel("count")
    axes[0].set_title("Class balance")
    for label, color in ((0, "#54A24B"), (1, "#E45756")):
        axes[1].hist(df.loc[df[TARGET] == label, feature], bins=25, alpha=0.65, color=color, label=str(label))
    axes[1].set_xlabel(feature)
    axes[1].set_ylabel("count")
    axes[1].set_title(f"{feature} by class")
    axes[1].legend(title="defect")
    fig.tight_layout()
    path = fig_dir / "data_overview.png"
    fig.savefig(path, dpi=110)
    plt.close(fig)
    return {
        "path": str(path),
        "takeaway": "TODO：从这张图里你看到了什么？（类别是否均衡、哪列分得开、是否有重叠区）",
    }


def build_baseline(y_true, radius) -> dict:
    """TODO(1)：算出现有做法的成绩。

    现有做法 = 只看 `mean_radius`，`mean_radius >= RADIUS_LIMIT` 判「有缺陷」。
    要求：在**同一个测试集**上算 `recall` / `precision` / `accuracy`，返回
    `{"name": ..., "recall": float, "precision": float, "accuracy": float}`。
    提示：`radius` 是一个只含 `mean_radius` 一列的 Series 或一维数组；
          `recall_score(y_true, pred, zero_division=0)` / `precision_score(...)`。
    """
    raise NotImplementedError("TODO(1): 现有做法（单特征 + 固定阈值）的成绩")



def train_and_evaluate(df: pd.DataFrame) -> dict:
    """TODO(2)：切分 → 定基线 → 训练 → 评估 → 组装报告。

    返回的字典必须包含（结构见 task.md 的"交付格式"）：
      model / n_train / n_test / metrics{recall, precision[, accuracy]} /
      baseline{name, recall, precision, accuracy} / training{history, epochs_run, best_epoch,
      early_stopped[, epochs_planned, hidden_layers]} / figures[至少 3 张] / notes

    注意：
      · 切分要 `stratify=y`（缺陷件只占两三成，不分层会让测试集的类别比例乱跳）
      · 标准化（如果用）**只用训练集拟合**，再 transform 验证集/测试集
      · `n_train` 写"除测试集以外的全部样本数"（含验证集）→ 与 `n_test` 相加才是全部行数
      · `notes` 写清"看图发现了什么、怎么处理过拟合、和基线比如何、还有什么不足"（≥20 字）

    需要你自己做的决定：
      a. **要不要标准化**？先看一眼各列量纲（② 的发现）—— 不做会怎样，跑一遍就知道。
      b. **网络怎么搭**？隐层宽度/层数、激活函数、dropout —— 选你能讲清楚的。
      c. **怎么训**？优化器、学习率、epoch 上限、早停（patience 多少）；取**最优轮次**的权重。
      d. **记录什么**？每轮的 `loss` 与 `val_loss` 必须记 —— 训练曲线与"是否过拟合"都靠它。
      e. **出两张图**：训练曲线（含最优轮次）+ 混淆矩阵 —— 图怎么画照 `reference/scripts/train.py`。
"""
    figures = [plot_data_overview(df)]
    features = [c for c in df.columns if c != TARGET]
    X_all, y_all = df[features].to_numpy(dtype=float), df[TARGET].to_numpy(dtype=int)
    X_train_all, X_test, y_train_all, y_test = train_test_split(
        X_all, y_all, test_size=TEST_SIZE, random_state=RANDOM_STATE, stratify=y_all
    )
    X_train, X_val, y_train, y_val = train_test_split(
        X_train_all, y_train_all, test_size=VAL_SIZE, random_state=RANDOM_STATE, stratify=y_train_all
    )
    raise NotImplementedError("TODO(2): 基线 → 训练 → 评估 → 报告")


def main() -> None:
    ap = argparse.ArgumentParser(description="来料自动分检（训练诊断）")
    ap.add_argument("case_dir")
    ap.add_argument("out")
    args = ap.parse_args()

    result = train_and_evaluate(load_data(args.case_dir))
    Path(args.out).write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    m, b = result["metrics"], result["baseline"]
    for fig in result["figures"]:
        print(f"  [图] {fig['path']} —— {fig['takeaway']}")
    print(
        f"[本轮成绩] recall={m['recall']} precision={m['precision']} | "
        f"基线 recall={b['recall']} precision={b['precision']} | 训练 {result['training']['epochs_run']} 轮"
    )
    print("达标线对照 task.md：case01 recall ≥ 0.90、case02 recall ≥ 0.85，两者 precision ≥ 0.80。")


if __name__ == "__main__":
    main()
