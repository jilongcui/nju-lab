#!/usr/bin/env python3
"""手写数字分拣的参考实现（学习示范）：`data.csv` → `output.json` + 三张图。

📖 这份实现**随题目包一起下发**（`problem/reference/`）—— 先读懂它，再写你自己的。
   **它不是唯一正确答案**：判据只要求"accuracy ≥ 0.92 且 macro F1 ≥ 0.90 + 真的训练过"，
   换隐藏层大小、换优化器、换轮数同样能通过。

本实现走完**完整流程**（与 task.md 的六步对应）：
  ① 看清需求      —— 3/8/9 三个数字都要认；比"一律猜最多"好得多
  ② 看一眼数据    —— `plot_data_overview`：**画图**看样本长什么样、各类多少张
  ③ 定基线        —— `build_baseline`：一律猜训练集里最多的数字
  ④ 训练模型      —— `train_model`：两层 MLP（64 → 32 → 3）+ Adam，**逐轮记录 loss**
  ⑤ 评估          —— `plot_training_curve` / `plot_evaluation`：**画图**看 loss 下降与混淆矩阵
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
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score  # noqa: E402
from sklearn.model_selection import train_test_split  # noqa: E402
from torch import nn  # noqa: E402

TARGET = "digit"
CLASSES = [3, 8, 9]
PIXELS = [f"p{r}{c}" for r in range(8) for c in range(8)]
TEST_SIZE = 0.25
RANDOM_STATE = 42
HIDDEN = 32
EPOCHS = 30
LR = 0.05
FIG_DIR = Path("figures")

# 每个 case 的达标线（写进 expected.json 的 accept，供 manifest.json 的断言引用）：
# case02 样本更少、带扫描噪声，线略低一档
ACCEPT = {
    "case01": {"accuracy_min": 0.92, "macro_f1_min": 0.90},
    "case02": {"accuracy_min": 0.90, "macro_f1_min": 0.88},
}

HERE = Path(__file__).resolve().parent
CASES_DIR = HERE.parent.parent / "cases"


class MLP(nn.Module):
    """两层全连接网络：64 个像素 → 32 个隐藏单元 → 3 个类别分数。"""

    def __init__(self, n_in: int = 64, n_hidden: int = HIDDEN, n_out: int = len(CLASSES)):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(n_in, n_hidden),
            nn.ReLU(),
            nn.Linear(n_hidden, n_out),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


def load_data(case_dir: str | Path) -> pd.DataFrame:
    """① / ② 读数据。"""
    return pd.read_csv(Path(case_dir) / "data.csv")


def to_arrays(df: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
    """像素归一到 0~1；标签映射成 0/1/2（CrossEntropyLoss 要的是 0..C-1 的类别下标）。"""
    X = df[PIXELS].to_numpy(dtype=np.float32) / 16.0
    raw = df[TARGET].to_numpy(dtype=np.int64)
    index = {cls: i for i, cls in enumerate(CLASSES)}
    y = np.array([index[int(v)] for v in raw], dtype=np.int64)
    return X, y


def plot_data_overview(df: pd.DataFrame, fig_dir: Path = FIG_DIR) -> dict:
    """② 看一眼数据（并画图）：每类长什么样、各类多少张。

    返回 figures 字段的一项：{"path": ..., "takeaway": ...}
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

    takeaway = (
        f"每行数据就是一张 8×8 的小图（64 个像素值）；三类样本数 {counts.to_dict()}，基本均衡。"
        f"3、8、9 的笔画结构相近（都有圆弧或闭合的圈），像素落在什么位置、"
        f"哪里闭合、哪里开口，就是网络要学的判别依据。"
    )
    return {"path": str(path), "takeaway": takeaway}


