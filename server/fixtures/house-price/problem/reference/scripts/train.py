#!/usr/bin/env python3
"""按面积估算房价的参考实现（学习示范）：`data.csv` → `output.json` + 两张图。

📖 这份实现**随题目包一起下发**（`problem/reference/`）—— 先读懂它，再写你自己的。
   **它不是唯一正确答案**：判据只要求"MAE 比现有做法低 ≥25% + 看图说话"，
   换模型（KNN 回归 / 决策树 / 随机森林）同样能通过。

本实现走完**完整流程**（与 task.md 的六步对应）：
  ① 看清需求      —— 按面积报价，要比"平均单价 × 面积"明显更准
  ② 看一眼数据    —— `plot_data_overview`：**画图**看面积与总价的关系、总价怎么分布
  ③ 定基线        —— `build_baseline`：全市平均单价 × 面积（中介的现有做法）
  ④ 训练模型      —— `train_model`：一元线性回归（面积 + 截距）
  ⑤ 评估          —— `plot_evaluation`：**画图**看预测 vs 实际、残差
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
from sklearn.linear_model import LinearRegression  # noqa: E402
from sklearn.metrics import mean_absolute_error, r2_score  # noqa: E402
from sklearn.model_selection import train_test_split  # noqa: E402

TARGET = "total_price_wan"
FEATURE = "area_m2"
TEST_SIZE = 0.25
RANDOM_STATE = 42
FIG_DIR = Path("figures")

# 每个 case 的达标线（写进 expected.json 的 accept，供 manifest.json 的断言引用）
ACCEPT = {
    "case01": {"mae_max_ratio_to_baseline": 0.78, "baseline_tolerance": 0.15},
    "case02": {"mae_max_ratio_to_baseline": 0.80, "baseline_tolerance": 0.15},
}

HERE = Path(__file__).resolve().parent
CASES_DIR = HERE.parent.parent / "cases"


def load_data(case_dir: str | Path) -> pd.DataFrame:
    """① / ② 读数据。"""
    return pd.read_csv(Path(case_dir) / "data.csv")


def plot_data_overview(df: pd.DataFrame, fig_dir: Path = FIG_DIR) -> dict:
    """② 看一眼数据（并画图）：面积与总价的关系、总价怎么分布。

    返回 figures 字段的一项：{"path": ..., "takeaway": ...}
    """
    fig_dir.mkdir(parents=True, exist_ok=True)
    fig, axes = plt.subplots(1, 2, figsize=(10, 4))

    axes[0].scatter(df[FEATURE], df[TARGET], s=14, alpha=0.55, color="#4C78A8")
    axes[0].set_xlabel("area (m2)")
    axes[0].set_ylabel("total price (10k CNY)")
    axes[0].set_title("Area vs total price")

    axes[1].hist(df[TARGET], bins=25, color="#F58518")
    axes[1].set_xlabel("total price (10k CNY)")
    axes[1].set_ylabel("count")
    axes[1].set_title("Distribution of total price")

    fig.tight_layout()
    path = fig_dir / "data_overview.png"
    fig.savefig(path, dpi=110)
    plt.close(fig)

    corr = float(df[FEATURE].corr(df[TARGET]))
    unit = df[TARGET] / df[FEATURE]
    small = float(unit[df[FEATURE] <= df[FEATURE].quantile(0.5)].mean())
    large = float(unit[df[FEATURE] > df[FEATURE].quantile(0.5)].mean())
    takeaway = (
        f"面积与总价强正相关（相关系数 {corr:.3f}），是估算的主要依据；"
        f"但小户型的单价均值 {small:.2f} 万元/m² 高于大户型的 {large:.2f} —— "
        f"说明总价里有一块与面积无关的固定价值，只乘一个平均单价会系统性偏差。"
    )
    return {"path": str(path), "takeaway": takeaway}


def build_baseline(X_train, y_train, X_test, y_test) -> dict:
    """③ 现有做法（不建模）：全市平均单价 × 面积。

    平均单价只用**训练集**估计（不能拿测试集的价格来定基线）。
    """
    unit_price = float((y_train / X_train[FEATURE]).mean())
    pred = unit_price * X_test[FEATURE]
    return {
        "name": "average_price_per_m2",
        "unit_price_wan": round(unit_price, 4),
        "mae": round(float(mean_absolute_error(y_test, pred)), 4),
    }


def train_model(X_train, y_train):
    """④ 训练模型：一元线性回归（面积 + 截距 —— 截距正好对应"固定价值"）。"""
    model = LinearRegression()
    model.fit(X_train, y_train)
    return model


def plot_evaluation(y_true, pred, fig_dir: Path = FIG_DIR) -> dict:
    """⑤ 评估（并画图）：预测 vs 实际、残差分布。

    返回 figures 字段的一项。
    """
    fig_dir.mkdir(parents=True, exist_ok=True)
    residual = y_true - pred
    fig, axes = plt.subplots(1, 2, figsize=(10, 4))

    lo = float(min(y_true.min(), pred.min()))
    hi = float(max(y_true.max(), pred.max()))
    axes[0].scatter(y_true, pred, s=14, alpha=0.55, color="#4C78A8")
    axes[0].plot([lo, hi], [lo, hi], "r--", lw=1, label="ideal y = x")
    axes[0].set_xlabel("actual (10k CNY)")
    axes[0].set_ylabel("predicted (10k CNY)")
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
        f"预测点整体贴着 y=x；残差中位数 {residual.median():.1f} 万元、大致以 0 为中心，"
        f"说明没有系统性高估或低估；残差里仍有 ±{float(residual.abs().quantile(0.9)):.1f} 万元的波动，"
        f"那是面积之外的因素（地段、装修、楼层）造成的。"
    )
    return {"path": str(path), "takeaway": takeaway}


def compose_notes(baseline: dict, mae: float, r2: float, model) -> str:
    """⑥ 写结论：看图得到的印象 → 选了什么模型 → 与基线比如何 → 不足。"""
    gain = (1 - mae / baseline["mae"]) * 100 if baseline["mae"] else 0.0
    coef = float(model.coef_[0])
    intercept = float(model.intercept_)
    return (
        f"散点显示面积与总价近似线性、小户型单价更高，所以用一元线性回归（面积 + 截距）："
        f"拟合出的截距 {intercept:.1f} 万元正好对应「与面积无关的固定价值」，单价 {coef:.2f} 万元/m²。"
        f"测试集 MAE {mae} 万元、R² {r2}，比「平均单价 × 面积」的现有做法（{baseline['mae']} 万元）低约 {gain:.0f}%。"
        f"不足：真实房价还有地段/楼层等因素，只用面积会在同一面积的样本上误差偏大。"
    )


def train_and_evaluate(df: pd.DataFrame, fig_dir: Path = FIG_DIR) -> dict:
    """② → ⑥ 完整流程：画图看数据 → 定基线 → 训练 → 画图评估 → 组织结论。"""
    figures = [plot_data_overview(df, fig_dir)]

    X, y = df[[FEATURE]], df[TARGET]
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=TEST_SIZE, random_state=RANDOM_STATE
    )

    baseline = build_baseline(X_train, y_train, X_test, y_test)
    model = train_model(X_train, y_train)
    pred = model.predict(X_test)

    mae = round(float(mean_absolute_error(y_test, pred)), 4)
    r2 = round(float(r2_score(y_test, pred)), 4)
    figures.append(plot_evaluation(y_test, pred, fig_dir))

    return {
        "model": "LinearRegression(area_m2)",
        "n_train": int(len(X_train)),
        "n_test": int(len(X_test)),
        "n_rows": int(len(df)),
        "metrics": {"mae": mae, "r2": r2},
        "baseline": baseline,
        "figures": figures,
        "notes": compose_notes(baseline, mae, r2, model),
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
    ap = argparse.ArgumentParser(description="按面积估算房价（参考实现）")
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
