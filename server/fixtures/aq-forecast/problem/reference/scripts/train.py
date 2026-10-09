#!/usr/bin/env python3
"""实验 A 的参考实现（学习示范）：`data.csv` → `output.json`（达标报告）。

📖 这份实现**随题目包一起下发**（`problem/reference/`）—— 建议先读懂它，
   再在 `skill/` 里写你自己的版本。**它不是唯一正确答案**：判据只要求
   "MAE 比持久性基线低 ≥20% + 说清选择"，换模型、换特征同样能通过。

本实现刻意走完**完整流程**（与 task.md 的六步对应）：
  ① 看清需求            —— 见 NOTES 里的业务口径
  ② 看一眼数据          —— `look_at_data`：范围、量纲、相关性
  ③ 定基线              —— `build_baseline`：把上一小时的值当预测（持久性基线）
  ④ 建模并比较          —— `compare_candidates`：**真的试了几个方案**并记录各自成绩
  ⑤ 评估                —— 在同一个测试集上算 MAE / R²
  ⑥ 写结论              —— `compose_notes`：把比较过程与结论写进 notes

用法：
  python3 scripts/train.py <case目录> <output.json>     # 单个 case
  python3 scripts/train.py --regen-expected             # 重算 problem/cases/*/expected.json

expected.json 存的是**参考水平**（基线 + 参考实现），不是标准答案：
判据用它核对学生的 `baseline` 是否可信、识别"可疑地过于好"的结果。
请在**与复验同一个镜像内**生成，保证 sklearn 版本一致（当前 pkg5）：

  docker run --rm -v "$PWD:/w" --entrypoint python3 \
    nju-lab-verify:0.2.0-rc.2-pkg5 /w/problem/reference/scripts/train.py --regen-expected
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.linear_model import LinearRegression, Ridge
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.model_selection import train_test_split

TARGET = "pm25_next"
LAG_COL = "pm25_lag1"
TEST_SIZE = 0.25
RANDOM_STATE = 42

HERE = Path(__file__).resolve().parent
CASES_DIR = HERE.parent.parent / "cases"


def load_data(case_dir: str | Path) -> pd.DataFrame:
    """① / ② 读数据。"""
    return pd.read_csv(Path(case_dir) / "data.csv")


def look_at_data(df: pd.DataFrame) -> str:
    """② 看一眼数据：量纲差异与相关性 —— 这一步决定你后面怎么建模。

    输出一句话观察，供 notes 使用（真实项目里你会更仔细地画图、看缺失与离群值）。
    """
    features = [c for c in df.columns if c != TARGET]
    scales = df[features].max() - df[features].min()
    top_feature = (df[features].corrwith(df[TARGET]).abs().idxmax())
    return (
        f"各列取值范围从 {scales.min():.0f} 到 {scales.max():.0f}（量纲差别{'明显' if scales.max() / max(scales.min(), 1e-9) > 5 else '不大'}）；"
        f"与目标相关性最高的是 {top_feature}"
    )


def build_baseline(y_true, X_test) -> float:
    """③ 现有做法（持久性基线）：把上一小时的值直接当预测，在同一测试集上算 MAE。"""
    return float(mean_absolute_error(y_true, X_test[LAG_COL]))


def build_candidates(X_train, X_test) -> dict:
    """④ 待比较的候选方案：至少两个（这里是示范，给了四个）。"""
    return {
        "只用上一小时浓度 + LinearRegression": (LinearRegression(), X_train[[LAG_COL]], X_test[[LAG_COL]]),
        "全特征 + LinearRegression": (LinearRegression(), X_train, X_test),
        "全特征 + Ridge(alpha=1.0)": (Ridge(alpha=1.0), X_train, X_test),
        "全特征 + RandomForest(200)": (RandomForestRegressor(n_estimators=200, random_state=0), X_train, X_test),
    }


def compare_candidates(X_train, X_test, y_train, y_test) -> tuple[dict, dict]:
    """④ 建模并比较：逐个训练、在**同一个测试集**上记录成绩，保留拟合好的模型。

    返回 (各方案 MAE, 各方案 (模型, 测试集特征))。
    """
    scores: dict[str, float] = {}
    fitted: dict[str, tuple] = {}
    for name, (model, xtr, xte) in build_candidates(X_train, X_test).items():
        model.fit(xtr, y_train)
        scores[name] = round(float(mean_absolute_error(y_test, model.predict(xte))), 4)
        fitted[name] = (model, xte)
    return scores, fitted


def compose_notes(observation: str, scores: dict, best: str, baseline_mae: float, best_mae: float) -> str:
    """⑥ 写结论：把"看过数据 → 比较过方案 → 选了什么 → 还有什么不足"写清楚。"""
    comparison = "；".join(f"{name} MAE {value}" for name, value in scores.items())
    gain = (1 - best_mae / baseline_mae) * 100 if baseline_mae else 0.0
    return (
        f"{observation}。比较了 {len(scores)} 个方案（同一测试集、固定种子）：{comparison}。"
        f"最终选 {best}：测试集 MAE {best_mae}，比持久性基线（{baseline_mae}）低约 {gain:.0f}%。"
        f"不足：极端高浓度的时刻误差相对更大（这类拐点模型不容易抓住）。"
    )


def train_and_evaluate(df: pd.DataFrame) -> dict:
    """② → ⑥ 完整流程：看数据 → 定基线 → 比较候选 → 评估 → 组织结论。"""
    observation = look_at_data(df)
    features = [c for c in df.columns if c != TARGET]
    X, y = df[features], df[TARGET]

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=TEST_SIZE, random_state=RANDOM_STATE
    )

    baseline_mae = round(build_baseline(y_test, X_test), 4)
    scores, fitted = compare_candidates(X_train, X_test, y_train, y_test)

    # ⑤ 评估：选测试集 MAE 最低的方案（真实项目里还要权衡可解释性、训练成本等）
    best = min(scores, key=scores.get)
    model, x_test_used = fitted[best]
    pred = model.predict(x_test_used)

    return {
        "model": best,
        "n_train": int(len(X_train)),
        "n_test": int(len(X_test)),
        "n_rows": int(len(df)),
        "metrics": {
            "mae": round(float(mean_absolute_error(y_test, pred)), 4),
            "r2": round(float(r2_score(y_test, pred)), 4),
        },
        "baseline": {"name": "persistence", "mae": baseline_mae},
        "notes": compose_notes(observation, scores, best, baseline_mae, scores[best]),
    }


def run_case(case_dir: str | Path, out_path: str | Path) -> dict:
    result = train_and_evaluate(load_data(case_dir))
    # 交付给判据的 output.json 不包含 n_rows（那是给出题人核对用的元信息）
    payload = {k: v for k, v in result.items() if k != "n_rows"}
    Path(out_path).write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return result


def regen_expected() -> None:
    """重算每个 case 的 expected.json（参考水平，不是标准答案）。"""
    for case_dir in sorted(p for p in CASES_DIR.iterdir() if p.is_dir()):
        result = train_and_evaluate(load_data(case_dir))
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
    print(f"[{'达标' if ok else '未达标'}] MAE={result['metrics']['mae']} 基线={result['baseline']['mae']}")


if __name__ == "__main__":
    main()