def build_baseline(y_train: np.ndarray, y_test: np.ndarray) -> dict:
    """③ 现有做法（不建模）：一律猜训练集里最多的数字。"""
    majority = int(np.bincount(y_train, minlength=len(CLASSES)).argmax())
    pred = np.full_like(y_test, majority)
    return {
        "name": "most_frequent",
        "label": CLASSES[majority],
        "accuracy": round(float(accuracy_score(y_test, pred)), 4),
        "macro_f1": round(float(f1_score(y_test, pred, average="macro", zero_division=0)), 4),
    }


def train_model(X_train: np.ndarray, y_train: np.ndarray):
    """④ 训练模型：两层 MLP + Adam，逐轮记录训练损失（证明"真的训练了"）。"""
    torch.manual_seed(RANDOM_STATE)
    model = MLP()
    optimizer = torch.optim.Adam(model.parameters(), lr=LR)
    loss_fn = nn.CrossEntropyLoss()

    X_t = torch.from_numpy(X_train)
    y_t = torch.from_numpy(y_train)
    history: list[dict] = []
    for epoch in range(1, EPOCHS + 1):
        model.train()
        optimizer.zero_grad()
        loss = loss_fn(model(X_t), y_t)
        loss.backward()
        optimizer.step()
        history.append({"epoch": epoch, "train_loss": round(float(loss.item()), 4)})
    return model, history


def plot_training_curve(history: list[dict], fig_dir: Path = FIG_DIR) -> dict:
    """⑤ 训练曲线：loss 有没有真的降下来（"神经网络在学"的最直接证据）。"""
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

    takeaway = (
        f"训练损失从第 1 轮的 {losses[0]:.3f} 降到第 {epochs[-1]} 轮的 {losses[-1]:.3f}，"
        f"前 10 轮降得最快、之后越来越平 —— 说明网络确实在从像素里学判别规律；"
        f"损失接近 0 也提示它已把训练集拟合得很好，要留意过拟合（样本少时尤其明显）。"
    )
    return {"path": str(path), "takeaway": takeaway}


def plot_evaluation(y_test: np.ndarray, pred: np.ndarray, fig_dir: Path = FIG_DIR) -> dict:
    """⑤ 评估（并画图）：3×3 混淆矩阵，看哪两个数字会被认混。"""
    fig_dir.mkdir(parents=True, exist_ok=True)
    labels = list(range(len(CLASSES)))
    cm = confusion_matrix(y_test, pred, labels=labels)

    fig, ax = plt.subplots(figsize=(4.4, 3.8))
    ax.imshow(cm, cmap="Blues")
    for i in range(cm.shape[0]):
        for j in range(cm.shape[1]):
            ax.text(j, i, str(int(cm[i, j])), ha="center", va="center",
                    color="white" if cm[i, j] > cm.max() / 2 else "black")
    ax.set_xticks(range(len(CLASSES)), [str(c) for c in CLASSES])
    ax.set_yticks(range(len(CLASSES)), [str(c) for c in CLASSES])
    ax.set_xlabel("predicted")
    ax.set_ylabel("actual")
    ax.set_title("Confusion matrix")
    fig.tight_layout()
    path = fig_dir / "evaluation.png"
    fig.savefig(path, dpi=110)
    plt.close(fig)

    off = cm.copy()
    np.fill_diagonal(off, 0)
    if int(off.max()) > 0:
        i, j = np.unravel_index(int(off.argmax()), off.shape)
        confusion_text = (
            f"最容易混的是 {CLASSES[i]} → {CLASSES[j]}（{int(off[i, j])} 张），"
            f"多半是笔画写得潦草、像素位置接近的样本。"
        )
    else:
        confusion_text = "这一批测试集上没有出现混淆；但写潦草的样本仍可能出错。"
    takeaway = (
        f"对角线判对：{'、'.join(f'{c} {int(cm[k, k])}' for k, c in enumerate(CLASSES))}；"
        f"测试集一共错了 {int(off.sum())} 张。" + confusion_text
    )
    return {"path": str(path), "takeaway": takeaway}


