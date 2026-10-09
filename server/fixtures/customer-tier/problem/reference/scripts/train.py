#!/usr/bin/env python3
"""实验 C 的参考实现（学习示范）：`data.csv` → `output.json` + 两张图。

📖 这份实现**随题目包一起下发**（`problem/reference/`）—— 先读懂它，再写你自己的。
   **它不是唯一正确答案**：达标只要求"macro F1 ≥ 0.60 且每一档召回 ≥ 0.50 + 看图说话"。

本实现走完**完整流程**（与 task.md 的六步对应）：
  ① 看清需求      —— 三档都要分准（macro 视角），任何一档都不能放弃
  ② 看一眼数据    —— `plot_data_overview`：**画图**看三档分布与特征区分度
  ③ 定基线        —— `build_baseline`：不做预测、一律判多数类（accuracy 0.4，macro F1 只有 0.19）
  ④ 训练模型      —— `train_model`：标准化 + 多分类逻辑回归（量纲差很多，先标准化）
  ⑤ 评估          —— `plot_evaluation`：**画 3×3 混淆矩阵**与逐档召回
  ⑥ 写结论        —— `compose_notes` + 每张图一句 takeaway

用法：
  python3 scripts/train.py <case目录> <output.json>     # 单个 case（图写到当前目录的 figures/）
  python3 scripts/train.py --regen-expected             # 重算 problem/cases/*/expected.json

请在**与复验同一个镜像内**生成 expected（当前 pkg5）：

  docker run --rm -v "$PWD:/w" --entrypoint python3 \
    nju-lab-verify:0.2.0-rc.2-pkg5 /w/problem/reference/scripts/train.py --regen-expected
"""
from __future__ import annotations

import argparse
import json
import tempfile
from pathlib import Path

import matplotlib

matplotlib.use("Agg")  # 容器内无显示环境
import matplotlib.pyplot as plt  # noqa: E402
import pandas as pd  # noqa: E402
from sklearn.linear_model import LogisticRegression  # noqa: E402
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score, recall_score  # noqa: E402
from sklearn.model_selection import train_test_split  # noqa: E402
from sklearn.pipeline import make_pipeline  # noqa: E402
from sklearn.preprocessing import StandardScaler  # noqa: E402

TARGET = "tier"
TEST_SIZE = 0.25
RANDOM_STATE = 42
MACRO_F1_MIN = 0.60
PER_CLASS_RECALL_MIN = 0.50
FIG_DIR = Path("figures")
TIER_NAMES = ["low", "mid", "high"]

HERE = Path(__file__).resolve().parent
CASES_DIR = HERE.parent.parent / "cases"


def load_data(case_dir: str | Path) -> pd.DataFrame:
    """① / ② 读数据。"""
    return pd.read_csv(Path(case_dir) / "data.csv")


def plot_data_overview(df: pd.DataFrame, fig_dir: Path = FIG_DIR) -> dict:
    """② 看一眼数据（并画图）：三档各占多少？哪个特征最能区分档位？

    左图：三档样本量（一眼看出不平均）
    右图：月均消费在三档之间的分布（箱线图）
    """
    fig_dir.mkdir(parents=True, exist_ok=True)
    shares = df[TARGET].value_counts(normalize=True).sort_index()
    fig, axes = plt.subplots(1, 2, figsize=(10, 4))
    axes[0].bar([f"{n} ({i})" for i, n in enumerate(TIER_NAMES)],
                [int((df[TARGET] == i).sum()) for i in range(3)], color=["#4C78A8", "#F58518", "#54A24B"])
    axes[0].set_ylabel("count")
    axes[0].set_title("Class balance (tier)")
    axes[1].boxplot([df.loc[df[TARGET] == i, "monthly_spend"].values for i in range(3)],
                    tick_labels=TIER_NAMES, showfliers=False)
    axes[1].set_ylabel("monthly_spend")
    axes[1].set_title("Monthly spend by tier")
    fig.tight_layout()
    path = fig_dir / "data_overview.png"
    fig.savefig(path, dpi=110)
    plt.close(fig)
    medians = [df.loc[df[TARGET] == i, "monthly_spend"].median() for i in range(3)]
    takeaway = (
        f"三档占比 {' / '.join(f'{s:.0%}' for s in shares)}（不平均，所以要看 macro）；"
        f"月均消费的中位数随档位明显上升（{medians[0]:.0f} → {medians[1]:.0f} → {medians[2]:.0f} 元），"
        f"但高档里有不少低消费样本，说明还有别的因素在起作用。"
    )
    return {"path": str(path), "takeaway": takeaway}


