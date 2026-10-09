#!/usr/bin/env python3
"""你的方案骨架：`data.csv` → `output.json`（达标报告 + 训练过程）。

按 `task.md` 的三条要求做：**macro F1 与逐档召回达标 + 记录逐轮训练过程 + 用图讲清楚**。
参考实现在 `problem/reference/scripts/train.py` —— 建议先读它一遍，再回来自己写。

网络结构、通道数、优化器、epoch 数、要不要做数据增强都由你决定（没有唯一答案）。
骨架已经把"结构"搭好，你只要填三个 TODO。

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
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import torch  # noqa: E402
from sklearn.metrics import accuracy_score, f1_score, recall_score  # noqa: E402
from sklearn.model_selection import train_test_split  # noqa: E402
from torch import nn  # noqa: E402

TARGET = "label"
SIDE = 8
N_CLASSES = 10
TEST_SIZE = 0.25   # 测试集占比：20%~40% 之间都行
VAL_SIZE = 0.2     # 训练集内部再划一块做验证（早停用）
RANDOM_STATE = 42  # 固定种子，保证结果可复现
FIG_DIR = Path("figures")


def load_data(case_dir: str | Path) -> pd.DataFrame:
    """读取一个 case 的数据（已给）。"""
    return pd.read_csv(Path(case_dir) / "data.csv")


def to_arrays(df: pd.DataFrame):
    """把像素列还原成 (N, 1, 8, 8) 的图像张量输入形状（已给）。"""
    pixels = [c for c in df.columns if c != TARGET]
    X = df[pixels].to_numpy(dtype=np.float32).reshape(-1, 1, SIDE, SIDE)
    y = df[TARGET].to_numpy(dtype=np.int64)
    return X, y


def plot_data_overview(df: pd.DataFrame, fig_dir: Path = FIG_DIR) -> dict:
    """② 看一眼数据（并画图）——**最小示例**，照这个样子写你自己的。

    这里画两件事：逐档样本数、每一档挑一张缩略图（`cmap="gray_r"`：越黑笔画越深）。
    """
    fig_dir.mkdir(parents=True, exist_ok=True)
    pixels = [c for c in df.columns if c != TARGET]
    fig = plt.figure(figsize=(10, 4))
    ax0 = fig.add_subplot(1, 2, 1)
    counts = df[TARGET].value_counts().sort_index()
    ax0.bar(counts.index.to_numpy(), counts.to_numpy(), color="#4C78A8")
    ax0.set_xticks(range(N_CLASSES))
    ax0.set_xlabel("digit")
    ax0.set_ylabel("count")
    ax0.set_title("Samples per digit")
    for i in range(N_CLASSES):
        ax = fig.add_subplot(2, N_CLASSES, N_CLASSES + 1 + i)
        row = df.loc[df[TARGET] == i, pixels].iloc[0].to_numpy(dtype=float).reshape(SIDE, SIDE)
        ax.imshow(row, cmap="gray_r")
        ax.set_title(str(i), fontsize=8)
        ax.axis("off")
    fig.tight_layout()
    path = fig_dir / "data_overview.png"
    fig.savefig(path, dpi=110)
    plt.close(fig)
    return {
        "path": str(path),
        "takeaway": "TODO：从这张图里你看到了什么？（逐档是否均衡、图像多大、笔画多粗、位置为什么重要）",
    }


def build_baseline(X_train, y_train, X_test, y_test) -> dict:
    """TODO(1)：算出现有做法（上一版系统）的成绩。

    上一版系统 = 把 64 个像素**直接**喂给线性分类器（例如 `LogisticRegression(max_iter=1000)`）。
    要求：在**同一个测试集**上算 `macro_f1` / `accuracy`，
    返回 `{"name": "linear_on_raw_pixels", "macro_f1": float, "accuracy": float, "per_class_recall": [...]}`。
    提示：像素要平铺成二维 `X.reshape(len(X), -1)`；
          `f1_score(..., average="macro", zero_division=0)` / `recall_score(..., labels=range(10), average=None)`。
    """
    raise NotImplementedError("TODO(1): 上一版系统（像素 + 线性分类器）的成绩")


def train_cnn(X_train, y_train, X_val, y_val):
    """TODO(2)：训练一个多轮卷积网络，并记录逐轮历史。

    需要你自己做的决定：
      a. **结构**：几层卷积、通道数多少、要不要池化、全连接层多大 —— 选你能讲清楚的。
      b. **要不要数据增强**：② 的图 + case02 的样子会告诉你"位置"是不是问题；
         如果做增强，注意别让干净数据也一起变差（可以只对一部分批次增强）。
      c. **怎么训**：优化器、学习率、epoch 上限、早停（patience）；取**最优轮次**的权重。
      d. **记录什么**？每轮的 `loss` 与 `val_loss` 必须记 —— 训练曲线和"是否过拟合"都靠它。

    返回 `(model, history, best_epoch)`：
      · `history`：`[{"epoch": 1, "loss": ..., "val_loss": ...}, ...]`
      · `best_epoch`：验证损失最低的那一轮
    提示：`nn.CrossEntropyLoss` / `torch.optim.Adam` / `torch.manual_seed(RANDOM_STATE)`；
          小批量（如 64）训练比全批量收敛快得多；平移增强可用 `torch.nn.functional.pad` + 裁剪实现。
    """
    raise NotImplementedError("TODO(2): 卷积网络 + 训练循环（含增强、早停与逐轮历史）")


def plot_training(history: list[dict], best_epoch: int, fig_dir: Path = FIG_DIR) -> dict:
    """TODO(3)-a：训练曲线（训练损失 vs 验证损失，标出最优轮次）。"""
    raise NotImplementedError("TODO(3)-a: 训练曲线图")


def plot_evaluation(y_test, pred, fig_dir: Path = FIG_DIR) -> dict:
    """TODO(3)-b：评估图（建议 10×10 混淆矩阵 —— 哪两档最容易被搞混）。"""
    raise NotImplementedError("TODO(3)-b: 混淆矩阵图")


def train_and_evaluate(df: pd.DataFrame) -> dict:
    """TODO(3)-c：切分 → 定基线 → 训练 → 评估 → 组装报告。

    返回的字典必须包含（结构见 task.md 的"交付格式"）：
      model / n_train / n_test / metrics{macro_f1, accuracy, per_class_recall[10]} /
      baseline{name, macro_f1, accuracy} / training{history, epochs_run, best_epoch, early_stopped} /
      figures[至少 3 张] / notes

    注意：
      · 切分要 `stratify=y`（0/8 那两档样本更少，不分层会让测试集的类别比例乱跳）
      · `n_train` 写"除测试集以外的全部样本数"（含验证集）→ 与 `n_test` 相加才是全部行数
      · `notes` 写清"看图发现了什么、怎么处理扫描偏移、和基线比如何、哪一档最弱"（≥20 字）
    """
    figures = [plot_data_overview(df)]
    X, y = to_arrays(df)
    X_train_all, X_test, y_train_all, y_test = train_test_split(
        X, y, test_size=TEST_SIZE, random_state=RANDOM_STATE, stratify=y
    )
    X_train, X_val, y_train, y_val = train_test_split(
        X_train_all, y_train_all, test_size=VAL_SIZE, random_state=RANDOM_STATE, stratify=y_train_all
    )
    raise NotImplementedError("TODO(3)-c: 基线 → 训练 → 评估 → 报告")


def main() -> None:
    ap = argparse.ArgumentParser(description="手写数字分拣（小图分类）")
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
        f"[本轮成绩] macro_f1={m['macro_f1']} accuracy={m['accuracy']} | "
        f"基线 macro_f1={b['macro_f1']} | 训练 {result['training']['epochs_run']} 轮"
    )
    print(f"逐档召回：{m['per_class_recall']}")
    print("达标线对照 task.md：case01 macro F1 ≥ 0.90、case02 ≥ 0.80，逐档召回另有底线。")


if __name__ == "__main__":
    main()
