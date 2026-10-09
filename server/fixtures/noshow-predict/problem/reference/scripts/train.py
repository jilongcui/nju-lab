#!/usr/bin/env python3
"""实验 B 的参考实现（学习示范）：`data.csv` → `output.json` + 两张图。

📖 这份实现**随题目包一起下发**（`problem/reference/`）—— 先读懂它，再写你自己的。
   **它不是唯一正确答案**：达标只要求"recall ≥ 0.65 且 precision ≥ 0.40 + 看图说话"。

本实现走完**完整流程**（与 task.md 的六步对应）：
  ① 看清需求      —— 别漏掉会失约的人，名单也别长到打不完
  ② 看一眼数据    —— `plot_data_overview`：**画图**看失约比例与风险因素
  ③ 定基线        —— `build_baseline`：不做预测、一律认为会来（recall 必为 0）
  ④ 训练模型      —— `train_model`：逻辑回归 + class_weight（处理不平衡）
  ⑤ 评估          —— `plot_evaluation`：**画混淆矩阵**看漏报与误报
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
from sklearn.metrics import (  # noqa: E402
    accuracy_score,
    confusion_matrix,
    precision_score,
    recall_score,
)

from sklearn.model_selection import train_test_split  # noqa: E402

TARGET = "noshow"
TEST_SIZE = 0.25
RANDOM_STATE = 42
RECALL_MIN = 0.65
PRECISION_MIN = 0.40
FIG_DIR = Path("figures")

HERE = Path(__file__).resolve().parent
CASES_DIR = HERE.parent.parent / "cases"


def load_data(case_dir: str | Path) -> pd.DataFrame:
    """① / ② 读数据。"""
    return pd.read_csv(Path(case_dir) / "data.csv")


def plot_data_overview(df: pd.DataFrame, fig_dir: Path = FIG_DIR) -> dict:
    """② 看一眼数据（并画图）：失约占多少？风险与什么有关？

    左图：失约 / 未失约的样本量（一眼看出不平衡）
    右图：按"预约提前天数"分档后的失约率
    """
    fig_dir.mkdir(parents=True, exist_ok=True)
    rate = float((df[TARGET] == 1).mean())
    fig, axes = plt.subplots(1, 2, figsize=(10, 4))
    counts = df[TARGET].value_counts().sort_index()
    axes[0].bar(["show (0)", "no-show (1)"], [counts.get(0, 0), counts.get(1, 0)], color=["#4C78A8", "#E45756"])
    axes[0].set_ylabel("count")
    axes[0].set_title(f"Class balance (no-show = {rate:.1%})")
    buckets = pd.cut(df["lead_days"], bins=[0, 7, 14, 21, 31], labels=["1-7", "8-14", "15-21", "22-30"])
    by_bucket = df.groupby(buckets, observed=True)[TARGET].mean()
    axes[1].bar(by_bucket.index.astype(str), by_bucket.values, color="#F58518")
    axes[1].set_xlabel("lead_days (days ahead)")
    axes[1].set_ylabel("no-show rate")
    axes[1].set_title("No-show rate by lead time")
    fig.tight_layout()
    path = fig_dir / "data_overview.png"
    fig.savefig(path, dpi=110)
    plt.close(fig)
    takeaway = (
        f"失约的人只占 {rate:.1%}（明显不平衡，所以不能只看 accuracy）；"
        f"预约提前天数越多失约率越高（最长的一档 {by_bucket.iloc[-1]:.0%} vs 最短的一档 {by_bucket.iloc[0]:.0%}）。"
    )
    return {"path": str(path), "takeaway": takeaway}


def build_baseline(y_test) -> dict:
    """③ 现有做法：不做预测，**一律认为患者会来**（预测全为 0）。"""
    return {
        "name": "predict_all_show",
        "recall": 0.0,
        "accuracy": round(float((y_test == 0).mean()), 4),
    }


def train_model(X_train, y_train):
    """④ 训练模型：失约是少数类，用 class_weight="balanced" 让模型别偏向多数类。"""
    model = LogisticRegression(max_iter=1000, class_weight="balanced")
    model.fit(X_train, y_train)
    return model


def plot_evaluation(y_test, pred, fig_dir: Path = FIG_DIR) -> dict:
    """⑤ 评估（并画图）：混淆矩阵 —— 漏了多少、误报多少。"""
    fig_dir.mkdir(parents=True, exist_ok=True)
    cm = confusion_matrix(y_test, pred, labels=[0, 1])
    fig, ax = plt.subplots(figsize=(5, 4.2))
    im = ax.imshow(cm, cmap="Blues")
    ax.set_xticks([0, 1], ["pred show", "pred no-show"])
    ax.set_yticks([0, 1], ["true show", "true no-show"])
    for i in range(2):
        for j in range(2):
            ax.text(j, i, str(cm[i, j]), ha="center", va="center",
                    color="white" if cm[i, j] > cm.max() / 2 else "#333", fontsize=13)
    ax.set_title("Confusion matrix (test set)")
    fig.colorbar(im, ax=ax, shrink=0.8)
    fig.tight_layout()
    path = fig_dir / "evaluation.png"
    fig.savefig(path, dpi=110)
    plt.close(fig)
    tn, fp, fn, tp = (int(v) for v in cm.ravel())
    listed = tp + fp  # 提醒名单人数 = 真阳性 + 误报
    takeaway = (
        f"漏掉的失约者 {fn} 人、误报 {fp} 人；要打电话的名单共 {listed} 人，"
        f"其中 {tp} 人确实失约（precision {tp / listed:.2f}，与 metrics.precision 一致）—— "
        f"名单约是实际失约人数（{fn + tp}）的 {listed / (fn + tp):.2f} 倍，可以接受但还有压缩空间。"
    )
    return {"path": str(path), "takeaway": takeaway}


def compose_notes(observation_rate: float, baseline: dict, metrics: dict) -> str:
    """⑥ 写结论：看图得到的印象 → 怎么处理不平衡 → 成绩 → 不足。"""
    return (
        f"图里最要紧的一点：失约占 {observation_rate:.1%}，所以 accuracy 会骗人 —— "
        f"『一律认为会来』的 accuracy 有 {baseline['accuracy']}，recall 却是 0。"
        f"因此用 class_weight='balanced' 抬高少数类权重，并保持分层切分："
        f"测试集 recall {metrics['recall']}、precision {metrics['precision']}"
        f"（accuracy {metrics['accuracy']}，比基线略低，这是抓漏的代价）。"
        f"不足：误报偏多，可按单次提醒成本调高概率阈值换更短的名单。"
    )


def train_and_evaluate(df: pd.DataFrame, fig_dir: Path = FIG_DIR) -> dict:
    """② → ⑥ 完整流程：画图看数据 → 定基线 → 训练 → 画混淆矩阵 → 组织结论。"""
    figures = [plot_data_overview(df, fig_dir)]
    rate = float((df[TARGET] == 1).mean())

    features = [c for c in df.columns if c != TARGET]
    X, y = df[features], df[TARGET]
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=TEST_SIZE, random_state=RANDOM_STATE, stratify=y
    )

    baseline = build_baseline(y_test)
    model = train_model(X_train, y_train)
    pred = model.predict(X_test)

    metrics = {
        "recall": round(float(recall_score(y_test, pred)), 4),
        "precision": round(float(precision_score(y_test, pred)), 4),
        "accuracy": round(float(accuracy_score(y_test, pred)), 4),
    }
    figures.append(plot_evaluation(y_test, pred, fig_dir))

    return {
        "model": "LogisticRegression(class_weight='balanced')",
        "n_train": int(len(X_train)),
        "n_test": int(len(X_test)),
        "n_rows": int(len(df)),
        "metrics": metrics,
        "baseline": baseline,
        "threshold": 0.5,
        "figures": figures,
        "notes": compose_notes(rate, baseline, metrics),
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
                "recall": result["metrics"]["recall"],
                "precision": result["metrics"]["precision"],
            },
            "accept": {
                "recall_min": RECALL_MIN,
                "precision_min": PRECISION_MIN,
                "baseline_accuracy_tolerance": 0.15,
            },
        }
        out = case_dir / "expected.json"
        out.write_text(json.dumps(expected, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(
            f"[regen] {out} -> baseline accuracy={expected['baseline']['accuracy']} | "
            f"reference recall={expected['reference']['recall']} precision={expected['reference']['precision']}"
        )


def main() -> None:
    ap = argparse.ArgumentParser(description="门诊预约失约预测（参考实现）")
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
    ok = m["recall"] >= RECALL_MIN and m["precision"] >= PRECISION_MIN
    print(json.dumps(result, ensure_ascii=False))
    for fig in result["figures"]:
        print(f"  [图] {fig['path']} —— {fig['takeaway']}")
    print(
        f"[{'达标' if ok else '未达标'}] recall={m['recall']} precision={m['precision']} "
        f"（要求 recall ≥ {RECALL_MIN} 且 precision ≥ {PRECISION_MIN}）"
    )


if __name__ == "__main__":
    main()