def build_baseline(y_test) -> dict:
    """③ 现有做法：不做预测，**一律判为多数类**（这里通常是最低档）。"""
    counts = pd.Series(y_test).value_counts()
    majority = int(counts.index[0])
    pred = [majority] * len(y_test)
    return {
        "name": "majority_class",
        "accuracy": round(float(accuracy_score(y_test, pred)), 4),
        "macro_f1": round(float(f1_score(y_test, pred, average="macro", zero_division=0)), 4),
    }


def train_model(X_train, y_train):
    """④ 训练模型：各列量纲差很多，先标准化再做多分类逻辑回归。"""
    model = make_pipeline(StandardScaler(), LogisticRegression(max_iter=1000))
    model.fit(X_train, y_train)
    return model


def plot_evaluation(y_test, pred, fig_dir: Path = FIG_DIR) -> dict:
    """⑤ 评估（并画图）：3×3 混淆矩阵 + 逐档召回。"""
    fig_dir.mkdir(parents=True, exist_ok=True)
    cm = confusion_matrix(y_test, pred, labels=[0, 1, 2])
    recalls = recall_score(y_test, pred, average=None, labels=[0, 1, 2])
    fig, axes = plt.subplots(1, 2, figsize=(10, 4.2))
    im = axes[0].imshow(cm, cmap="Blues")
    axes[0].set_xticks([0, 1, 2], [f"pred {n}" for n in TIER_NAMES], rotation=15)
    axes[0].set_yticks([0, 1, 2], [f"true {n}" for n in TIER_NAMES])
    for i in range(3):
        for j in range(3):
            axes[0].text(j, i, str(cm[i, j]), ha="center", va="center",
                         color="white" if cm[i, j] > cm.max() / 2 else "#333", fontsize=11)
    axes[0].set_title("Confusion matrix (test set)")
    axes[1].bar(TIER_NAMES, recalls, color=["#4C78A8", "#F58518", "#54A24B"])
    axes[1].set_ylim(0, 1)
    axes[1].set_ylabel("recall")
    axes[1].set_title("Per-class recall")
    for i, r in enumerate(recalls):
        axes[1].text(i, r + 0.02, f"{r:.2f}", ha="center")
    fig.colorbar(im, ax=axes[0], shrink=0.8)
    fig.tight_layout()
    path = fig_dir / "evaluation.png"
    fig.savefig(path, dpi=110)
    plt.close(fig)
    mid_high = int(cm[2, 1])
    takeaway = (
        f"三档召回分别为 {', '.join(f'{TIER_NAMES[i]} {r:.2f}' for i, r in enumerate(recalls))}；"
        f"混淆矩阵里中档与高档之间有交叉（真实高档有 {mid_high} 个被判成中档），低档几乎不会被认错。"
    )
    return {"path": str(path), "takeaway": takeaway}


def compose_notes(df: pd.DataFrame, baseline: dict, metrics: dict) -> str:
    """⑥ 写结论：看图得到的印象 → 怎么预处理/选模型 → 成绩 → 不足。"""
    spread = (df.drop(columns=[TARGET]).max() - df.drop(columns=[TARGET]).min())
    return (
        f"画图先确认两件事：三档人数不平均（所以看 macro 与逐档召回）、月均消费能区分档位但不足以单靠它分档；"
        f"各列量纲差 {spread.max() / max(spread.min(), 1e-9):.0f} 倍，因此先标准化再训多分类逻辑回归。"
        f"测试集 macro F1 {metrics['macro_f1']}、accuracy {metrics['accuracy']}"
        f"（现有做法『一律判低档』accuracy {baseline['accuracy']}、macro F1 只有 {baseline['macro_f1']}）；"
        f"逐档召回 {metrics['per_class_recall']}，三档都没被放弃。不足：中档最弱，与高档之间仍有混淆 —— "
        f"若要进一步优化，可以给高档更高的权重或补充特征。"
    )


