#!/usr/bin/env python3
"""实验一参考实现（学习示范）：`data.csv` → `output.json` + 三张图。

📖 这份实现**随题目包一起下发**（`problem/reference/`）—— 先读懂它，再写你自己的。
   **它不是唯一正确答案**：判据只要求"恶性样本 recall ≥ 0.90、precision ≥ 0.80，
   并且真的记录了逐轮训练历史"，换网络结构、换优化器、换早停策略同样能通过。

本实现走完**完整流程**（与 task.md 的六步对应）：
  ① 看清需求      —— 筛查要"宁可多报，不能漏报"（recall 优先）
  ② 看一眼数据    —— `plot_data_overview`：**画图**看类别分布与最有用的特征
  ③ 定基线        —— `build_baseline`：现有做法 = 按出厂参考上限（mean_radius > 15）判恶性
  ④ 训练模型      —— `train_mlp`：标准化 + 小 MLP + Adam + **早停**（逐轮记录 train/val loss）
  ⑤ 评估          —— `plot_evaluation`：**画图**看混淆矩阵（漏报 / 误报各多少）
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
from sklearn.metrics import confusion_matrix, precision_score, recall_score  # noqa: E402
from sklearn.model_selection import train_test_split  # noqa: E402
from sklearn.preprocessing import StandardScaler  # noqa: E402
from torch import nn  # noqa: E402

TARGET = "malignant"
RADIUS_LIMIT = 15.0  # 现有做法用的出厂参考上限（µm）
# 每个 case 的达标线（写进 expected.json 的 accept，供 manifest.json 的断言引用）：
# case02 来自"另一台仪器"、样本更少、还有测量噪声，线略低一档
ACCEPT = {
    "case01": {"recall_min": 0.90, "precision_min": 0.80},
    "case02": {"recall_min": 0.85, "precision_min": 0.80},
}
TEST_SIZE = 0.25
VAL_SIZE = 0.2
RANDOM_STATE = 42
HIDDEN = (32, 16)
EPOCHS = 200
PATIENCE = 20  # 连续多少轮验证损失没改善就停
LR = 0.01
FIG_DIR = Path("figures")

HERE = Path(__file__).resolve().parent
CASES_DIR = HERE.parent.parent / "cases"


def load_data(case_dir: str | Path) -> pd.DataFrame:
    """① / ② 读数据。"""
    return pd.read_csv(Path(case_dir) / "data.csv")


def top_feature(df: pd.DataFrame) -> str:
    """与目标相关性最高的特征（② 用它画对比图）。"""
    return str(df.drop(columns=[TARGET]).corrwith(df[TARGET]).abs().idxmax())


def plot_data_overview(df: pd.DataFrame, fig_dir: Path = FIG_DIR) -> dict:
    """② 看一眼数据（并画图）：类别是否均衡、最有用的特征在两类间差多少。"""
    fig_dir.mkdir(parents=True, exist_ok=True)
    feature = top_feature(df)
    fig, axes = plt.subplots(1, 2, figsize=(10, 4))
    counts = df[TARGET].value_counts().sort_index()
    axes[0].bar([str(i) for i in counts.index], counts.to_numpy(), color="#4C78A8")
    axes[0].set_xlabel("malignant (0 = benign, 1 = malignant)")
    axes[0].set_ylabel("count")
    axes[0].set_title("Class balance")
    for i, v in enumerate(counts.to_numpy()):
        axes[0].text(i, v, str(int(v)), ha="center", va="bottom")
    for label, color in ((0, "#54A24B"), (1, "#E45756")):
        axes[1].hist(df.loc[df[TARGET] == label, feature], bins=25, alpha=0.65, color=color, label=str(label))
    axes[1].set_xlabel(feature)
    axes[1].set_ylabel("count")
    axes[1].set_title(f"{feature} by class")
    axes[1].legend(title="malignant")
    fig.tight_layout()
    path = fig_dir / "data_overview.png"
    fig.savefig(path, dpi=110)
    plt.close(fig)
    rate = df[TARGET].mean()
    med0, med1 = df.loc[df[TARGET] == 0, feature].median(), df.loc[df[TARGET] == 1, feature].median()
    takeaway = (
        f"恶性样本占 {rate:.0%}（样本并不均衡，不能只看准确率）；"
        f"{feature} 在两类间分布明显分开（良性中位数 {med0:.3g}、恶性 {med1:.3g}），是最主要的依据；"
        f"但两类仍有重叠区，单靠一个特征会漏报。"
    )
    return {"path": str(path), "takeaway": takeaway}


def build_baseline(y_true: np.ndarray, radius: pd.Series) -> dict:
    """③ 现有做法：只看 `mean_radius`，超过出厂参考上限就判恶性。"""
    pred = (radius.to_numpy() >= RADIUS_LIMIT).astype(int)
    return {
        "name": f"radius_threshold_{RADIUS_LIMIT:g}",
        "recall": round(float(recall_score(y_true, pred, zero_division=0)), 4),
        "precision": round(float(precision_score(y_true, pred, zero_division=0)), 4),
        "accuracy": round(float((pred == y_true).mean()), 4),
    }


def train_mlp(X_train, y_train, X_val, y_val):
    """④ 训练：小 MLP + Adam + 早停（逐轮记录 train/val 损失，供训练曲线用）。"""
    torch.manual_seed(RANDOM_STATE)
    model = nn.Sequential(
        nn.Linear(X_train.shape[1], HIDDEN[0]),
        nn.ReLU(),
        nn.Dropout(0.2),
        nn.Linear(HIDDEN[0], HIDDEN[1]),
        nn.ReLU(),
        nn.Linear(HIDDEN[1], 1),
    )
    opt = torch.optim.Adam(model.parameters(), lr=LR)
    loss_fn = nn.BCEWithLogitsLoss()
    xt = torch.tensor(X_train, dtype=torch.float32)
    yt = torch.tensor(y_train, dtype=torch.float32).view(-1, 1)
    xv = torch.tensor(X_val, dtype=torch.float32)
    yv = torch.tensor(y_val, dtype=torch.float32).view(-1, 1)

    history, best_loss, best_state, best_epoch, waits = [], float("inf"), None, 0, 0
    for epoch in range(1, EPOCHS + 1):
        model.train()
        opt.zero_grad()
        loss = loss_fn(model(xt), yt)
        loss.backward()
        opt.step()
        model.eval()
        with torch.no_grad():
            val_loss = float(loss_fn(model(xv), yv))
        history.append(
            {"epoch": epoch, "loss": round(loss.item(), 4), "val_loss": round(val_loss, 4)}
        )
        if val_loss < best_loss - 1e-4:
            best_loss, best_epoch, waits = val_loss, epoch, 0
            best_state = copy.deepcopy(model.state_dict())
        else:
            waits += 1
            if waits >= PATIENCE:
                break
    model.load_state_dict(best_state)
    return model, history, best_epoch


def plot_training(history: list[dict], best_epoch: int, fig_dir: Path = FIG_DIR) -> dict:
    """⑤ 评估（并画图）之一：训练曲线 —— 训练诊断就靠它。"""
    fig_dir.mkdir(parents=True, exist_ok=True)
    epochs = [h["epoch"] for h in history]
    fig, ax = plt.subplots(figsize=(6, 4))
    ax.plot(epochs, [h["loss"] for h in history], label="train loss", color="#4C78A8")
    ax.plot(epochs, [h["val_loss"] for h in history], label="val loss", color="#E45756")
    ax.axvline(best_epoch, color="gray", ls="--", lw=1, label=f"best epoch = {best_epoch}")
    ax.set_xlabel("epoch")
    ax.set_ylabel("BCE loss")
    ax.set_title("Training curves")
    ax.legend()
    fig.tight_layout()
    path = fig_dir / "training_curve.png"
    fig.savefig(path, dpi=110)
    plt.close(fig)
    last = history[-1]
    gap = last["val_loss"] - last["loss"]
    takeaway = (
        f"训练损失一路降到 {last['loss']:.3f}；验证损失在第 {best_epoch} 轮最低（{min(h['val_loss'] for h in history):.3f}）"
        f"后不再改善，末轮两者相差 {gap:+.3f} —— 已经出现轻微过拟合，所以取最优轮次而不是最后一轮。"
    )
    return {"path": str(path), "takeaway": takeaway}


def plot_evaluation(y_true: np.ndarray, pred: np.ndarray, fig_dir: Path = FIG_DIR) -> dict:
    """⑤ 评估（并画图）之二：混淆矩阵 —— 漏报（FN）与误报（FP）各多少。"""
    fig_dir.mkdir(parents=True, exist_ok=True)
    cm = confusion_matrix(y_true, pred, labels=[0, 1])
    fig, ax = plt.subplots(figsize=(4.6, 4))
    im = ax.imshow(cm, cmap="Blues")
    for i in range(2):
        for j in range(2):
            ax.text(j, i, str(int(cm[i, j])), ha="center", va="center",
                    color="white" if cm[i, j] > cm.max() / 2 else "black")
    ax.set_xticks([0, 1], ["pred benign", "pred malignant"])
    ax.set_yticks([0, 1], ["true benign", "true malignant"])
    ax.set_title("Confusion matrix")
    fig.colorbar(im, ax=ax, shrink=0.8)
    fig.tight_layout()
    path = fig_dir / "evaluation.png"
    fig.savefig(path, dpi=110)
    plt.close(fig)
    fn, fp = int(cm[1, 0]), int(cm[0, 1])
    takeaway = (
        f"漏报（真恶性判成良性）{fn} 例、误报 {fp} 例；漏报是本任务最贵的错误，"
        f"所以宁可让误报多一些，也不要把漏报压到 0 以下的空间里换准确率。"
    )
    return {"path": str(path), "takeaway": takeaway}


def compose_notes(
    df: pd.DataFrame, baseline: dict, metrics: dict, n_malignant: int, history: list[dict], best_epoch: int
) -> str:
    """⑥ 写结论：看过什么 → 怎么处理 → 与基线比如何 → 还有什么不足。"""
    missed = int(round((1 - metrics["recall"]) * n_malignant))
    return (
        f"先看图：恶性占 {df[TARGET].mean():.0%}、{top_feature(df)} 最区分两类但有重叠，"
        f"且各列量程差几个数量级（所以必须先标准化，否则网络学不动）。"
        f"现有做法（只看 mean_radius ≥ {RADIUS_LIMIT:g}）在 test 上 recall {baseline['recall']:.2f}、"
        f"precision {baseline['precision']:.2f}；改用 {df.shape[1] - 1} 列特征训练 MLP（{'/'.join(map(str, HIDDEN))} 隐层 + "
        f"dropout + Adam + 早停，第 {best_epoch} 轮取得最优验证损失，共跑 {len(history)} 轮）后，"
        f"recall {metrics['recall']:.2f}、precision {metrics['precision']:.2f}。"
        f"不足：漏报仍有 {missed} 例左右，若临床上更在意漏报，可以把判定阈值往下调（用误报换漏报）。"
    )


def train_and_evaluate(df: pd.DataFrame, fig_dir: Path = FIG_DIR) -> dict:
    """② → ⑥ 完整流程。"""
    figures = [plot_data_overview(df, fig_dir)]

    features = [c for c in df.columns if c != TARGET]
    X_all, y_all = df[features].to_numpy(dtype=float), df[TARGET].to_numpy(dtype=int)
    X_train_all, X_test, y_train_all, y_test = train_test_split(
        X_all, y_all, test_size=TEST_SIZE, random_state=RANDOM_STATE, stratify=y_all
    )
    X_train, X_val, y_train, y_val = train_test_split(
        X_train_all, y_train_all, test_size=VAL_SIZE, random_state=RANDOM_STATE, stratify=y_train_all
    )

    scaler = StandardScaler().fit(X_train)  # 只用训练集拟合：避免把测试集信息漏进训练
    baseline = build_baseline(y_test, pd.Series(X_test[:, features.index("mean_radius")]))

    model, history, best_epoch = train_mlp(
        scaler.transform(X_train), y_train, scaler.transform(X_val), y_val
    )
    model.eval()
    with torch.no_grad():
        logits = model(torch.tensor(scaler.transform(X_test), dtype=torch.float32))
    pred = (torch.sigmoid(logits).numpy().ravel() >= 0.5).astype(int)

    metrics = {
        "recall": round(float(recall_score(y_test, pred, zero_division=0)), 4),
        "precision": round(float(precision_score(y_test, pred, zero_division=0)), 4),
        "accuracy": round(float((pred == y_test).mean()), 4),
    }
    figures.append(plot_training(history, best_epoch, fig_dir))
    figures.append(plot_evaluation(y_test, pred, fig_dir))

    return {
        "model": f"MLP{HIDDEN} + dropout + Adam + early stop",
        "n_train": int(len(X_train) + len(X_val)),
        "n_test": int(len(X_test)),
        "n_rows": int(len(df)),
        "metrics": metrics,
        "baseline": baseline,
        "training": {
            "epochs_planned": EPOCHS,
            "epochs_run": len(history),
            "best_epoch": int(best_epoch),
            "early_stopped": len(history) < EPOCHS,
            "hidden_layers": list(HIDDEN),
            "history": history,
        },
        "figures": figures,
        "notes": compose_notes(df, baseline, metrics, int(y_test.sum()), history, best_epoch),
    }


def run_case(case_dir: str | Path, out_path: str | Path, fig_dir: Path = FIG_DIR) -> dict:
    result = train_and_evaluate(load_data(case_dir), fig_dir)
    payload = {k: v for k, v in result.items() if k != "n_rows"}
    Path(out_path).write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return result


def regen_expected() -> None:
    """重算每个 case 的 expected.json（参考水平，不是标准答案）。

    ⚠️ 画图会写文件，但这里只为取数值 —— 图写到临时目录，不进仓库。
    """
    import tempfile

    for case_dir in sorted(p for p in CASES_DIR.iterdir() if p.is_dir()):
        with tempfile.TemporaryDirectory() as tmp:
            result = train_and_evaluate(load_data(case_dir), Path(tmp))
        expected = {
            "note": (
                "参考水平（不是标准答案）：baseline 用于核对学生的基线报告是否可信，"
                "reference 用于识别『可疑地过于好』的结果；n_rows 用于核对切分是否覆盖全部样本。"
                "硬性达标判据见 manifest.json 的 assertions，语义判据见 judge.md。"
            ),
            "n_rows": result["n_rows"],
            "baseline": result["baseline"],
            "reference": {
                "model": result["model"],
                "recall": result["metrics"]["recall"],
                "precision": result["metrics"]["precision"],
            },
            "accept": {
                **ACCEPT[case_dir.name],
                "baseline_recall_tolerance": 0.15,
                "baseline_precision_tolerance": 0.25,
            },
        }
        out = case_dir / "expected.json"
        out.write_text(json.dumps(expected, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(
            f"[regen] {out} -> baseline recall={expected['baseline']['recall']} "
            f"precision={expected['baseline']['precision']} | reference recall={expected['reference']['recall']} "
            f"precision={expected['reference']['precision']}"
        )


def main() -> None:
    ap = argparse.ArgumentParser(description="辅助筛查（训练诊断 · 参考实现）")
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
        f"[{'达标' if m['recall'] >= 0.9 and m['precision'] >= 0.8 else '未达标'}] "
        f"recall={m['recall']} precision={m['precision']} | 基线 recall={b['recall']} precision={b['precision']} "
        f"| 训练 {result['training']['epochs_run']} 轮（best={result['training']['best_epoch']}）"
    )


if __name__ == "__main__":
    main()
