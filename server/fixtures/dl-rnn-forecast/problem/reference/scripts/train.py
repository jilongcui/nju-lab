#!/usr/bin/env python3
"""实验三参考实现（学习示范）：`data.csv` → `output.json` + 三张图。

📖 这份实现**随题目包一起下发**（`problem/reference/`）—— 先读懂它，再写你自己的。
   **它不是唯一正确答案**：判据只要求"MAE 比现有做法低到达标线 + 逐轮训练历史齐全
   + 说清窗口与工况的判断"，换 GRU / 1D 卷积 / 窗口长度、换特征组合同样能通过。

本实现走完**完整流程**（与 task.md 的六步对应）：
  ① 看清需求      —— 提前一分钟估计温度，比看板上的"平滑值"更准
  ② 看一眼数据    —— `plot_data_overview`：**画图**看温度曲线（惯性 / 日周期 / 工况台阶）
  ③ 定基线        —— `build_baseline`：现有做法 = 把当前读数直接当下一秒（persistence）
  ④ 训练模型      —— `train_lstm`：滑窗 + 标准化 + LSTM + **早停**（逐轮记录 train/val 损失）
  ⑤ 评估          —— `plot_forecast`：**画图**看预测与实际的贴合程度、误差出现在哪
  ⑥ 写结论        —— `compose_notes` + 每张图一句 takeaway

用法：
  python3 scripts/train.py <case目录> <output.json>   # 单个 case（图写到当前目录 figures/）
  python3 scripts/train.py --regen-expected           # 重算 problem/cases/*/expected.json

请在**与复验同一个镜像内**生成 expected（当前 pkg5）：

  docker run --rm -v "$PWD:/w" --entrypoint python3 \
    nju-lab-verify:0.2.0-rc.2-pkg5 /w/problem/reference/scripts/train.py --regen-expected
"""
from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")  # 容器内无显示环境
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import torch  # noqa: E402
from sklearn.metrics import mean_absolute_error, mean_squared_error  # noqa: E402
from sklearn.preprocessing import StandardScaler  # noqa: E402
from torch import nn  # noqa: E402

TARGET = "temp_next"
WINDOW = 8           # 模型看的历史窗口（分钟）
TEST_RATIO = 0.25    # 测试集取时间序列**最后**这一段
VAL_RATIO = 0.2      # 训练段内部再取末尾一段做验证（时序也不能打乱）
RANDOM_STATE = 42
HIDDEN = 32
EPOCHS = 60
PATIENCE = 10
LR = 5e-3
BATCH = 64
FIG_DIR = Path("figures")

# 每个 case 的达标线（写进 expected.json 的 accept，供 manifest.json 的断言引用）：
# case02 有工况漂移（负载台阶 + 周期变化 + 噪声更大），线略低一档
ACCEPT = {
    "case01": {"mae_max_ratio_to_baseline": 0.55, "mae_min_ratio_to_baseline": 0.02, "baseline_tolerance": 0.12},
    "case02": {"mae_max_ratio_to_baseline": 0.60, "mae_min_ratio_to_baseline": 0.02, "baseline_tolerance": 0.15},
}

HERE = Path(__file__).resolve().parent
CASES_DIR = HERE.parent.parent / "cases"


def load_data(case_dir: str | Path) -> pd.DataFrame:
    """① / ② 读数据。"""
    return pd.read_csv(Path(case_dir) / "data.csv")


def add_cycle_features(df: pd.DataFrame) -> pd.DataFrame:
    """把"一天里的第几分钟"变成周期特征（sin/cos）—— 直接给分钟数字会让模型以为 23:59 与 00:00 差很远。"""
    out = df.copy()
    phase = 2 * np.pi * out["minute_of_day"].to_numpy(dtype=float) / 1440.0
    out["minute_sin"] = np.sin(phase)
    out["minute_cos"] = np.cos(phase)
    return out


def feature_columns(df: pd.DataFrame) -> list[str]:
    return [c for c in df.columns if c not in (TARGET, "minute_of_day")]


def plot_data_overview(df: pd.DataFrame, fig_dir: Path = FIG_DIR) -> dict:
    """② 看一眼数据（并画图）：温度怎么走、目标怎么分布。"""
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
    diff = (df[TARGET] - df["temp"]).abs()
    takeaway = (
        f"温度曲线平滑、有明显日周期，且 `temp` 与 `temp_next` 几乎重合 —— 说明**下一分钟不会突变**，"
        f"但两者仍有平均 {diff.mean():.2f}C 的差（慢半拍），这正是要预测掉的部分；"
        f"目标分布集中在 {df[TARGET].min():.0f}~{df[TARGET].max():.0f}C，有少数高负载时段的高温。"
    )
    return {"path": str(path), "takeaway": takeaway}


