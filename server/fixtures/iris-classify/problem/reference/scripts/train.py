#!/usr/bin/env python3
"""鸢尾花品种识别的参考实现（学习示范）：`data.csv` → `output.json` + 两张图。

📖 这份实现**随题目包一起下发**（`problem/reference/`）—— 先读懂它，再写你自己的。
   **它不是唯一正确答案**：判据只要求"accuracy ≥ 0.90 且 macro F1 ≥ 0.85 + 看图说话"，
   换模型（决策树 / KNN / 随机森林）同样能通过。

本实现走完**完整流程**（与 task.md 的六步对应）：
  ① 看清需求      —— 按花瓣尺寸分品种，不能靠"猜最常见的"
  ② 看一眼数据    —— `plot_data_overview`：**画图**看两类特征怎么分开
  ③ 定基线        —— `build_baseline`：一律猜最多的品种（accuracy≈0.33）
  ④ 训练模型      —— `train_model`：逻辑回归（入门首选：简单、可解释）
  ⑤ 评估          —— `plot_evaluation`：**画图**看 3×3 混淆矩阵
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
from sklearn.linear_model import LogisticRegression  # noqa: E402
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score  # noqa: E402
from sklearn.model_selection import train_test_split  # noqa: E402

TARGET = "species"
FEATURES = ["petal_length_cm", "petal_width_cm"]
CLASS_NAMES = ["setosa", "versicolor", "virginica"]
TEST_SIZE = 0.25
RANDOM_STATE = 42
FIG_DIR = Path("figures")

# 每个 case 的达标线（写进 expected.json 的 accept，供 manifest.json 的断言引用）：
# case02 样本更少，线略低一档（但仍远高于"全判一类"的 0.33 / 0.17）
ACCEPT = {
    "case01": {"accuracy_min": 0.90, "macro_f1_min": 0.85},
    "case02": {"accuracy_min": 0.88, "macro_f1_min": 0.82},
}

HERE = Path(__file__).resolve().parent
CASES_DIR = HERE.parent.parent / "cases"


def load_data(case_dir: str | Path) -> pd.DataFrame:
    """① / ② 读数据。"""
    return pd.read_csv(Path(case_dir) / "data.csv")


def plot_data_overview(df: pd.DataFrame, fig_dir: Path = FIG_DIR) -> dict:
    """② 看一眼数据（并画图）：三类在两个花瓣特征上怎么分布。

    返回 figures 字段的一项：{"path": ..., "takeaway": ...}
    """
    fig_dir.mkdir(parents=True, exist_ok=True)
    fig, axes = plt.subplots(1, 2, figsize=(10, 4))

    colors = {"setosa": "#4C78A8", "versicolor": "#F58518", "virginica": "#54A24B"}
    for name in CLASS_NAMES:
        sub = df[df[TARGET] == name]
        axes[0].scatter(
            sub[FEATURES[0]], sub[FEATURES[1]], s=22, alpha=0.85, label=name, color=colors[name]
        )
    axes[0].set_xlabel("petal length (cm)")
    axes[0].set_ylabel("petal width (cm)")
    axes[0].set_title("Two petal features by species")
    axes[0].legend()

    counts = df[TARGET].value_counts().reindex(CLASS_NAMES).fillna(0).astype(int)
    axes[1].bar(CLASS_NAMES, counts.values, color=[colors[n] for n in CLASS_NAMES])
    axes[1].set_ylabel("count")
    axes[1].set_title("Samples per species")

    fig.tight_layout()
    path = fig_dir / "data_overview.png"
    fig.savefig(path, dpi=110)
    plt.close(fig)

    takeaway = (
        f"setosa 集中在花瓣长 {df[df[TARGET] == 'setosa'][FEATURES[0]].max():.1f}cm 以下，"
        f"与另外两类完全分开；versicolor 与 virginica 在花瓣宽度上有重叠，是最容易混的一对。"
        f"三类样本数 {counts.to_dict()}，分布均衡 —— 靠猜某一类糊弄不过去。"
    )
    return {"path": str(path), "takeaway": takeaway}


def build_baseline(y_train: pd.Series, y_test: pd.Series) -> dict:
    """③ 现有做法（不建模）：一律猜训练集里最多的品种。"""
    majority = str(y_train.value_counts().idxmax())
    pred = np.array([majority] * len(y_test))
    return {
        "name": "most_frequent",
        "label": majority,
        "accuracy": round(float(accuracy_score(y_test, pred)), 4),
        "macro_f1": round(float(f1_score(y_test, pred, average="macro", zero_division=0)), 4),
    }


def train_model(X_train, y_train):
    """④ 训练模型：逻辑回归（入门首选 —— 简单、可解释、样本少也稳）。"""
    model = LogisticRegression(max_iter=1000, random_state=RANDOM_STATE)
    model.fit(X_train, y_train)
    return model


def plot_evaluation(y_test, pred, fig_dir: Path = FIG_DIR) -> dict:
    """⑤ 评估（并画图）：3×3 混淆矩阵，看哪两类会被混淆。

    返回 figures 字段的一项。
    """
    fig_dir.mkdir(parents=True, exist_ok=True)
    cm = confusion_matrix(y_test, pred, labels=CLASS_NAMES)

    fig, ax = plt.subplots(figsize=(4.6, 4.0))
    ax.imshow(cm, cmap="Blues")
    for i in range(cm.shape[0]):
        for j in range(cm.shape[1]):
            ax.text(j, i, str(int(cm[i, j])), ha="center", va="center",
                    color="white" if cm[i, j] > cm.max() / 2 else "black")
    ax.set_xticks(range(len(CLASS_NAMES)), CLASS_NAMES, rotation=20)
    ax.set_yticks(range(len(CLASS_NAMES)), CLASS_NAMES)
    ax.set_xlabel("predicted")
    ax.set_ylabel("actual")
    ax.set_title("Confusion matrix")
    fig.tight_layout()
    path = fig_dir / "evaluation.png"
    fig.savefig(path, dpi=110)
    plt.close(fig)

    row_sums = cm.sum(axis=1).astype(float)
    recall = np.divide(cm.diagonal(), row_sums, out=np.zeros_like(row_sums), where=row_sums > 0)
    off = cm.copy()
    np.fill_diagonal(off, 0)
    if int(off.max()) > 0:
        i, j = np.unravel_index(int(off.argmax()), off.shape)
        confusion_text = (
            f"最容易混的是 {CLASS_NAMES[i]} → {CLASS_NAMES[j]}（{int(off[i, j])} 个），"
            f"这两类召回分别是 {recall[i]:.2f} / {recall[j]:.2f} —— 重叠区就是它们的分界难点。"
        )
    else:
        confusion_text = (
            "这一批测试集上没有出现混淆；但两类在花瓣宽度上仍有重叠，换一批数据就可能出错。"
        )
    takeaway = (
        f"对角线判对：{'、'.join(f'{n} {int(cm[k, k])}' for k, n in enumerate(CLASS_NAMES))}；"
        + confusion_text
    )
    return {"path": str(path), "takeaway": takeaway}


def compose_notes(n_rows: int, baseline: dict, metrics: dict) -> str:
    """⑥ 写结论：看图得到的印象 → 选了什么模型 → 与基线比如何 → 不足。"""
    gain = metrics["accuracy"] - baseline["accuracy"]
    return (
        f"两特征散点显示 setosa 明显分得开、另两类在花瓣宽度上重叠，所以先看一眼数据就知道"
        f"难点在 versicolor/virginica。用逻辑回归（两个特征都用上，简单可解释）："
        f"{n_rows} 行里切 {TEST_SIZE:.0%} 做测试集，accuracy {metrics['accuracy']}、"
        f"macro F1 {metrics['macro_f1']}，比「一律猜最多品种」的基线（accuracy {baseline['accuracy']}）"
        f"高 {gain:.2f}。不足：样本量小、只有两个特征，重叠区靠线性边界分不干净；"
        f"若加花瓣长度以外的测量或换非线性模型，还有提升空间。"
    )


def train_and_evaluate(df: pd.DataFrame, fig_dir: Path = FIG_DIR) -> dict:
    """② → ⑥ 完整流程：画图看数据 → 定基线 → 训练 → 画图评估 → 组织结论。"""
    figures = [plot_data_overview(df, fig_dir)]

    X, y = df[FEATURES], df[TARGET]
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=TEST_SIZE, random_state=RANDOM_STATE, stratify=y
    )

    baseline = build_baseline(y_train, y_test)
    model = train_model(X_train, y_train)
    pred = model.predict(X_test)
    metrics = {
        "accuracy": round(float(accuracy_score(y_test, pred)), 4),
        "macro_f1": round(float(f1_score(y_test, pred, average="macro")), 4),
    }
    figures.append(plot_evaluation(y_test, pred, fig_dir))

    return {
        "model": "LogisticRegression(max_iter=1000)",
        "n_train": int(len(X_train)),
        "n_test": int(len(X_test)),
        "n_rows": int(len(df)),
        "metrics": metrics,
        "baseline": baseline,
        "figures": figures,
        "notes": compose_notes(len(df), baseline, metrics),
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
            "baseline": result["baseline"],
            "reference": {
                "model": result["model"],
                "accuracy": result["metrics"]["accuracy"],
                "macro_f1": result["metrics"]["macro_f1"],
            },
            "accept": {
                **ACCEPT[case],
                "baseline_accuracy_tolerance": 0.10,
            },
        }
        out = case_dir / "expected.json"
        out.write_text(json.dumps(expected, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(
            f"[regen] {out} -> baseline accuracy={expected['baseline']['accuracy']} "
            f"reference accuracy={expected['reference']['accuracy']} "
            f"macro_f1={expected['reference']['macro_f1']}"
        )


def main() -> None:
    ap = argparse.ArgumentParser(description="鸢尾花品种识别（参考实现）")
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
