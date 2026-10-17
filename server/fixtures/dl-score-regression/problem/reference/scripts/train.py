#!/usr/bin/env python3
"""按练习情况估算成绩的参考实现（学习示范）：`data.csv` → `output.json` + 三张图。

📖 这份实现**随题目包一起下发**（`problem/reference/`）—— 先读懂它，再写你自己的。
   **它不是唯一正确答案**：判据只要求"MAE 比平均分基线低 ≥40% + 真的训练过 + 看图说话"，
   换隐藏层大小、换激活函数、换优化器同样能通过。

本实现走完**完整流程**（与 task.md 的六步对应）：
  ① 看清需求      —— 提前发现需要补课的学生；比"一律报平均分"准得多
  ② 看一眼数据    —— `plot_data_overview`：**画图**看练习时长/出勤与成绩的关系（注意它是弯的）
  ③ 定基线        —— `build_baseline`：一律报训练集的平均分
  ④ 训练模型      —— `train_model`：两层 MLP（2 → 16 → 1），**逐轮记录训练损失**
  ⑤ 评估          —— `plot_training_curve` / `plot_evaluation`：**画图**看损失与误差
  ⑥ 写结论        —— `compose_notes` + 每张图一句 takeaway

用法：
  python3 scripts/train.py <case目录> <output.json>     # 单个 case（图写到当前目录的 figures/）
  python3 scripts/train.py --regen-expected             # 重算 problem/cases/*/expected.json

请在**与复验同一个镜像内**生成 expected（当前 pkg6）：

  docker run --rm -v "$PWD:/w" --entrypoint python3 \
    nju-lab-verify:0.2.0-rc.2-pkg6 /w/problem/reference/scripts/train.py --regen-expected
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
from sklearn.metrics import mean_absolute_error, r2_score  # noqa: E402
from sklearn.model_selection import train_test_split  # noqa: E402
from torch import nn  # noqa: E402

TARGET = "final_score"
FEATURES = ["weekly_hours", "attendance_rate"]
TEST_SIZE = 0.25
RANDOM_STATE = 42
HIDDEN = 16
EPOCHS = 200
LR = 0.05
FIG_DIR = Path("figures")

# 每个 case 的达标线（写进 expected.json 的 accept，供 manifest.json 的断言引用）：
# 线卡在"单特征直线"（比值约 0.58）与"会拐弯的小网络"（约 0.4）之间
ACCEPT = {
    "case01": {"mae_max_ratio_to_baseline": 0.55, "baseline_tolerance": 0.15},
    "case02": {"mae_max_ratio_to_baseline": 0.55, "baseline_tolerance": 0.15},
}

HERE = Path(__file__).resolve().parent
CASES_DIR = HERE.parent.parent / "cases"


class MLP(nn.Module):
    """两层全连接回归网络：2 个特征 → 16 个隐藏单元 → 1 个分数。"""

    def __init__(self, n_in: int = len(FEATURES), n_hidden: int = HIDDEN):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(n_in, n_hidden),
            nn.ReLU(),
            nn.Linear(n_hidden, 1),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x).squeeze(-1)


def load_data(case_dir: str | Path) -> pd.DataFrame:
    """① / ② 读数据。"""
    return pd.read_csv(Path(case_dir) / "data.csv")


def plot_data_overview(df: pd.DataFrame, fig_dir: Path = FIG_DIR) -> dict:
    """② 看一眼数据（并画图）：练习时长、出勤率分别与成绩是什么关系。

    返回 figures 字段的一项：{"path": ..., "takeaway": ...}
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

    low = df[df["weekly_hours"] <= 5][TARGET].mean()
    high = df[df["weekly_hours"] >= 20][TARGET].mean()
    takeaway = (
        f"成绩随练习时长上升，但「明显是弯的」：0~5 小时段平均 {low:.0f} 分，"
        f"20 小时以上平均 {high:.0f} 分 —— 前段涨得快、后段基本平了（收益递减）；"
        f"出勤率也同向，散布更宽。用一条直线去拟合，中间段会被系统性估偏。"
    )
    return {"path": str(path), "takeaway": takeaway}


def build_baseline(y_train: np.ndarray, y_test: np.ndarray) -> dict:
    """③ 现有做法（不建模）：一律报训练集的平均分。"""
    pred = np.full_like(y_test, float(y_train.mean()), dtype=float)
    return {"name": "mean_score", "mae": round(float(mean_absolute_error(y_test, pred)), 4)}


