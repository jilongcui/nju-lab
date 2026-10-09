#!/usr/bin/env python3
"""你的方案骨架：`data.csv` → `output.json`（达标报告 + 训练过程）。

按 `task.md` 的三条要求做：**MAE 达到比值线 + 真的用上历史窗口 + 按时间切分**。
参考实现在 `problem/reference/scripts/train.py` —— 建议先读它一遍，再回来自己写。

窗口长度、网络结构、特征组合、优化器都由你决定（没有唯一答案）。骨架已经把"结构"搭好，
你只要填三个 TODO。

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
from sklearn.metrics import mean_absolute_error  # noqa: E402
from torch import nn  # noqa: E402

TARGET = "temp_next"
WINDOW = 8        # 看多长的历史：至少 3 分钟（判据会核对），取多少由你定
TEST_RATIO = 0.25 # 测试段取时间序列**最后**这一段（20%~40% 都行，不许打乱）
RANDOM_STATE = 42 # 固定随机种子（初始化、批顺序）
FIG_DIR = Path("figures")


def load_data(case_dir: str | Path) -> pd.DataFrame:
    """读取一个 case 的数据（已给）。"""
    return pd.read_csv(Path(case_dir) / "data.csv")


def add_cycle_features(df: pd.DataFrame) -> pd.DataFrame:
    """把"一天里的第几分钟"变成周期特征（已给，作为**可选**特征的最小示例）。

    ⚠️ 注意：本数据的主要节奏是"工作循环"（约 45 分钟，case02 约 37 分钟），
    `minute_of_day` 只是它的影子 —— 想靠它吃饭是不够的，真正的信息在**最近一段读数**里。
    """
    out = df.copy()
    phase = 2 * np.pi * out["minute_of_day"].to_numpy(dtype=float) / 1440.0
    out["minute_sin"] = np.sin(phase)
    out["minute_cos"] = np.cos(phase)
    return out


def feature_columns(df: pd.DataFrame) -> list[str]:
    return [c for c in df.columns if c not in (TARGET, "minute_of_day")]


def plot_data_overview(df: pd.DataFrame, fig_dir: Path = FIG_DIR) -> dict:
    """② 看一眼数据（并画图）——**最小示例**，照这个样子写你自己的。

    这里画两件事：温度随时间怎么走、目标值怎么分布。
    """
    fig_dir.mkdir(parents=True, exist_ok=True)
    fig, axes = plt.subplots(1, 2, figsize=(11, 4))
    axes[0].plot(df["temp"].to_numpy(), lw=0.9, color="#4C78A8", label="temp (now)")
    axes[0].plot(df[TARGET].to_numpy(), lw=0.9, color="#F58518", alpha=0.8, label="temp_next (target)")
    axes[0].set_xlabel("minute")
    axes[0].set_ylabel("temperature (C)")
    axes[0].set_title("Temperature over time")
    axes[0].legend(fontsize=8)
    axes[1].hist(df[TARGET], bins=40, color="#54A24B")
    axes[1].set_xlabel("temp_next (C)")
    axes[1].set_ylabel("count")
    axes[1].set_title("Distribution of target")
    fig.tight_layout()
    path = fig_dir / "data_overview.png"
    fig.savefig(path, dpi=110)
    plt.close(fig)
    return {
        "path": str(path),
        "takeaway": "TODO：从这张图里你看到了什么？（趋势/周期/台阶/噪声大小、下一分钟会不会突变）",
    }


def build_baseline(df: pd.DataFrame, test_start: int, test_end: int) -> dict:
    """TODO(1)：算出现有做法的成绩。

    现有做法 = 把当前这一分钟的读数当下一秒（persistence）。
    要求：在**测试段**（行号 `test_start`…`test_end-1`）上算 MAE，返回
    `{"name": "persistence", "mae": float}`。
    提示：`mean_absolute_error(df["temp_next"][test_start:test_end], df["temp"][test_start:test_end])`。
    """
    raise NotImplementedError("TODO(1): 现有做法（当前值当下一秒）在测试段上的 MAE")


def make_windows(features: np.ndarray, target: np.ndarray, window: int):
    """TODO(2)-a：把时序切成 (窗口 → 下一分钟) 的监督样本。

    X[i] = features[i : i+window]（连续 window 分钟）
    Y[i] = target[i + window - 1]（**紧接其后**那一分钟的温度）
    样本数 = 行数 − window + 1。返回 `(X.astype(np.float32), Y.astype(np.float32))`。
    """
    raise NotImplementedError("TODO(2)-a: 滑窗切分")


def train_lstm(X_train, y_train, X_val, y_val):
    """TODO(2)-b：训练序列模型，并记录逐轮历史。

    需要你自己做的决定：
      a. **用什么模型**？LSTM / GRU / 一维卷积都行 —— 选你能讲清楚的。
      b. **预测什么**？直接预测温度绝对值，还是预测"相对窗口最后读数的增量"？（后者通常好学得多）
      c. **怎么训**？优化器、学习率、epoch 上限、早停（patience）；**特征与目标都要缩放**。
      d. **记录什么**？每轮的 `loss` 与 `val_loss` 必须记 —— 训练曲线与"是否过拟合"都靠它。

    返回 `(model, history, best_epoch)`：
      · `history`：`[{"epoch": 1, "loss": ..., "val_loss": ...}, ...]`
      · `best_epoch`：验证损失最低的那一轮（之后要用它对应的权重）
    """
    raise NotImplementedError("TODO(2)-b: 训练循环 + 早停 + 逐轮历史")


def plot_training(history: list[dict], best_epoch: int, fig_dir: Path = FIG_DIR) -> dict:
    """TODO(3)-a：训练曲线（训练损失 vs 验证损失，标出最优轮次）。"""
    raise NotImplementedError("TODO(3)-a: 训练曲线图")


def plot_forecast(y_test, pred, test_start: int, fig_dir: Path = FIG_DIR) -> dict:
    """TODO(3)-b：预测 vs 实际（时间轴）+ 残差 —— 误差出现在哪一段时刻。"""
    raise NotImplementedError("TODO(3)-b: 预测对比图")


def train_and_evaluate(df: pd.DataFrame) -> dict:
    """TODO(3)-c：滑窗 → 定基线 → 训练 → 评估 → 组装报告。

    返回的字典必须包含（结构见 task.md 的"交付格式"）：
      model / window / n_train / n_test / metrics{mae[, rmse]} /
      baseline{name, mae} / training{history, epochs_run, best_epoch, early_stopped} /
      figures[至少 3 张] / notes

    注意：
      · **按时间切分**：测试段取最后 `TEST_RATIO` 那一段（不许打乱）；验证段取训练段末尾
      · 特征与目标都用**训练段**统计量做标准化（别把测试段统计量用进来）
      · `n_train` / `n_test` 是**滑窗样本数**（不是原始行数）
      · `notes` 要写清"为什么取这个窗口、周期/工况怎么处理、和基线比如何、还有什么不足"（≥20 字）
    """
    df = add_cycle_features(df)
    figures = [plot_data_overview(df)]
    raise NotImplementedError("TODO(3)-c: 滑窗 → 基线 → 训练 → 评估 → 报告")


def main() -> None:
    ap = argparse.ArgumentParser(description="传感器时序下一值估计")
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
        f"[本轮成绩] MAE={m['mae']} | 现有做法 MAE={b['mae']}（比值 {m['mae'] / b['mae']:.3f}） | "
        f"窗口 {result['window']} 分钟 | 训练 {result['training']['epochs_run']} 轮"
    )
    print("达标线对照 task.md：case01 比值 ≤ 0.55、case02 比值 ≤ 0.60。")


if __name__ == "__main__":
    main()
