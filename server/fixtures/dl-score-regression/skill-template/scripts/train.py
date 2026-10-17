#!/usr/bin/env python3
"""你的方案骨架：`data.csv` → `output.json`（达标报告 + 训练过程）。

按 `task.md` 的三条要求做：**MAE 比一律报平均分低 45% + 记录逐轮训练损失 + 用图讲清楚**。
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
from sklearn.metrics import mean_absolute_error, r2_score  # noqa: E402
from sklearn.model_selection import train_test_split  # noqa: E402

TARGET = "final_score"
FEATURES = ["weekly_hours", "attendance_rate"]
TEST_SIZE = 0.25     # 测试集占比：20%~40% 之间都行
RANDOM_STATE = 42    # 固定种子，保证结果可复现
FIG_DIR = Path("figures")


def load_data(case_dir: str | Path) -> pd.DataFrame:
    """读取一个 case 的数据（已给）。"""
    return pd.read_csv(Path(case_dir) / "data.csv")


def plot_data_overview(df: pd.DataFrame, fig_dir: Path = FIG_DIR) -> dict:
    """② 看一眼数据（并画图）—— 最小示例，照这个样子写你自己的。

    画两个散点图：练习时长 vs 成绩、出勤率 vs 成绩。
    `takeaway` 要写"你从图里看到了什么"（关系是不是直线？在哪饱和？），不要留 TODO。
    """
    fig_dir.mkdir(parents=True, exist_ok=True)
    fig, axes = plt.subplots(1, 2, figsize=(10, 4))
    axes[0].scatter(df["weekly_hours"], df[TARGET], s=16, alpha=0.6, color="#4C78A8")
    axes[0].set_xlabel("weekly practice hours")
    axes[0].set_ylabel("final score")
    axes[0].set_title("Practice hours vs score")
    axes[1].scatter(df["attendance_rate"], df[TARGET], s=16, alpha=0.6, color="#F58518")
    axes[1].set_xlabel("attendance rate")
    axes[1].set_ylabel("final score")
    axes[1].set_title("Attendance rate vs score")
    fig.tight_layout()
    path = fig_dir / "data_overview.png"
    fig.savefig(path, dpi=110)
    plt.close(fig)
    return {
        "path": str(path),
        "takeaway": "TODO：从这张图里你看到了什么？（关系是不是一条直线、哪里开始饱和、两个特征哪个影响更大）",
    }


def plot_training_curve(history: list[dict], fig_dir: Path = FIG_DIR) -> dict:
    """⑤ 训练曲线（已给）：损失有没有真的降下来。"""
    fig_dir.mkdir(parents=True, exist_ok=True)
    epochs = [h["epoch"] for h in history]
    losses = [h["train_loss"] for h in history]
    fig, ax = plt.subplots(figsize=(5.2, 3.6))
    ax.plot(epochs, losses, color="#4C78A8", lw=1.6)
    ax.set_xlabel("epoch")
    ax.set_ylabel("training loss (MSE)")
    ax.set_title("Training loss")
    fig.tight_layout()
    path = fig_dir / "training_curve.png"
    fig.savefig(path, dpi=110)
    plt.close(fig)
    return {
        "path": str(path),
        "takeaway": f"TODO：损失从第 1 轮 {losses[0]:.2f} 变到第 {epochs[-1]} 轮 {losses[-1]:.2f}，说明什么？",
    }


def build_baseline(y_train, y_test) -> dict:
    """TODO(1)：算出"现有做法"的成绩。

    现有做法（不建模）= 一律报训练集的平均分。
    要求：在**同一个测试集**上算 MAE，返回 `{"name": "mean_score", "mae": ...}`。
    提示：`mean_absolute_error(y_test, [y_train.mean()] * len(y_test))`。
    """
    raise NotImplementedError("TODO(1): 平均分基线的 MAE")


def train_and_evaluate(df: pd.DataFrame) -> dict:
    """TODO(2)：切分 → 标准化 → 搭网络 → 训练（逐轮记损失）→ 评估 → 组装报告。

    需要你自己做的决定：
      a. **网络结构**：比如 `nn.Linear(2, 16) → nn.ReLU() → nn.Linear(16, 1)`；
      b. **标准化**：输入与目标都做标准化（用训练集的 mean/std），否则训练会很慢；
      c. **优化器与轮数**：`torch.optim.Adam(params, lr=0.05)`、全批量、一两百轮。

    训练循环大致长这样（每轮都要记一条历史）：
        for epoch in range(1, EPOCHS + 1):
            optimizer.zero_grad()
            loss = loss_fn(model(X_train_t), y_train_t)
            loss.backward()
            optimizer.step()
            history.append({"epoch": epoch, "train_loss": round(float(loss.item()), 4)})

    返回的字典必须包含（结构见 task.md 的"交付格式"）：
      model / n_train / n_test / metrics{mae, r2} / baseline{...}
      / training{epochs, optimizer, loss, history} / figures / notes
    提示：预测时记得把标准化反变换回分数；`mean_absolute_error` / `r2_score` 算指标；
          评估图可以画"预测 vs 实际 + 残差"两张子图。
    """
    X = df[FEATURES].to_numpy(dtype=float)
    y = df[TARGET].to_numpy(dtype=float)
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=TEST_SIZE, random_state=RANDOM_STATE
    )
    raise NotImplementedError("TODO(2): 训练 + 评估 + 组装报告")


def main() -> None:
    ap = argparse.ArgumentParser(description="按练习情况估算期末成绩")
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
        f"[{'达标' if ratio <= 0.55 else '未达标'}] MAE={result['metrics']['mae']} "
        f"基线={result['baseline']['mae']}（比值 {ratio:.2f}，要求 ≤ 0.55）"
    )


if __name__ == "__main__":
    main()