def compose_notes(n_rows: int, baseline: dict, metrics: dict, history: list[dict]) -> str:
    """⑥ 写结论：看图得到的印象 → 选了什么网络 → 与基线比如何 → 不足。"""
    return (
        f"先看样例图确认每行就是一张 8×8 小图、三类基本均衡；用两层 MLP（64→32→3，ReLU + Adam）"
        f"训练 {len(history)} 轮，训练损失从 {history[0]['train_loss']:.3f} 降到 "
        f"{history[-1]['train_loss']:.3f}。{n_rows} 行里切 {TEST_SIZE:.0%} 做测试集："
        f"accuracy {metrics['accuracy']}、macro F1 {metrics['macro_f1']}，"
        f"远高于「一律猜最多数字」的基线（accuracy {baseline['accuracy']}）。"
        f"不足：只学了 0/1/2 三个数字，且 8×8 分辨率低、写潦草时仍会认混；"
        f"换更多类别或更清晰的图片需要更大网络与更多数据。"
    )


def train_and_evaluate(df: pd.DataFrame, fig_dir: Path = FIG_DIR) -> dict:
    """② → ⑥ 完整流程：画图看数据 → 定基线 → 训练 → 画图评估 → 组织结论。"""
    figures = [plot_data_overview(df, fig_dir)]

    X, y = to_arrays(df)
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=TEST_SIZE, random_state=RANDOM_STATE, stratify=y
    )

    baseline = build_baseline(y_train, y_test)
    model, history = train_model(X_train, y_train)
    figures.append(plot_training_curve(history, fig_dir))

    model.eval()
    with torch.no_grad():
        logits = model(torch.from_numpy(X_test))
        pred = logits.argmax(dim=1).numpy()
    metrics = {
        "accuracy": round(float(accuracy_score(y_test, pred)), 4),
        "macro_f1": round(float(f1_score(y_test, pred, average="macro")), 4),
    }
    figures.append(plot_evaluation(y_test, pred, fig_dir))

    return {
        "model": f"MLP(64→{HIDDEN}→3, ReLU, Adam)",
        "n_train": int(len(X_train)),
        "n_test": int(len(X_test)),
        "n_rows": int(len(df)),
        "metrics": metrics,
        "baseline": baseline,
        "training": {
            "epochs": len(history),
            "optimizer": f"Adam(lr={LR})",
            "loss": "CrossEntropyLoss",
            "history": history,
        },
        "figures": figures,
        "notes": compose_notes(len(df), baseline, metrics, history),
    }


def run_case(case_dir: str | Path, out_path: str | Path, fig_dir: Path = FIG_DIR) -> dict:
    case = Path(case_dir).name
    result = train_and_evaluate(load_data(case_dir), fig_dir)
    payload = {k: v for k, v in result.items() if k != "n_rows"}
    Path(out_path).write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    ok = (result["metrics"]["accuracy"] >= ACCEPT[case]["accuracy_min"]
          and result["metrics"]["macro_f1"] >= ACCEPT[case]["macro_f1_min"])
    print(f"[{case}] {'达标' if ok else '未达标'} accuracy={result['metrics']['accuracy']} "
          f"macro_f1={result['metrics']['macro_f1']} 基线 accuracy={result['baseline']['accuracy']}")
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
            "n_features": len(PIXELS),
            "baseline": result["baseline"],
            "reference": {
                "model": result["model"],
                "accuracy": result["metrics"]["accuracy"],
                "macro_f1": result["metrics"]["macro_f1"],
            },
            "accept": {**ACCEPT[case], "baseline_accuracy_tolerance": 0.10},
        }
        out = case_dir / "expected.json"
        out.write_text(json.dumps(expected, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(
            f"[regen] {out} -> baseline accuracy={expected['baseline']['accuracy']} "
            f"reference accuracy={expected['reference']['accuracy']} "
            f"macro_f1={expected['reference']['macro_f1']}"
        )


def main() -> None:
    ap = argparse.ArgumentParser(description="手写数字分拣（参考实现）")
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
