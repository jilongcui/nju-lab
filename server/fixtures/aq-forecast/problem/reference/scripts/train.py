#!/usr/bin/env python3
"""实验 A 的参考实现（学习示范）：`data.csv` → `output.json`（达标报告）。

📖 这份实现**随题目包一起下发**（`problem/reference/`）—— 建议先读懂它，
   再在 `skill/` 里写你自己的版本。**它不是唯一正确答案**：判据只要求
   "MAE 比持久性基线低 ≥20% + 说清选择"，换模型（RandomForest / 梯度提升…）、
   换特征组合、换切分方式同样能通过 —— 你甚至可以做得比它更好。

思路（三步，对应下面三个函数）：
  1. `load_data`          读数据，看清有哪些列
  2. `build_baseline`     先算"现有做法"的成绩：把上一小时的值当预测（持久性基线）
  3. `train_and_evaluate` 训练模型 + 在同一测试集上评估，得出 MAE / R²
最后 `run_case` 把结论写成判据要求的 output.json。

用法：
  python3 scripts/train.py <case目录> <output.json>     # 单个 case
  python3 scripts/train.py --regen-expected             # 重算 problem/cases/*/expected.json

expected.json 存的是**参考水平**（基线 + 参考实现），不是标准答案：
判据用它核对学生的 `baseline` 是否可信、识别"可疑地过于好"的结果。
请在**与复验同一个镜像内**生成，保证 sklearn 版本一致（当前 pkg4）：

  docker run --rm -v "$PWD:/w" --entrypoint python3 \
    nju-lab-verify:0.2.0-rc.2-pkg4 /w/problem/reference/scripts/train.py --regen-expected
"""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

import pandas as pd
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.model_selection import train_test_split

TARGET = "pm25_next"
LAG_COL = "pm25_lag1"
TEST_SIZE = 0.25
RANDOM_STATE = 42
MODEL_NAME = "Ridge(alpha=1.0)"

HERE = Path(__file__).resolve().parent
CASES_DIR = HERE.parent.parent / "cases"

NOTES = (
    "用全部 6 个特征 + Ridge(alpha=1.0)：pm25_lag1（本监测点上一小时）是主因 —— 空气不会突然变化；"
    "pm25_neighbor（附近监测站）提供空气流动带来的额外信息，wind_speed 越大污染物越容易被吹散、浓度更低，"
    "humidity 也有影响；Ridge 在样本量不大时比普通最小二乘更稳。测试集 MAE 约为持久性基线的 6 成。"
)


def load_data(case_dir: str | Path) -> pd.DataFrame:
    """读取一个 case 的数据。"""
    return pd.read_csv(Path(case_dir) / "data.csv")


def build_baseline(y_true, X_test) -> float:
    """现有做法（持久性基线）：把上一小时的值直接当预测，在同一测试集上算 MAE。"""
    return float(mean_absolute_error(y_true, X_test[LAG_COL]))


def train_and_evaluate(df: pd.DataFrame) -> dict:
    """切分 → 训练 → 在测试集上评估，返回结论字典。"""
    features = [c for c in df.columns if c != TARGET]
    X, y = df[features], df[TARGET]

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=TEST_SIZE, random_state=RANDOM_STATE
    )

    model = Ridge(alpha=1.0)
    model.fit(X_train, y_train)
    pred = model.predict(X_test)

    return {
        "model": MODEL_NAME,
        "n_train": int(len(X_train)),
        "n_test": int(len(X_test)),
        "n_rows": int(len(df)),
        "metrics": {
            "mae": round(float(mean_absolute_error(y_test, pred)), 4),
            "r2": round(float(r2_score(y_test, pred)), 4),
        },
        "baseline": {
            "name": "persistence",
            "mae": round(build_baseline(y_test, X_test), 4),
        },
        "notes": NOTES,
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
            f"reference={expected['reference']['mae']}"
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
