#!/usr/bin/env python3
"""实验 C 的参考实现（学习示范）：`data.csv` → `output.json`（会员分档方案）。

📖 这份实现**随题目包一起下发**（`problem/reference/`）—— 先读懂它，再写你自己的。
   **它不是唯一正确答案**：达标只要求"macro F1 ≥ 0.60 且每一档召回 ≥ 0.50 + 说清选择"。

本实现刻意走完**完整流程**（与 task.md 的六步对应）：
  ① 看清需求      —— 三档都要分准（macro 视角），任何一档都不能放弃
  ② 看一眼数据    —— `look_at_data`：三档各占多少、量纲差多少
  ③ 定基线        —— `build_baseline`：不做预测、一律判多数类（accuracy 0.4，macro F1 只有 0.19）
  ④ 建模并比较    —— `compare_candidates`：**真的试了几个方案**（含"不标准化"这种常见坑）
  ⑤ 评估          —— 在同一个测试集上算 macro F1 与逐档召回
  ⑥ 写结论        —— `compose_notes`：把比较过程、选择理由与不足写进 notes

用法：
  python3 scripts/train.py <case目录> <output.json>     # 单个 case
  python3 scripts/train.py --regen-expected             # 重算 problem/cases/*/expected.json

请在**与复验同一个镜像内**生成 expected（当前 pkg5）：

  docker run --rm -v "$PWD:/w" --entrypoint python3 \
    nju-lab-verify:0.2.0-rc.2-pkg5 /w/problem/reference/scripts/train.py --regen-expected
"""
from __future__ import annotations

import argparse
import json
import warnings
from pathlib import Path

import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.exceptions import ConvergenceWarning
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, f1_score, recall_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

TARGET = "tier"
TEST_SIZE = 0.25
RANDOM_STATE = 42
MACRO_F1_MIN = 0.60
PER_CLASS_RECALL_MIN = 0.50

HERE = Path(__file__).resolve().parent
CASES_DIR = HERE.parent.parent / "cases"


def load_data(case_dir: str | Path) -> pd.DataFrame:
    """① / ② 读数据。"""
    return pd.read_csv(Path(case_dir) / "data.csv")


def look_at_data(df: pd.DataFrame) -> str:
    """② 看一眼数据：三档各占多少、量纲差多少。"""
    counts = df[TARGET].value_counts(normalize=True).sort_index()
    spread = df.drop(columns=[TARGET]).max() - df.drop(columns=[TARGET]).min()
    return (
        f"{len(df)} 名会员，三档占比 "
        + " / ".join(f"{c:.0%}" for c in counts)
        + f"（不平均，所以要看 macro）；各列取值范围相差 {spread.max() / max(spread.min(), 1e-9):.0f} 倍（量纲差别大）"
    )


