#!/usr/bin/env python3
"""实验二参考实现（学习示范）：`data.csv` → `output.json` + 三张图。

📖 这份实现**随题目包一起下发**（`problem/reference/`）—— 先读懂它，再写你自己的。
   **它不是唯一正确答案**：判据只要求"macro F1 达标 + 每一档召回率不低于达标线
   + 逐轮训练历史齐全"，换卷积核大小/通道数、加数据增强、换优化器同样能通过。

本实现走完**完整流程**（与 task.md 的六步对应）：
  ① 看清需求      —— 每一档都要认得出来（串档比多报更贵）
  ② 看一眼数据    —— `plot_data_overview`：**画图**看逐档样本数与图像长什么样
  ③ 定基线        —— `build_baseline`：现有做法 = 把像素直接丢给线性分类器（上一版系统）
  ④ 训练模型      —— `train_cnn`：小卷积网络 + **训练期平移增强** + Adam + **早停**（逐轮记录 train/val 损失）
  ⑤ 评估          —— `plot_evaluation`：**画图**看 10×10 混淆矩阵（哪两档会被搞混）
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
import torch.nn.functional as F  # noqa: E402
from sklearn.linear_model import LogisticRegression  # noqa: E402
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score, recall_score  # noqa: E402
from sklearn.model_selection import train_test_split  # noqa: E402
from torch import nn  # noqa: E402

TARGET = "label"
SIDE = 8
N_CLASSES = 10
TEST_SIZE = 0.25
VAL_SIZE = 0.2
RANDOM_STATE = 42
EPOCHS = 60
PATIENCE = 12  # 连续多少轮验证损失没改善就停
LR = 3e-3
BATCH = 64
AUGMENT_SHIFT = 1  # 训练时随机平移的幅度（像素）：模拟扫描偏移，让模型别死记像素位置
FIG_DIR = Path("figures")

# 每个 case 的达标线（写进 expected.json 的 accept，供 manifest.json 的断言引用）：
# case02 是"扫描质量差"的那一批（平移 + 噪点 + 两档样本更少），线略低一档
ACCEPT = {
    # case01 是"扫描质量好"的基础批次：上一版系统也能过关（刻意留的常规路径），
    # case02 才是分水岭 —— 平移 + 噪点 + 两档样本更少，不改做法必然掉下去
    "case01": {"macro_f1_min": 0.93, "per_class_recall_min": 0.85},
    "case02": {"macro_f1_min": 0.85, "per_class_recall_min": 0.65},
}

HERE = Path(__file__).resolve().parent
CASES_DIR = HERE.parent.parent / "cases"


def load_data(case_dir: str | Path) -> pd.DataFrame:
    """① / ② 读数据。"""
    return pd.read_csv(Path(case_dir) / "data.csv")


def to_arrays(df: pd.DataFrame):
    """把像素列还原成 (N, 1, 8, 8) 的图像张量输入形状。"""
    pixels = [c for c in df.columns if c != TARGET]
    X = df[pixels].to_numpy(dtype=np.float32).reshape(-1, 1, SIDE, SIDE)
    y = df[TARGET].to_numpy(dtype=np.int64)
    return X, y


def plot_data_overview(df: pd.DataFrame, fig_dir: Path = FIG_DIR) -> dict:
    """② 看一眼数据（并画图）：逐档样本数 + 每一档挑一张缩略图。"""
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
    for x, v in zip(counts.index.to_numpy(), counts.to_numpy()):
        ax0.text(x, v, str(int(v)), ha="center", va="bottom", fontsize=7)
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
    scarce = counts[counts < counts.max() * 0.8]
    takeaway = (
        f"每档样本数 {'大致均衡' if scarce.empty else '并不均衡'}（最少 {int(counts.min())} 张、最多 {int(counts.max())} 张"
        f"{'，数字 ' + '/'.join(str(i) for i in scarce.index) + ' 明显更少' if not scarce.empty else ''}）；"
        f"缩略图只有 8×8，笔画位置本身就是重要信息 —— 位置一变，靠固定像素权重的方法就会失灵。"
    )
    return {"path": str(path), "takeaway": takeaway}


def build_baseline(X_train, y_train, X_test, y_test) -> dict:
    """③ 现有做法（上一版系统）：把 64 个像素直接丢给线性分类器。"""
    clf = LogisticRegression(max_iter=1000, random_state=RANDOM_STATE)
    clf.fit(X_train.reshape(len(X_train), -1), y_train)
    pred = clf.predict(X_test.reshape(len(X_test), -1))
    return {
        "name": "linear_on_raw_pixels",
        "macro_f1": round(float(f1_score(y_test, pred, average="macro", zero_division=0)), 4),
        "accuracy": round(float(accuracy_score(y_test, pred)), 4),
        "per_class_recall": [
            round(float(v), 4)
            for v in recall_score(y_test, pred, labels=range(N_CLASSES), average=None, zero_division=0)
        ],
    }


class SmallCNN(nn.Module):
    """小卷积网络：局部连接 + 池化 —— 对平移比"全连接看固定像素"稳。"""

    def __init__(self, n_classes: int = N_CLASSES):
        super().__init__()
        self.features = nn.Sequential(
            nn.Conv2d(1, 16, kernel_size=3, padding=1),
            nn.ReLU(),
            nn.MaxPool2d(2),          # 8×8 → 4×4
            nn.Conv2d(16, 32, kernel_size=3, padding=1),
            nn.ReLU(),
            nn.MaxPool2d(2),          # 4×4 → 2×2
        )
        self.head = nn.Sequential(nn.Flatten(), nn.Linear(32 * 2 * 2, 64), nn.ReLU(), nn.Linear(64, n_classes))

    def forward(self, x):
        return self.head(self.features(x))


def augment_batch(x: torch.Tensor, span: int = AUGMENT_SHIFT) -> torch.Tensor:
    """训练期**数据增强**：把一小批样本随机平移 ±span 像素（零填充），模拟扫描进纸偏移。

    case02 的扫描件本身就是平移过的；如果训练时只喂"对齐好的"图像，
    模型会学成"记住像素位置"，一到偏移样本上就失灵。
    """
    out = x.clone()
    if torch.rand(1).item() < 0.5:      # 一半的批次原样喂进去（免得只会认"移过位"的图）
        return out
    group = max(1, len(x) // 8)
    for k in range(0, len(x), group):
        dy, dx = torch.randint(-span, span + 1, (2,)).tolist()
        if dy or dx:
            sub = F.pad(x[k:k + group], (span, span, span, span))
            out[k:k + group] = sub[:, :, span + dy:span + dy + SIDE, span + dx:span + dx + SIDE]
    return out


def train_cnn(X_train, y_train, X_val, y_val):
    """④ 训练：小卷积网络 + 平移增强 + Adam + 早停（逐轮记录 train/val 损失，供训练曲线用）。"""
    torch.manual_seed(RANDOM_STATE)
    model = SmallCNN()
    opt = torch.optim.Adam(model.parameters(), lr=LR)
    loss_fn = nn.CrossEntropyLoss()
    xt = torch.tensor(X_train)
    yt = torch.tensor(y_train)
    xv = torch.tensor(X_val)
    yv = torch.tensor(y_val)

    history, best_loss, best_state, best_epoch, waits = [], float("inf"), None, 0, 0
    for epoch in range(1, EPOCHS + 1):
        model.train()
        perm = torch.randperm(len(xt))
        total = 0.0
        for i in range(0, len(xt), BATCH):          # 小批量：每轮多次更新，收敛快得多
            idx = perm[i:i + BATCH]
            opt.zero_grad()
            loss = loss_fn(model(augment_batch(xt[idx])), yt[idx])   # 训练样本先做平移增强
            loss.backward()
            opt.step()
            total += loss.item() * len(idx)         # 按样本数加权累加
        model.eval()
        train_loss = total / len(xt)                # ⚠️ 除以**样本数**（不是批次数）
        with torch.no_grad():
            val_loss = float(loss_fn(model(xv), yv))
        history.append({"epoch": epoch, "loss": round(train_loss, 4), "val_loss": round(val_loss, 4)})
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
    """⑤ 评估（并画图）之一：训练曲线 —— 看从哪一轮开始过拟合。"""
    fig_dir.mkdir(parents=True, exist_ok=True)
    epochs = [h["epoch"] for h in history]
    fig, ax = plt.subplots(figsize=(6, 4))
    ax.plot(epochs, [h["loss"] for h in history], label="train loss", color="#4C78A8")
    ax.plot(epochs, [h["val_loss"] for h in history], label="val loss", color="#E45756")
    ax.axvline(best_epoch, color="gray", ls="--", lw=1, label=f"best epoch = {best_epoch}")
    ax.set_xlabel("epoch")
    ax.set_ylabel("cross-entropy loss")
    ax.set_title("Training curves")
    ax.legend()
    fig.tight_layout()
    path = fig_dir / "training_curve.png"
    fig.savefig(path, dpi=110)
    plt.close(fig)
    takeaway = (
        f"训练损失最低到 {min(h['loss'] for h in history):.3f}、验证损失最低到 "
        f"{min(h['val_loss'] for h in history):.3f}；验证损失第 {best_epoch} 轮触底后不再改善 —— "
        f"再练下去只是在拟合训练样本，所以交出去的是最优轮次的权重。"
    )
    return {"path": str(path), "takeaway": takeaway}


def plot_evaluation(y_test, pred, fig_dir: Path = FIG_DIR) -> dict:
    """⑤ 评估（并画图）之二：10×10 混淆矩阵 —— 哪两档容易被搞混。"""
    fig_dir.mkdir(parents=True, exist_ok=True)
    cm = confusion_matrix(y_test, pred, labels=list(range(N_CLASSES)))
    fig, ax = plt.subplots(figsize=(5.4, 4.6))
    im = ax.imshow(cm, cmap="Blues")
    for i in range(N_CLASSES):
        for j in range(N_CLASSES):
            if cm[i, j]:
                ax.text(j, i, str(int(cm[i, j])), ha="center", va="center", fontsize=6,
                        color="white" if cm[i, j] > cm.max() / 2 else "black")
    ax.set_xticks(range(N_CLASSES))
    ax.set_yticks(range(N_CLASSES))
    ax.set_xlabel("predicted")
    ax.set_ylabel("actual")
    ax.set_title("Confusion matrix")
    fig.colorbar(im, ax=ax, shrink=0.8)
    fig.tight_layout()
    path = fig_dir / "evaluation.png"
    fig.savefig(path, dpi=110)
    plt.close(fig)
    off = cm.copy()
    np.fill_diagonal(off, 0)
    i, j = np.unravel_index(int(off.argmax()), off.shape)
    takeaway = (
        f"对角线之外最多的是「真 {i} 被判成 {j}」（{int(off[i, j])} 张）；"
        f"这两档笔画接近、又常被扫描偏移搅在一起，是这一批数据的主要错因。"
    )
    return {"path": str(path), "takeaway": takeaway}


def compose_notes(df: pd.DataFrame, baseline: dict, metrics: dict, history: list[dict], best_epoch: int) -> str:
    """⑥ 写结论：看过什么 → 怎么处理 → 与基线比如何 → 还有什么不足。"""
    counts = df[TARGET].value_counts()
    worst = int(np.argmin(metrics["per_class_recall"]))
    balance = "大致均衡" if counts.min() > counts.max() * 0.8 else "并不均衡"
    return (
        f"先看图：每档样本数{balance}、图像只有 8×8，笔画位置本身就是信息。"
        f"现有做法（像素直接进线性分类器）的 macro F1 只有 "
        f"{baseline['macro_f1']:.2f}；改用卷积网络（局部连接 + 池化）并在训练时做**平移增强**后升到 "
        f"{metrics['macro_f1']:.2f}"
        f"（训练 {len(history)} 轮，第 {best_epoch} 轮验证损失最低）。不足：数字 {worst} 的召回率最低"
        f"（{metrics['per_class_recall'][worst]:.2f}），可以加「平移/旋转」的数据增强针对性补一补。"
    )


def train_and_evaluate(df: pd.DataFrame, fig_dir: Path = FIG_DIR) -> dict:
    """② → ⑥ 完整流程。"""
    figures = [plot_data_overview(df, fig_dir)]

    X, y = to_arrays(df)
    X_train_all, X_test, y_train_all, y_test = train_test_split(
        X, y, test_size=TEST_SIZE, random_state=RANDOM_STATE, stratify=y
    )
    X_train, X_val, y_train, y_val = train_test_split(
        X_train_all, y_train_all, test_size=VAL_SIZE, random_state=RANDOM_STATE, stratify=y_train_all
    )

    baseline = build_baseline(X_train, y_train, X_test, y_test)  # 同一测试集
    model, history, best_epoch = train_cnn(X_train, y_train, X_val, y_val)
    model.eval()
    with torch.no_grad():
        pred = model(torch.tensor(X_test)).argmax(dim=1).numpy()

    metrics = {
        "macro_f1": round(float(f1_score(y_test, pred, average="macro", zero_division=0)), 4),
        "accuracy": round(float(accuracy_score(y_test, pred)), 4),
        "per_class_recall": [
            round(float(v), 4)
            for v in recall_score(y_test, pred, labels=range(N_CLASSES), average=None, zero_division=0)
        ],
    }
    figures.append(plot_training(history, best_epoch, fig_dir))
    figures.append(plot_evaluation(y_test, pred, fig_dir))

    return {
        "model": "SmallCNN(16-32 channels) + shift augmentation + Adam + early stop",
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
                "reference 用于识别『可疑地过于好』的结果；n_rows 用于核对切分是否覆盖全部样本。"
                "硬性达标判据见 manifest.json 的 assertions，语义判据见 judge.md。"
            ),
            "n_rows": result["n_rows"],
            "baseline": {
                "name": result["baseline"]["name"],
                "macro_f1": result["baseline"]["macro_f1"],
                "accuracy": result["baseline"]["accuracy"],
            },
            "reference": {
                "model": result["model"],
                "macro_f1": result["metrics"]["macro_f1"],
                "accuracy": result["metrics"]["accuracy"],
            },
            "accept": {
                **ACCEPT[case_dir.name],
                "baseline_macro_f1_tolerance": 0.12,
            },
        }
        out = case_dir / "expected.json"
        out.write_text(json.dumps(expected, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(
            f"[regen] {out} -> baseline macro_f1={expected['baseline']['macro_f1']} "
            f"(acc {expected['baseline']['accuracy']}) | reference macro_f1={expected['reference']['macro_f1']} "
            f"(acc {expected['reference']['accuracy']})"
        )


def main() -> None:
    ap = argparse.ArgumentParser(description="手写数字分拣（小图分类 · 参考实现）")
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
        f"[本轮成绩] macro_f1={m['macro_f1']} accuracy={m['accuracy']} | "
        f"基线 macro_f1={b['macro_f1']} | 训练 {result['training']['epochs_run']} 轮（best={result['training']['best_epoch']}）"
    )
    print(f"逐档召回：{m['per_class_recall']}")


if __name__ == "__main__":
    main()