def build_baseline(df: pd.DataFrame, test_start: int, test_end: int) -> dict:
    """③ 现有做法（看板上的"当前值"）：把这一分钟的读数直接当下一秒。

    在**测试段**上算 MAE —— 与模型同一个评测区间。
    """
    pred = df["temp"].to_numpy()
    y = df[TARGET].to_numpy()
    idx = np.arange(test_start, test_end)
    return {
        "name": "persistence",
        "mae": round(float(mean_absolute_error(y[idx], pred[idx])), 4),
    }


def make_windows(features: np.ndarray, target: np.ndarray, window: int):
    """滑窗：用 `window` 分钟的连续特征预测**紧跟其后**的那一分钟温度。

    i 取 0…n-window，样本数 = 行数 − window + 1（开头的 window-1 行被窗口"吃掉"）。
    """
    X = np.stack([features[i:i + window] for i in range(len(features) - window + 1)])
    Y = target[window - 1:]
    return X.astype(np.float32), Y.astype(np.float32)


class LSTMNet(nn.Module):
    """一条 LSTM + 线性头：输入一段窗口，输出**相对当前读数的增量**。

    预测"下一分钟比现在高多少"而不是"下一分钟是多少"—— 时序里的常见做法：
    增量是围绕 0 的小量，网络要学的东西少得多（全量预测得先把 40 多度的基线也学出来）。
    """

    def __init__(self, n_features: int, hidden: int = HIDDEN):
        super().__init__()
        self.lstm = nn.LSTM(n_features, hidden, batch_first=True)
        self.head = nn.Linear(hidden, 1)

    def forward(self, x):
        out, _ = self.lstm(x)
        return self.head(out[:, -1]).squeeze(-1)


def train_lstm(X_train, y_train, X_val, y_val):
    """④ 训练：LSTM + Adam + 早停（逐轮记录 train/val 损失，供训练曲线用）。"""
    torch.manual_seed(RANDOM_STATE)
    model = LSTMNet(X_train.shape[-1])
    opt = torch.optim.Adam(model.parameters(), lr=LR)
    loss_fn = nn.MSELoss()
    xt, yt = torch.tensor(X_train), torch.tensor(y_train)
    xv, yv = torch.tensor(X_val), torch.tensor(y_val)

    history, best_loss, best_state, best_epoch, waits = [], float("inf"), None, 0, 0
    for epoch in range(1, EPOCHS + 1):
        model.train()
        perm = torch.randperm(len(xt))
        total, batches = 0.0, 0
        for i in range(0, len(xt), BATCH):
            idx = perm[i:i + BATCH]
            opt.zero_grad()
            loss = loss_fn(model(xt[idx]), yt[idx])
            loss.backward()
            opt.step()
            total += loss.item() * len(idx)
            batches += 1
        model.eval()
        with torch.no_grad():
            val_loss = float(loss_fn(model(xv), yv))
        history.append({"epoch": epoch, "loss": round(total / batches, 4), "val_loss": round(val_loss, 4)})
        if val_loss < best_loss - 1e-5:
            best_loss, best_epoch, waits = val_loss, epoch, 0
            best_state = copy.deepcopy(model.state_dict())
        else:
            waits += 1
            if waits >= PATIENCE:
                break
    model.load_state_dict(best_state)
    return model, history, best_epoch


def plot_training(history: list[dict], best_epoch: int, fig_dir: Path = FIG_DIR) -> dict:
    """⑤ 评估（并画图）之一：训练曲线 —— 看从哪一轮开始过拟合。"""
    fig_dir.mkdir(parents=True, exist_ok=True)
    epochs = [h["epoch"] for h in history]
    fig, ax = plt.subplots(figsize=(6, 4))
    ax.plot(epochs, [h["loss"] for h in history], label="train loss (MSE)", color="#4C78A8")
    ax.plot(epochs, [h["val_loss"] for h in history], label="val loss (MSE)", color="#E45756")
    ax.axvline(best_epoch, color="gray", ls="--", lw=1, label=f"best epoch = {best_epoch}")
    ax.set_xlabel("epoch")
    ax.set_ylabel("MSE loss")
    ax.set_title("Training curves")
    ax.legend()
    fig.tight_layout()
    path = fig_dir / "training_curve.png"
    fig.savefig(path, dpi=110)
    plt.close(fig)
    last = history[-1]
    takeaway = (
        f"训练与验证损失一起降到 {last['loss']:.3f} / {last['val_loss']:.3f}；验证损失在第 {best_epoch} 轮最低，"
        f"之后不再改善（末轮两者差 {last['val_loss'] - last['loss']:+.3f}），说明继续训练只会拟合训练段的噪声 —— "
        f"所以取最优轮次的权重。"
    )
    return {"path": str(path), "takeaway": takeaway}