def build_baseline(y_test) -> dict:
    """③ 现有做法：不做预测，**一律判为多数类**（这里通常是最低档）。

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


def build_candidates(X_train, X_test) -> dict:
    """④ 待比较的候选方案：至少两个（这里是示范，给了三个，含一个常见坑）。"""
    return {
        "LogisticRegression(未标准化)": (LogisticRegression(max_iter=1000), X_train, X_test),
        "StandardScaler + LogisticRegression": (
            make_pipeline(StandardScaler(), LogisticRegression(max_iter=1000)), X_train, X_test,
        ),
        "RandomForest(200)": (RandomForestClassifier(n_estimators=200, random_state=0), X_train, X_test),
    }


def compare_candidates(X_train, X_test, y_train, y_test) -> tuple[dict, dict]:
    """④ 建模并比较：逐个训练、在**同一个测试集**上记录 macro F1 与逐档召回。"""
    scores: dict[str, dict] = {}
    fitted: dict[str, tuple] = {}
    for name, (model, xtr, xte) in build_candidates(X_train, X_test).items():
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            model.fit(xtr, y_train)
            pred = model.predict(xte)
            converged = not any(issubclass(w.category, ConvergenceWarning) for w in caught)
        scores[name] = {
            "macro_f1": round(float(f1_score(y_test, pred, average="macro")), 4),
            "per_class_recall": [round(float(r), 4) for r in recall_score(y_test, pred, average=None)],
            "converged": converged,
        }
        fitted[name] = (model, xte)
    return scores, fitted


def compose_notes(observation: str, scores: dict, best: str, best_metrics: dict) -> str:
    """⑥ 写结论：看过数据 → 比较过方案 → 为什么选它 → 还有什么不足。"""
    parts = []
    for name, s in scores.items():
        extra = "" if s["converged"] else "（出现 ConvergenceWarning，未真正收敛）"
        parts.append(f"{name} macro F1 {s['macro_f1']}{extra}")
    return (
        f"{observation}。比较了 {len(scores)} 个方案（同一测试集、固定种子）：{'；'.join(parts)}。"
        f"最终选 {best}：macro F1 {best_metrics['macro_f1']}、逐档召回 {best_metrics['per_class_recall']}，"
        f"三档都没有被放弃。不足：中档与高档之间仍有混淆，若要进一步优化可以考虑给高档更高的权重。"
    )


def train_and_evaluate(df: pd.DataFrame) -> dict:
    """② → ⑥ 完整流程：看数据 → 定基线 → 比较候选 → 评估 → 组织结论。"""
    observation = look_at_data(df)
    features = [c for c in df.columns if c != TARGET]
    X, y = df[features], df[TARGET]

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=TEST_SIZE, random_state=RANDOM_STATE, stratify=y
    )

    baseline = build_baseline(y_test)
    scores, fitted = compare_candidates(X_train, X_test, y_train, y_test)

    # ⑤ 评估：先排除"没真正收敛"的方案（未标准化时常发生），再要"每档都不放弃"，最后比 macro F1
    pool = {n: s for n, s in scores.items() if s["converged"]} or scores
    ok = {
        n: s for n, s in pool.items()
        if all(r >= PER_CLASS_RECALL_MIN for r in s["per_class_recall"])
    }
    finalists = ok or pool
    best = max(finalists, key=lambda n: finalists[n]["macro_f1"])
    model, x_test_used = fitted[best]
    pred = model.predict(x_test_used)

    return {
        "model": best,
        "n_train": int(len(X_train)),
        "n_test": int(len(X_test)),
        "n_rows": int(len(df)),
        "metrics": {
            "macro_f1": round(float(f1_score(y_test, pred, average="macro")), 4),
            "accuracy": round(float(accuracy_score(y_test, pred)), 4),
            # 逐档召回率：顺序为 0（低）/1（中）/2（高）
            "per_class_recall": [round(float(r), 4) for r in recall_score(y_test, pred, average=None)],
        },
        "baseline": baseline,
        "notes": compose_notes(observation, scores, best, scores[best]),
    }


def run_case(case_dir: str | Path, out_path: str | Path) -> dict:
    result = train_and_evaluate(load_data(case_dir))
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
                "macro_f1_min": MACRO_F1_MIN,
                "per_class_recall_min": PER_CLASS_RECALL_MIN,
                "baseline_accuracy_tolerance": 0.15,
            },
        }
        out = case_dir / "expected.json"
        out.write_text(json.dumps(expected, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(
            f"[regen] {out} -> baseline accuracy={expected['baseline']['accuracy']} "
            f"macroF1={expected['baseline']['macro_f1']} | reference {expected['reference']['model']} "
            f"macroF1={expected['reference']['macro_f1']} 逐档召回={expected['reference']['per_class_recall']}"
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
    print(
        f"[{'达标' if ok else '未达标'}] macro F1={m['macro_f1']} 逐档召回={m['per_class_recall']} "
        f"（要求 macro F1 ≥ {MACRO_F1_MIN} 且每档召回 ≥ {PER_CLASS_RECALL_MIN}；"
        f"现有做法 accuracy={result['baseline']['accuracy']}、macro F1={result['baseline']['macro_f1']}）"
    )


if __name__ == "__main__":
    main()