def train_model(X_train: np.ndarray, y_train: np.ndarray):
    """④ 训练模型：输入与目标都标准化 + 两层 MLP，逐轮记录训练损失。"""
    mean, std = X_train.mean(axis=0), X_train.std(axis=0)
    std[std == 0] = 1.0
    Xn = (X_train - mean) / std
    y_mean, y_std = float(y_train.mean()), float(y_train.std()) or 1.0
    yn = (y_train - y_mean) / y_std

    torch.manual_seed(RANDOM_STATE)
    model = MLP()
    optimizer = torch.optim.Adam(model.parameters(), lr=LR)
    loss_fn = nn.MSELoss()

    X_t = torch.from_numpy(Xn.astype(np.float32))
    y_t = torch.from_numpy(yn.astype(np.float32))
    history: list[dict] = []
    for epoch in range(1, EPOCHS + 1):
        model.train()
        optimizer.zero_grad()
        loss = loss_fn(model(X_t), y_t)
        loss.backward()
        optimizer.step()
        history.append({"epoch": epoch, "train_loss": round(float(loss.item()), 4)})
    return model, mean, std, y_mean, y_std, history


def plot_training_curve(history: list[dict], fig_dir: Path = FIG_DIR) -> dict:
    """⑤ 训练曲线：损失有没有真的降下来。"""
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

    takeaway = (
        f"训练损失从第 1 轮的 {losses[0]:.2f} 降到第 {epochs[-1]} 轮的 {losses[-1]:.2f}，"
        f"前 20 轮降得最快、之后越来越平 —— 网络先把'大致趋势'学会，再慢慢打磨细节；"
        f"到第 {epochs[-1]} 轮已经基本平了，再训收益不大。"
    )
    return {"path": str(path), "takeaway": takeaway}


def plot_evaluation(y_true: np.ndarray, pred: np.ndarray, fig_dir: Path = FIG_DIR) -> dict:
    """⑤ 评估（并画图）：预测 vs 实际、残差分布。"""
    fig_dir.mkdir(parents=True, exist_ok=True)
    residual = y_true - pred
    fig, axes = plt.subplots(1, 2, figsize=(10, 4))

    lo = float(min(y_true.min(), pred.min()))
    hi = float(max(y_true.max(), pred.max()))
    axes[0].scatter(y_true, pred, s=16, alpha=0.6, color="#4C78A8")
    axes[0].plot([lo, hi], [lo, hi], "r--", lw=1, label="ideal y = x")
    axes[0].set_xlabel("actual score")
    axes[0].set_ylabel("predicted score")
    axes[0].set_title("Predicted vs actual")
    axes[0].legend()

    axes[1].hist(residual, bins=25, color="#54A24B")
    axes[1].axvline(0, color="r", ls="--", lw=1)
    axes[1].set_xlabel("residual (actual - predicted)")
    axes[1].set_title("Residuals")

    fig.tight_layout()
    path = fig_dir / "evaluation.png"
    fig.savefig(path, dpi=110)
    plt.close(fig)

    takeaway = (
        f"预测点整体贴着 y=x；残差中位数 {np.median(residual):.1f} 分、大致以 0 为中心，"
        f"说明没有系统性高估或低估；最大的误差出现在 90 分以上的高分段，"
        f"那里样本少、且成绩接近满分上限，本来就更难估准。"
    )
    return {"path": str(path), "takeaway": takeaway}


def compose_notes(baseline: dict, mae: float, r2: float, history: list[dict]) -> str:
    """⑥ 写结论：看图得到的印象 → 选了什么网络 → 与基线比如何 → 不足。"""
    gain = (1 - mae / baseline["mae"]) * 100 if baseline["mae"] else 0.0
    return (
        f"散点图显示练习时长与成绩是「饱和曲线」（先快后慢），直线拟合会在中段系统性偏差，"
        f"所以用一层隐藏层的小网络（2→{HIDDEN}→1）去学这条曲线：训练 {len(history)} 轮，"
        f"损失从 {history[0]['train_loss']:.2f} 降到 {history[-1]['train_loss']:.2f}。"
        f"测试集 MAE {mae} 分、R² {r2}，比「一律报平均分」的基线（{baseline['mae']} 分）低约 {gain:.0f}%。"
        f"不足：只用了练习时长与出勤率两个因素，高分段样本少、误差偏大；"
        f"真实成绩还受基础、考试状态等影响。"
    )