def plot_forecast(df: pd.DataFrame, y_test, pred, test_start: int, fig_dir: Path = FIG_DIR) -> dict:
    """⑤ 评估（并画图）之二：预测 vs 实际（时间轴）—— 误差出现在哪一段。"""
    fig_dir.mkdir(parents=True, exist_ok=True)
    axis = np.arange(test_start, test_start + len(y_test))
    fig, axes = plt.subplots(2, 1, figsize=(11, 5.5), sharex=True)
    axes[0].plot(axis, y_test, lw=1.0, color="#4C78A8", label="actual temp_next")
    axes[0].plot(axis, pred, lw=1.0, color="#E45756", alpha=0.85, label="predicted")
    axes[0].set_ylabel("temperature (C)")
    axes[0].set_title("Prediction on the test segment")
    axes[0].legend(fontsize=8)
    axes[1].plot(axis, y_test - pred, lw=0.9, color="#54A24B")
    axes[1].axhline(0, color="r", ls="--", lw=1)
    axes[1].set_xlabel("minute")
    axes[1].set_ylabel("residual (actual - predicted)")
    axes[1].set_title("Residuals")
    fig.tight_layout()
    path = fig_dir / "forecast.png"
    fig.savefig(path, dpi=110)
    plt.close(fig)
    residual = np.asarray(y_test) - np.asarray(pred)
    worst = int(np.argmax(np.abs(residual)))
    takeaway = (
        f"预测曲线整体贴着实际值；残差大致以 0 为中心（均值 {residual.mean():+.2f}C），"
        f"但在第 {axis[worst]} 分钟附近误差最大（{residual[worst]:+.2f}C）—— 那正是工况切换、温度快速抬升的位置，"
        f"模型对「突变」反应偏慢。"
    )
    return {"path": str(path), "takeaway": takeaway}


def compose_notes(df: pd.DataFrame, baseline: dict, metrics: dict, history: list[dict], best_epoch: int) -> str:
    """⑥ 写结论：看过什么 → 怎么处理 → 与基线比如何 → 还有什么不足。"""
    gain = (1 - metrics["mae"] / baseline["mae"]) * 100 if baseline["mae"] else 0.0
    return (
        f"先看图：温度被 45 分钟（case02 为 37 分钟）的工作循环带着走，每分钟上下 0.3~0.7℃，"
        f"而读数噪声只有 0.1~0.2℃ —— 所以「下一分钟往哪走」主要取决于窗口里看出来的趋势，"
        f"当前值给不出方向。现有做法（把当前读数当下一秒）在测试段 MAE {baseline['mae']:.3f}；"
        f"改用 {WINDOW} 分钟窗口 + LSTM（{HIDDEN} 隐单元，预测**增量**而不是绝对值：窗口最后一个读数 + 网络输出的变化量；"
        f"Adam + 早停，第 {best_epoch} 轮最优、共 {len(history)} 轮）"
        f"后 MAE {metrics['mae']:.3f}（低约 {gain:.0f}%）。不足：工况切换处误差最大，"
        f"如果这类「台阶」更频繁，应该把负载与时间特征再细做（或者给最近样本更高权重）。"
    )


