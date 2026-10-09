#!/usr/bin/env python3
"""实验 B 的参考实现（学习示范）：`data.csv` → `output.json`（失约风险方案）。

📖 这份实现**随题目包一起下发**（`problem/reference/`）—— 先读懂它，再写你自己的。
   **它不是唯一正确答案**：达标只要求"recall ≥ 0.65 且 precision ≥ 0.40 + 说清选择"，
   换模型（随机森林、梯度提升）、换阈值、换特征组合同样能过。

思路（四步，对应下面四个函数）：
  1. `load_data`          读数据，看清有哪些列
  2. `build_baseline`     量化"现有做法"：**不做预测，一律认为会来**（预测全 0）
                          → 它的 recall 必然是 0，而 accuracy 却有 7 成（这就是"准确率骗人"）
  3. `train_and_evaluate` **处理不平衡**是关键：失约者只占约 1/4，默认训练会让模型偏向多数类，
                          于是用 `class_weight="balanced"` 把少数类的权重抬起来
  4. `run_case`           把结论写成判据要求的 output.json

用法：
  python3 scripts/train.py <case目录> <output.json>     # 单个 case
  python3 scripts/train.py --regen-expected             # 重算 problem/cases/*/expected.json

expected.json 存的是**参考水平**（基线 + 参考实现），不是标准答案。
请在**与复验同一个镜像内**生成（当前 pkg5）：

  docker run --rm -v "$PWD:/w" --entrypoint python3 \
    nju-lab-verify:0.2.0-rc.2-pkg5 /w/problem/reference/scripts/train.py --regen-expected
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, precision_score, recall_score
from sklearn.model_selection import train_test_split

TARGET = "noshow"
TEST_SIZE = 0.25
RANDOM_STATE = 42
MODEL_NAME = "LogisticRegression(class_weight='balanced')"

HERE = Path(__file__).resolve().parent
CASES_DIR = HERE.parent.parent / "cases"

NOTES = (
    "标签只有约四分之一是失约（明显不平衡），默认训练会让模型偏向『会来』这个多数类，"
    "所以用 class_weight='balanced' 抬高少数类权重；特征主要靠 lead_days（越早约越容易变卦）、"
    "prior_noshow（既往失约史）与 reminder_called（已提醒的明显更容易来）。"
    "默认 0.5 阈值下 recall 约 0.73、precision 约 0.47 —— 相比『一律认为会来』（recall=0）"
    "才算真的抓住了人；若业务更怕漏掉，还可以把阈值调低换更高的 recall。"
)


def load_data(case_dir: str | Path) -> pd.DataFrame:
    """读取一个 case 的数据。"""
    return pd.read_csv(Path(case_dir) / "data.csv")


def build_baseline(y_test) -> dict:
    """现有做法：不做预测，**一律认为患者会来**（预测全为 0）。

    recall 必然是 0（一个失约者都没抓到），accuracy 却等于"会来"的人数比例。
    """
    return {
        "name": "predict_all_show",
        "recall": 0.0,
        "accuracy": round(float((y_test == 0).mean()), 4),
    }


def train_and_evaluate(df: pd.DataFrame) -> dict:
    """切分（分层）→ 训练（处理不平衡）→ 在测试集上评估，返回结论字典。"""
    features = [c for c in df.columns if c != TARGET]
    X, y = df[features], df[TARGET]

    # stratify=y：让训练/测试集里的失约比例都与整体一致（不平衡数据尤其要这样切）
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=TEST_SIZE, random_state=RANDOM_STATE, stratify=y
    )

    model = LogisticRegression(max_iter=1000, class_weight="balanced")
    model.fit(X_train, y_train)
    pred = model.predict(X_test)

    return {
        "model": MODEL_NAME,
        "n_train": int(len(X_train)),
        "n_test": int(len(X_test)),
        "n_rows": int(len(df)),
        "metrics": {
            "recall": round(float(recall_score(y_test, pred)), 4),
            "precision": round(float(precision_score(y_test, pred)), 4),
            "accuracy": round(float(accuracy_score(y_test, pred)), 4),
        },
        "baseline": build_baseline(y_test),
        "threshold": 0.5,
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
                "recall_min": 0.65,
                "precision_min": 0.40,
                "baseline_accuracy_tolerance": 0.15,
            },
        }
        out = case_dir / "expected.json"
        out.write_text(json.dumps(expected, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(
            f"[regen] {out} -> baseline accuracy={expected['baseline']['accuracy']} "
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
    ok = result["metrics"]["recall"] >= 0.65 and result["metrics"]["precision"] >= 0.40
    print(json.dumps(result, ensure_ascii=False))
    print(
        f"[{'达标' if ok else '未达标'}] recall={result['metrics']['recall']} "
        f"precision={result['metrics']['precision']} "
        f"（要求 recall ≥ 0.65 且 precision ≥ 0.40；现有做法 recall=0、"
        f"accuracy={result['baseline']['accuracy']}）"
    )


if __name__ == "__main__":
    main()