def train_and_evaluate(df: pd.DataFrame, fig_dir: Path = FIG_DIR) -> dict:
    """② → ⑥ 完整流程：画图看数据 → 定基线 → 训练 → 画图评估 → 组织结论。"""
    figures = [plot_data_overview(df, fig_dir)]

    X = df[FEATURES].to_numpy(dtype=float)
    y = df[TARGET].to_numpy(dtype=float)
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=TEST_SIZE, random_state=RANDOM_STATE
    )

    baseline = build_baseline(y_train, y_test)
    model, mean, std, y_mean, y_std, history = train_model(X_train, y_train)
    figures.append(plot_training_curve(history, fig_dir))

    model.eval()
    with torch.no_grad():
        Xn = (X_test - mean) / std
        pred = model(torch.from_numpy(Xn.astype(np.float32))).numpy() * y_std + y_mean

    mae = round(float(mean_absolute_error(y_test, pred)), 4)
    r2 = round(float(r2_score(y_test, pred)), 4)
    figures.append(plot_evaluation(y_test, pred, fig_dir))

    return {
        "model": f"MLP(2→{HIDDEN}→1, ReLU, Adam)",
        "n_train": int(len(X_train)),
        "n_test": int(len(X_test)),
        "n_rows": int(len(df)),
        "metrics": {"mae": mae, "r2": r2},
        "baseline": baseline,
        "training": {
            "epochs": len(history),
            "optimizer": f"Adam(lr={LR})",
            "loss": "MSELoss",
            "history": history,
        },
        "figures": figures,
        "notes": compose_notes(baseline, mae, r2, history),
    }


def run_case(case_dir: str | Path, out_path: str | Path, fig_dir: Path = FIG_DIR) -> dict:
    case = Path(case_dir).name
    result = train_and_evaluate(load_data(case_dir), fig_dir)
    payload = {k: v for k, v in result.items() if k != "n_rows"}
    Path(out_path).write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    ratio = result["metrics"]["mae"] / result["baseline"]["mae"]
    ok = ratio <= ACCEPT[case]["mae_max_ratio_to_baseline"]
    print(f"[{case}] {'达标' if ok else '未达标'} MAE={result['metrics']['mae']} "
          f"基线={result['baseline']['mae']}（比值 {ratio:.2f}，要求 ≤ "
          f"{ACCEPT[case]['mae_max_ratio_to_baseline']:.2f}）")
    return result


def regen_expected() -> None:
    """重算每个 case 的 expected.json（参考水平，不是标准答案）。

    ⚠️ 画图会写文件，但这里只为取数值 —— 图写到临时目录，不进仓库。
    """
    import tempfile

    for case_dir in sorted(p for p in CASES_DIR.iterdir() if p.is_dir()):
        case = case_dir.name
        with tempfile.TemporaryDirectory() as tmp:
            result = train_and_evaluate(load_data(case_dir), Path(tmp))
        expected = {
            "note": (
                "参考水平（不是标准答案）：baseline 用于核对学生报的基线是否可信，"
                "reference 用于识别『可疑地过于好』的结果；n_rows 用于核对切分是否覆盖全部样本。"
                "硬性达标判据见 manifest.json 的 assertions，语义判据见 judge.md。"
            ),
            "n_rows": result["n_rows"],
            "baseline": result["baseline"],
            "reference": {"model": result["model"], "mae": result["metrics"]["mae"]},
            "accept": ACCEPT[case],
        }
        out = case_dir / "expected.json"
        out.write_text(json.dumps(expected, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(
            f"[regen] {out} -> baseline={expected['baseline']['mae']} "
            f"reference={expected['reference']['mae']}（{expected['reference']['model']}）"
        )


def main() -> None:
    ap = argparse.ArgumentParser(description="按练习情况估算期末成绩（参考实现）")
    ap.add_argument("case_dir", nargs="?")
    ap.add_argument("out", nargs="?")
    ap.add_argument("--regen-expected", action="store_true")
    args = ap.parse_args()

    if args.regen_expected:
        regen_expected()
        return
    if not args.case_dir or not args.out:
        ap.error("需要 <case目录> 与 <output.json>")

    result = run_case(args.case_dir, args.out)
    for fig in result["figures"]:
        print(f"  [图] {fig['path']} —— {fig['takeaway']}")


if __name__ == "__main__":
    main()