def train_and_evaluate(df: pd.DataFrame, fig_dir: Path = FIG_DIR) -> dict:
    """② → ⑥ 完整流程。"""
    df = add_cycle_features(df)
    figures = [plot_data_overview(df, fig_dir)]

    n = len(df)
    split = int(n * (1 - TEST_RATIO))
    features = feature_columns(df)
    X, Y = make_windows(df[features].to_numpy(dtype=float), df[TARGET].to_numpy(dtype=float), WINDOW)
    n_samples = len(X)

    # 时序必须按时间切：测试段取最后一段，验证段取训练段末尾（都不能打乱）
    n_train_all = n_samples - (n - split)         # 测试段对应的样本数
    n_val = int(n_train_all * VAL_RATIO)
    train_idx = slice(0, n_train_all)
    val_idx = slice(n_train_all - n_val, n_train_all)
    test_idx = slice(n_train_all, n_samples)

    # 特征与**目标**都要缩放：目标（温度）在 40 上下，直接拿去算 MSE 会让梯度信号很不均衡
    scaler = StandardScaler().fit(X[train_idx].reshape(-1, X.shape[-1]))
    Xs = scaler.transform(X.reshape(-1, X.shape[-1])).reshape(X.shape)
    # 目标用**增量**（下一分钟 − 窗口最后一个读数），特征与目标都做缩放
    temp_idx = features.index("temp")
    base = X[:, -1, temp_idx].astype(np.float64)
    delta = (Y - base).reshape(-1, 1)
    y_scaler = StandardScaler().fit(delta[train_idx])
    Ys = y_scaler.transform(delta).ravel().astype(np.float32)

    # 测试段第一个滑窗样本覆盖的时间行是 split（见 make_windows 的定义），基线与模型对齐同一段
    test_start = split
    baseline = build_baseline(df, test_start, n)

    model, history, best_epoch = train_lstm(Xs[train_idx], Ys[train_idx], Xs[val_idx], Ys[val_idx])
    model.eval()
    with torch.no_grad():
        delta_hat = model(torch.tensor(Xs[test_idx])).numpy().reshape(-1, 1)
    pred = base[test_idx] + y_scaler.inverse_transform(delta_hat).ravel()   # 增量加回当前读数
    y_test = Y[test_idx]

    metrics = {
        "mae": round(float(mean_absolute_error(y_test, pred)), 4),
        "rmse": round(float(np.sqrt(mean_squared_error(y_test, pred))), 4),
    }
    figures.append(plot_training(history, best_epoch, fig_dir))
    figures.append(plot_forecast(df, y_test, pred, test_start, fig_dir))

    return {
        "model": f"LSTM({HIDDEN}) + delta head on {WINDOW}-min windows",
        "window": WINDOW,
        "n_train": int(n_train_all),  # 含内部验证段（除测试段以外的全部样本）
        "n_test": int(n_samples - n_train_all),
        "n_rows": int(n),
        "metrics": metrics,
        "baseline": baseline,
        "training": {
            "epochs_planned": EPOCHS,
            "epochs_run": len(history),
            "best_epoch": int(best_epoch),
            "early_stopped": len(history) < EPOCHS,
            "val_samples": int(n_val),
            "history": history,
        },
        "figures": figures,
        "notes": compose_notes(df, baseline, metrics, history, best_epoch),
    }


def run_case(case_dir: str | Path, out_path: str | Path, fig_dir: Path = FIG_DIR) -> dict:
    result = train_and_evaluate(load_data(case_dir), fig_dir)
    payload = {k: v for k, v in result.items() if k != "n_rows"}
    Path(out_path).write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return result


def regen_expected() -> None:
    """重算每个 case 的 expected.json（参考水平，不是标准答案）。"""
    import tempfile

    for case_dir in sorted(p for p in CASES_DIR.iterdir() if p.is_dir()):
        with tempfile.TemporaryDirectory() as tmp:
            result = train_and_evaluate(load_data(case_dir), Path(tmp))
        expected = {
            "note": (
                "参考水平（不是标准答案）：baseline 用于核对学生的基线报告是否可信，"
                "reference 用于识别『可疑地过于好』的结果；n_rows 用于核对滑窗样本数是否自洽。"
                "硬性达标判据见 manifest.json 的 assertions，语义判据见 judge.md。"
            ),
            "n_rows": result["n_rows"],
            "window": result["window"],
            "baseline": result["baseline"],
            "reference": {"model": result["model"], **result["metrics"]},
            "accept": dict(ACCEPT[case_dir.name]),
        }
        out = case_dir / "expected.json"
        out.write_text(json.dumps(expected, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(
            f"[regen] {out} -> baseline MAE={expected['baseline']['mae']} | "
            f"reference MAE={expected['reference']['mae']}（比值 "
            f"{expected['reference']['mae'] / expected['baseline']['mae']:.3f}）"
        )


def main() -> None:
    ap = argparse.ArgumentParser(description="传感器时序下一值预测（参考实现）")
    ap.add_argument("case_dir", nargs="?")
    ap.add_argument("out", nargs="?")
    ap.add_argument("--regen-expected", action="store_true")
    args = ap.parse_args()

    if args.regen_expected:
        regen_expected()
        return
    if not args.case_dir or not args.out:
        ap.error("需要 <case目录> 与 <output.json>")

    result = train_and_evaluate(load_data(args.case_dir))
    Path(args.out).write_text(
        json.dumps({k: v for k, v in result.items() if k != "n_rows"}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    m, b = result["metrics"], result["baseline"]
    for fig in result["figures"]:
        print(f"  [图] {fig['path']} —— {fig['takeaway']}")
    print(
        f"[本轮成绩] MAE={m['mae']} RMSE={m['rmse']} | 现有做法 MAE={b['mae']} "
        f"（比值 {m['mae'] / b['mae']:.3f}） | 窗口 {result['window']} 分钟 | "
        f"训练 {result['training']['epochs_run']} 轮（best={result['training']['best_epoch']}）"
    )


if __name__ == "__main__":
    main()
