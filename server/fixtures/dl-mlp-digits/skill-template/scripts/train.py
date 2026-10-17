#!/usr/bin/env python3
"""你的方案骨架：`data.csv` → `output.json`（达标报告 + 训练过程）。

按 `task.md` 的三条要求做：**accuracy / macro F1 达标 + 记录逐轮训练损失 + 用图讲清楚**。
参考实现在 `problem/reference/scripts/train.py` —— 建议先读它一遍，再回来自己写。

网络结构、优化器、轮数都由你决定（没有唯一答案）。骨架已经把"结构"搭好，
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
from sklearn.metrics import accuracy_score, f1_score  # noqa: E402
from sklearn.model_selection import train_test_split  # noqa: E402

TARGET = "digit"
CLASSES = [3, 8, 9]
PIXELS = [f"p{r}{c}" for r in range(8) for c in range(8)]
TEST_SIZE = 0.25     # 测试集占比：20%~40% 之间都行
RANDOM_STATE = 42    # 固定种子，保证结果可复现
FIG_DIR = Path("figures")


def load_data(case_dir: str | Path) -> pd.DataFrame:
    """读取一个 case 的数据（已给）。"""
    return pd.read_csv(Path(case_dir) / "data.csv")


def to_arrays(df: pd.DataFrame):
    """像素归一到 0~1；标签映射成 0/1/2（CrossEntropyLoss 要的是类别下标）。"""
    X = df[PIXELS].to_numpy(dtype="float32") / 16.0
    index = {cls: i for i, cls in enumerate(CLASSES)}
    y = [index[int(v)] for v in df[TARGET].to_numpy()]
    return X, y


def plot_data_overview(df: pd.DataFrame, fig_dir: Path = FIG_DIR) -> dict:
    """② 看一眼数据（并画图）—— 最小示例，照这个样子写你自己的。

    画三类的样例图 + 每类样本数。`takeaway` 要写"你从图里看到了什么"，不要留 TODO。
    """
    fig_dir.mkdir(parents=True, exist_ok=True)
    fig = plt.figure(figsize=(10, 3.2))
    gs = fig.add_gridspec(1, 4, width_ratios=[1, 1, 1, 1.3])
    for k, cls in enumerate(CLASSES):
        ax = fig.add_subplot(gs[0, k])
        sample = df[df[TARGET] == cls].iloc[0]
        ax.imshow(sample[PIXELS].to_numpy(dtype=float).reshape(8, 8), cmap="gray_r")
        ax.set_title(f"label {cls}")
        ax.set_xticks([])
        ax.set_yticks([])
    ax = fig.add_subplot(gs[0, 3])
    counts = df[TARGET].value_counts().reindex(CLASSES).fillna(0).astype(int)
    ax.bar([str(c) for c in CLASSES], counts.values, color="#4C78A8")
    ax.set_xlabel("digit")
    ax.set_ylabel("count")
    ax.set_title("Samples per digit")
    fig.tight_layout()
    path = fig_dir / "data_overview.png"
    fig.savefig(path, dpi=110)
    plt.close(fig)
    return {
        "path": str(path),
        "takeaway": "TODO：从这张图里你看到了什么？（三类是否均衡、3/8/9 的笔画差在哪、哪些位置最容易混）",
    }


def plot_training_curve(history: list[dict], fig_dir: Path = FIG_DIR) -> dict:
    """⑤ 训练曲线（已给）：损失有没有真的降下来。"""
    fig_dir.mkdir(parents=True, exist_ok=True)
    epochs = [h["epoch"] for h in history]
    losses = [h["train_loss"] for h in history]
    fig, ax = plt.subplots(figsize=(5.2, 3.6))
    ax.plot(epochs, losses, color="#4C78A8", lw=1.6)
    ax.set_xlabel("epoch")
    ax.set_ylabel("training loss")
    ax.set_title("Training loss")
    fig.tight_layout()
    path = fig_dir / "training_curve.png"
    fig.savefig(path, dpi=110)
    plt.close(fig)
    return {
        "path": str(path),
        "takeaway": f"TODO：损失从第 1 轮 {losses[0]:.3f} 变到第 {epochs[-1]} 轮 {losses[-1]:.3f}，说明什么？",
    }


def build_baseline(y_train, y_test) -> dict:
    """TODO(1)：算出"现有做法"的成绩。

    现有做法（不建模）= 一律猜训练集里**最多的那个数字**。
    要求：在**同一个测试集**上算 accuracy，返回
    `{"name": "most_frequent", "label": <数字>, "accuracy": ...}`。
    提示：`y_train` / `y_test` 是 0/1/2 的类别下标；多数类用 `collections.Counter` 或 numpy 的
          `np.bincount(...).argmax()` 找；`label` 记得映射回真实数字（`CLASSES[下标]`）。
    """
    raise NotImplementedError("TODO(1): 多数类基线的 accuracy")


def train_and_evaluate(df: pd.DataFrame) -> dict:
    """TODO(2)：切分 → 搭网络 → 训练（逐轮记损失）→ 评估 → 组装报告。

    需要你自己做的决定：
      a. **网络结构**：比如 `nn.Linear(64, 32) → nn.ReLU() → nn.Linear(32, 3)`；
      b. **优化器与学习率**：`torch.optim.Adam(params, lr=0.05)` 是个不错的起点；
      c. **训练轮数**：几十轮就够（本实验数据小、全批量训练很快）。

    训练循环大致长这样（每轮都要记一条历史）：
        for epoch in range(1, EPOCHS + 1):
            optimizer.zero_grad()
            loss = loss_fn(model(X_train_t), y_train_t)
            loss.backward()
            optimizer.step()
            history.append({"epoch": epoch, "train_loss": round(float(loss.item()), 4)})

    返回的字典必须包含（结构见 task.md 的"交付格式"）：
      model / n_train / n_test / metrics{accuracy, macro_f1} / baseline{...}
      / training{epochs, optimizer, loss, history} / figures / notes
    提示：`accuracy_score` / `f1_score(average="macro")` 算指标；
          混淆矩阵可以自己用 `sklearn.metrics.confusion_matrix` 画一张图。
    """
    X, y = to_arrays(df)
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=TEST_SIZE, random_state=RANDOM_STATE, stratify=y
    )
    raise NotImplementedError("TODO(2): 训练 + 评估 + 组装报告")


def main() -> None:
    ap = argparse.ArgumentParser(description="分拣手写数字（3/8/9）")
    ap.add_argument("case_dir")
    ap.add_argument("out")
    args = ap.parse_args()

    result = train_and_evaluate(load_data(args.case_dir))
    Path(args.out).write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    m = result["metrics"]
    ok = m["accuracy"] >= 0.92 and m["macro_f1"] >= 0.90
    print(json.dumps(result, ensure_ascii=False))
    print(
        f"[{'达标' if ok else '未达标'}] accuracy={m['accuracy']} macro_f1={m['macro_f1']} "
        f"（要求 accuracy ≥ 0.92 且 macro F1 ≥ 0.90）"
    )


if __name__ == "__main__":
    main()
