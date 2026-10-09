#!/usr/bin/env python3
"""实验 C 的参考实现（学习示范）：`data.csv` → `output.json`（会员分档方案）。

📖 这份实现**随题目包一起下发**（`problem/reference/`）—— 先读懂它，再写你自己的。
   **它不是唯一正确答案**：达标只要求"macro F1 ≥ 0.60 且每一档召回 ≥ 0.50 + 说清选择"，
   换模型（随机森林、梯度提升）、换特征组合同样能过。

思路（四步，对应下面四个函数）：
  1. `load_data`          读数据，看清有哪些列
  2. `build_baseline`     量化"现有做法"：**不做预测，一律判为低档（多数类）**
                          → accuracy 有 0.4，但 macro F1 只有 0.19（另两档 F1 为 0）
  3. `train_and_evaluate` 关键有两处：**标准化**（各列量纲差很多）与 **macro 视角**评估
                          （逐档召回 + macro F1，而不是只看 accuracy）
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
from sklearn.metrics import accuracy_score, f1_score, recall_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

TARGET = "tier"
TEST_SIZE = 0.25
RANDOM_STATE = 42
MODEL_NAME = "StandardScaler + LogisticRegression"

HERE = Path(__file__).resolve().parent
CASES_DIR = HERE.parent.parent / "cases"

NOTES = (
    "各列量纲差异很大（月均消费到几千元、到访次数只有十几），所以先做标准化再做多分类逻辑回归 —— "
    "不标准化时求解器很难收敛。评估看 macro F1 与逐档召回：三档人数不平均（约 40/35/25），"
    "准确率会被人数最多的低档主导，macro 则对每一档一视同仁。主要信息来自月均消费、到访频次与客单价。"
)


def load_data(case_dir: str | Path) -> pd.DataFrame:
    """读取一个 case 的数据。"""
    return pd.read_csv(Path(case_dir) / "data.csv")


def build_baseline(y_test) -> dict:
    """现有做法：不做预测，**一律判为多数类**（这里通常是最低档）。

    accuracy 等于多数类占比，但 macro F1 很低（人少的档位 F1 为 0）。
    """
    values, counts = pd.Series(y_test).value_counts().index, pd.Series(y_test).value_counts().values
    majority = int(values[0])
    pred = [majority] * len(y_test)
    return {
        "name": "majority_class",
        "accuracy": round(float(accuracy_score(y_test, pred)), 4),
        "macro_f1": round(float(f1_score(y_test, pred, average="macro", zero_division=0)), 4),
    }


def train_and_evaluate(df: pd.DataFrame) -> dict:
    """切分（分层）→ 标准化 + 训练 → 用 macro 视角评估，返回结论字典。"""
    features = [c for c in df.columns if c != TARGET]
    X, y = df[features], df[TARGET]

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=TEST_SIZE, random_state=RANDOM_STATE, stratify=y
    )

    model = make_pipeline(StandardScaler(), LogisticRegression(max_iter=1000))
    model.fit(X_train, y_train)
    pred = model.predict(X_test)

    return {
        "model": MODEL_NAME,
        "n_train": int(len(X_train)),
        "n_test": int(len(X_test)),
        "n_rows": int(len(df)),
        "metrics": {
            "macro_f1": round(float(f1_score(y_test, pred, average="macro")), 4),
            "accuracy": round(float(accuracy_score(y_test, pred)), 4),
            # 逐档召回率：顺序为 0（低）/1（中）/2（高）
            "per_class_recall": [round(float(r), 4) for r in recall_score(y_test, pred, average=None)],
        },
        "baseline": build_baseline(y_test),
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
                "macro_f1": result["metrics"]["macro_f1"],
                "per_class_recall": result["metrics"]["per_class_recall"],
            },
            "accept": {
                "macro_f1_min": 0.60,
                "per_class_recall_min": 0.50,
                "baseline_accuracy_tolerance": 0.15,
            },
        }
        out = case_dir / "expected.json"
        out.write_text(json.dumps(expected, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(
            f"[regen] {out} -> baseline accuracy={expected['baseline']['accuracy']} "
            f"macroF1={expected['baseline']['macro_f1']} | reference macroF1={expected['reference']['macro_f1']} "
            f"逐档召回={expected['reference']['per_class_recall']}"
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
    ok = m["macro_f1"] >= 0.60 and all(r >= 0.50 for r in m["per_class_recall"])
    print(json.dumps(result, ensure_ascii=False))
    print(
        f"[{'达标' if ok else '未达标'}] macro F1={m['macro_f1']} 逐档召回={m['per_class_recall']} "
        f"（要求 macro F1 ≥ 0.60 且每档召回 ≥ 0.50；现有做法 accuracy={result['baseline']['accuracy']}、"
        f"macro F1={result['baseline']['macro_f1']}）"
    )


if __name__ == "__main__":
    main()
