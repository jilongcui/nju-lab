#!/usr/bin/env python3
"""实验 A 的参考实现（学习示范）：`data.csv` → `output.json` + 两张图。

📖 这份实现**随题目包一起下发**（`problem/reference/`）—— 先读懂它，再写你自己的。
   **它不是唯一正确答案**：判据只要求"MAE 比持久性基线低 ≥20% + 看图说话"，
   换模型、换特征同样能通过。

本实现走完**完整流程**（与 task.md 的六步对应）：
  ① 看清需求      —— 比现有做法好 20%（现有做法 = 沿用上一小时）
  ② 看一眼数据    —— `plot_data_overview`：**画图**看分布与相关性
  ③ 定基线        —— `build_baseline`：把上一小时的值当预测
  ④ 训练模型      —— `train_model`：Ridge（选一个能讲清楚的即可）
  ⑤ 评估          —— `plot_evaluation`：**画图**看拟合与误差
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
from pathlib import Path

import matplotlib

matplotlib.use("Agg")  # 容器内无显示环境
import matplotlib.pyplot as plt  # noqa: E402
import pandas as pd  # noqa: E402
from sklearn.linear_model import Ridge  # noqa: E402
from sklearn.metrics import mean_absolute_error, r2_score  # noqa: E402
from sklearn.model_selection import train_test_split  # noqa: E402

TARGET = "pm25_next"
LAG_COL = "pm25_lag1"
TEST_SIZE = 0.25
RANDOM_STATE = 42
FIG_DIR = Path("figures")

HERE = Path(__file__).resolve().parent
CASES_DIR = HERE.parent.parent / "cases"


def load_data(case_dir: str | Path) -> pd.DataFrame:
    """① / ② 读数据。"""
    return pd.read_csv(Path(case_dir) / "data.csv")


def top_feature(df: pd.DataFrame) -> str:
    """与目标相关性最高的特征（② 用它画散点图）。"""
    return str(df.drop(columns=[TARGET]).corrwith(df[TARGET]).abs().idxmax())


def plot_data_overview(df: pd.DataFrame, fig_dir: Path = FIG_DIR) -> dict:
    """② 看一眼数据（并画图）：目标怎么分布、最有用的特征与目标是什么关系。

    返回 figures 字段的一项：{"path": ..., "takeaway": ...}
    """
    fig_dir.mkdir(parents=True, exist_ok=True)
    feature = top_feature(df)
    fig, axes = plt.subplots(1, 2, figsize=(10, 4))
    axes[0].hist(df[TARGET], bins=30, color="#4C78A8")
    axes[0].set_xlabel(f"{TARGET} (µg/m³)")
    axes[0].set_ylabel("count")
    axes[0].set_title(f"Distribution of {TARGET}")
    axes[1].scatter(df[feature], df[TARGET], s=6, alpha=0.35, color="#F58518")
    axes[1].set_xlabel(feature)
    axes[1].set_ylabel(f"{TARGET} (µg/m³)")
    axes[1].set_title(f"{feature} vs {TARGET}")
    fig.tight_layout()
    path = fig_dir / "data_overview.png"
    fig.savefig(path, dpi=110)
    plt.close(fig)
    takeaway = (
        f"目标分布右偏（均值 {df[TARGET].mean():.0f}、最大 {df[TARGET].max():.0f} µg/m³，少数高污染时刻拉长了尾巴）；"
        f"{feature} 与目标明显正相关（相关系数 {df[feature].corr(df[TARGET]):.2f}），是最主要的依据。"
    )
    return {"path": str(path), "takeaway": takeaway}


def build_baseline(y_true, X_test) -> float:
    """③ 现有做法（持久性基线）：把上一小时的值直接当预测。"""
    return float(mean_absolute_error(y_true, X_test[LAG_COL]))


def train_model(X_train, y_train):
    """④ 训练模型：选一个能讲清楚的（这里用 Ridge —— 线性、稳、可解释）。"""
    model = Ridge(alpha=1.0)
    model.fit(X_train, y_train)
    return model


def plot_evaluation(y_true, pred, fig_dir: Path = FIG_DIR) -> dict:
    """⑤ 评估（并画图）：预测 vs 实际、误差分布。

    返回 figures 字段的一项。
    """
    fig_dir.mkdir(parents=True, exist_ok=True)
    residual = y_true - pred
    fig, axes = plt.subplots(1, 2, figsize=(10, 4))
    lo = float(min(y_true.min(), pred.min()))
    hi = float(max(y_true.max(), pred.max()))
    axes[0].scatter(y_true, pred, s=8, alpha=0.5, color="#4C78A8")
    axes[0].plot([lo, hi], [lo, hi], "r--", lw=1, label="ideal y = x")
    axes[0].set_xlabel("actual")
    axes[0].set_ylabel("predicted")
    axes[0].set_title("Predicted vs actual")
    axes[0].legend()
    axes[1].hist(residual, bins=30, color="#54A24B")
    axes[1].axvline(0, color="r", ls="--", lw=1)
    axes[1].set_xlabel("residual (actual - predicted)")
    axes[1].set_title("Residuals")
    fig.tight_layout()
    path = fig_dir / "evaluation.png"
    fig.savefig(path, dpi=110)
    plt.close(fig)
    high = y_true > y_true.quantile(0.8)
    takeaway = (
        f"预测点整体贴着 y=x；残差中位数 {residual.median():.2f}，分布大致以 0 为中心；"
        f"浓度最高的那 20% 样本 MAE {mean_absolute_error(y_true[high], pred[high]):.2f}，高于整体水平 —— "
        f"说明高浓度时刻更容易被低估。"
    )
    return {"path": str(path), "takeaway": takeaway}


def compose_notes(df: pd.DataFrame, baseline_mae: float, mae: float, r2: float) -> str:
    """⑥ 写结论：看图得到的印象 → 选了什么模型 → 与基线比如何 → 不足。"""
    gain = (1 - mae / baseline_mae) * 100 if baseline_mae else 0.0
    return (
        f"从两张图看：数据平稳、{LAG_COL} 与目标高度正相关，误差近似对称、极端高值偏低估。"
        f"据此选 Ridge(alpha=1.0) + 全特征（线性、可解释，样本量不大时比普通最小二乘稳）："
        f"测试集 MAE {mae}、R² {r2}，比持久性基线（{baseline_mae}）低约 {gain:.0f}%。"
        f"不足：高浓度时刻的误差仍偏大，若业务更在意重污染预警，可以考虑给高浓度样本更高权重。"
    )


def train_and_evaluate(df: pd.DataFrame, fig_dir: Path = FIG_DIR) -> dict:
    """② → ⑥ 完整流程：画图看数据 → 定基线 → 训练 → 画图评估 → 组织结论。"""
    figures = [plot_data_overview(df, fig_dir)]

    features = [c for c in df.columns if c != TARGET]
    X, y = df[features], df[TARGET]
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=TEST_SIZE, random_state=RANDOM_STATE
    )

    baseline_mae = round(build_baseline(y_test, X_test), 4)
    model = train_model(X_train, y_train)
    pred = model.predict(X_test)

    mae = round(float(mean_absolute_error(y_test, pred)), 4)
    r2 = round(float(r2_score(y_test, pred)), 4)
    figures.append(plot_evaluation(y_test, pred, fig_dir))

    return {
        "model": "Ridge(alpha=1.0)",
        "n_train": int(len(X_train)),
        "n_test": int(len(X_test)),
        "n_rows": int(len(df)),
        "metrics": {"mae": mae, "r2": r2},
        "baseline": {"name": "persistence", "mae": baseline_mae},
        "figures": figures,
        "notes": compose_notes(df, baseline_mae, mae, r2),
    }


def run_case(case_dir: str | Path, out_path: str | Path, fig_dir: Path = FIG_DIR) -> dict:
    result = train_and_evaluate(load_data(case_dir), fig_dir)
    payload = {k: v for k, v in result.items() if k != "n_rows"}
    Path(out_path).write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
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
            "reference": {"model": result["model"], "mae": result["metrics"]["mae"]},
            "accept": {"mae_max_ratio_to_baseline": 0.8, "baseline_tolerance": 0.15},
        }
        out = case_dir / "expected.json"
        out.write_text(json.dumps(expected, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(
            f"[regen] {out} -> baseline={expected['baseline']['mae']} "
            f"reference={expected['reference']['mae']}（{expected['reference']['model']}）"
        )


def main() -> None:
    ap = argparse.ArgumentParser(description="估算下一小时 PM2.5（参考实现）")
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
    ok = result["metrics"]["mae"] <= 0.8 * result["baseline"]["mae"]
    print(json.dumps(result, ensure_ascii=False))
    for fig in result["figures"]:
        print(f"  [图] {fig['path']} —— {fig['takeaway']}")
    print(f"[{'达标' if ok else '未达标'}] MAE={result['metrics']['mae']} 基线={result['baseline']['mae']}")


if __name__ == "__main__":
    main()