def train_and_evaluate(df: pd.DataFrame, fig_dir: Path = FIG_DIR) -> dict:
    """② → ⑥ 完整流程：画图看数据 → 定基线 → 训练 → 画混淆矩阵 → 组织结论。"""
    figures = [plot_data_overview(df, fig_dir)]

    features = [c for c in df.columns if c != TARGET]
    X, y = df[features], df[TARGET]
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=TEST_SIZE, random_state=RANDOM_STATE, stratify=y
    )

    baseline = build_baseline(y_test)
    model = train_model(X_train, y_train)
    pred = model.predict(X_test)

    metrics = {
        "macro_f1": round(float(f1_score(y_test, pred, average="macro")), 4),
        "accuracy": round(float(accuracy_score(y_test, pred)), 4),
        "per_class_recall": [round(float(r), 4) for r in recall_score(y_test, pred, average=None)],
    }
    figures.append(plot_evaluation(y_test, pred, fig_dir))

    return {
        "model": "StandardScaler + LogisticRegression",
        "n_train": int(len(X_train)),
        "n_test": int(len(X_test)),
        "n_rows": int(len(df)),
        "metrics": metrics,
        "baseline": baseline,
        "figures": figures,
        "notes": compose_notes(df, baseline, metrics),
    }


def run_case(case_dir: str | Path, out_path: str | Path, fig_dir: Path = FIG_DIR) -> dict:
    result = train_and_evaluate(load_data(case_dir), fig_dir)
    payload = {k: v for k, v in result.items() if k != "n_rows"}
    Path(out_path).write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return result


def regen_expected() -> None:
    """重算每个 case 的 expected.json（参考水平，不是标准答案）。图写到临时目录，不进仓库。"""
    for case_dir in sorted(p for p in CASES_DIR.iterdir() if p.is_dir()):
        with tempfile.TemporaryDirectory() as tmp:
            result = train_and_evaluate(load_data(case_dir), Path(tmp))
        expected = {
            "note": (
                "参考水平（不是标准答案）：baseline 用于核对学生的基线报告是否可信，"
                "reference 用于识别『可疑地过于好』的结果，n_rows 用于核对切分是否覆盖全部样本。"
                "硬性达标判据见 manifest.json 的 assertions，语义判据见 judge.md。"
            ),
            "n_rows": result["n_rows"],
            "baseline": result["baseline"],
            "reference": {
                "model": result["model"],
                "macro_f1": result["metrics"]["macro_f1"],
                "per_class_recall": result["metrics"]["per_class_recall"],
            },
            "accept": {
                "macro_f1_min": MACRO_F1_MIN,
                "per_class_recall_min": PER_CLASS_RECALL_MIN,
                "baseline_accuracy_tolerance": 0.15,
            },
        }
        out = case_dir / "expected.json"
        out.write_text(json.dumps(expected, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(
            f"[regen] {out} -> baseline macroF1={expected['baseline']['macro_f1']} | "
            f"reference macroF1={expected['reference']['macro_f1']} 逐档召回={expected['reference']['per_class_recall']}"
        )


def main() -> None:
    ap = argparse.ArgumentParser(description="会员价值分级（参考实现）")
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
    m = result["metrics"]
    ok = m["macro_f1"] >= MACRO_F1_MIN and all(r >= PER_CLASS_RECALL_MIN for r in m["per_class_recall"])
    print(json.dumps(result, ensure_ascii=False))
    for fig in result["figures"]:
        print(f"  [图] {fig['path']} —— {fig['takeaway']}")
    print(
        f"[{'达标' if ok else '未达标'}] macro F1={m['macro_f1']} 逐档召回={m['per_class_recall']} "
        f"（要求 macro F1 ≥ {MACRO_F1_MIN} 且每档召回 ≥ {PER_CLASS_RECALL_MIN}）"
    )


if __name__ == "__main__":
    main()
