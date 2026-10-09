#!/usr/bin/env python3
"""实验 B 的参考实现（学习示范）：`data.csv` → `output.json`（失约风险方案）。

📖 这份实现**随题目包一起下发**（`problem/reference/`）—— 先读懂它，再写你自己的。
   **它不是唯一正确答案**：达标只要求"recall ≥ 0.65 且 precision ≥ 0.40 + 说清选择"。

本实现刻意走完**完整流程**（与 task.md 的六步对应）：
  ① 看清需求      —— 别漏掉会失约的人，名单也别长到打不完
  ② 看一眼数据    —— `look_at_data`：失约比例、哪几列看起来有用
  ③ 定基线        —— `build_baseline`：不做预测、一律认为会来（recall 必为 0）
  ④ 建模并比较    —— `compare_candidates`：**真的试了几个方案**（含"什么都不做"的默认模型）
  ⑤ 评估          —— 在同一个测试集上算 recall / precision
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
from pathlib import Path

import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, precision_score, recall_score
from sklearn.model_selection import train_test_split

TARGET = "noshow"
TEST_SIZE = 0.25
RANDOM_STATE = 42
RECALL_MIN = 0.65
PRECISION_MIN = 0.40

HERE = Path(__file__).resolve().parent
CASES_DIR = HERE.parent.parent / "cases"


def load_data(case_dir: str | Path) -> pd.DataFrame:
    """① / ② 读数据。"""
    return pd.read_csv(Path(case_dir) / "data.csv")


def look_at_data(df: pd.DataFrame) -> str:
    """② 看一眼数据：不平衡到什么程度、哪些列看起来有用。"""
    rate = float((df[TARGET] == 1).mean())
    corr = df.drop(columns=[TARGET]).corrwith(df[TARGET]).abs().sort_values(ascending=False)
    return (
        f"{len(df)} 条预约，其中失约占 {rate:.1%}（明显不平衡）；"
        f"与失约相关性最高的三列是 {', '.join(corr.index[:3])}"
    )


def build_baseline(y_test) -> dict:
    """③ 现有做法：不做预测，**一律认为患者会来**（预测全为 0）。

    recall 必然是 0（一个失约者都没抓到），accuracy 却等于"会来"的人数比例。
    """
    return {
        "name": "predict_all_show",
        "recall": 0.0,
        "accuracy": round(float((y_test == 0).mean()), 4),
    }


def build_candidates(X_train, X_test) -> dict:
    """④ 待比较的候选方案：至少两个（这里是示范，给了三个）。"""
    return {
        "LogisticRegression(默认参数)": (LogisticRegression(max_iter=1000), X_train, X_test),
        "LogisticRegression(class_weight='balanced')": (
            LogisticRegression(max_iter=1000, class_weight="balanced"), X_train, X_test,
        ),
        "RandomForest(class_weight='balanced')": (
            RandomForestClassifier(n_estimators=200, class_weight="balanced", random_state=0), X_train, X_test,
        ),
    }


def compare_candidates(X_train, X_test, y_train, y_test) -> tuple[dict, dict]:
    """④ 建模并比较：逐个训练、在**同一个测试集**上记录 recall / precision。"""
    scores: dict[str, dict] = {}
    fitted: dict[str, tuple] = {}
    for name, (model, xtr, xte) in build_candidates(X_train, X_test).items():
        model.fit(xtr, y_train)
        pred = model.predict(xte)
        scores[name] = {
            "recall": round(float(recall_score(y_test, pred)), 4),
            "precision": round(float(precision_score(y_test, pred)), 4),
        }
        fitted[name] = (model, xte)
    return scores, fitted


def compose_notes(observation: str, scores: dict, best: str, best_metrics: dict) -> str:
    """⑥ 写结论：看过数据 → 比较过方案 → 为什么选它 → 还有什么不足。"""
    comparison = "；".join(
        f"{name}（recall {s['recall']}、precision {s['precision']}）" for name, s in scores.items()
    )
    return (
        f"{observation}。比较了 {len(scores)} 个方案（同一测试集、固定种子）：{comparison}。"
        f"最终选 {best}：recall {best_metrics['recall']}、precision {best_metrics['precision']} —— "
        f"在「尽量别漏掉失约者」的前提下误报更少；相比「一律认为会来」（recall=0）才算真的抓住了人。"
        f"不足：中低风险段仍有误报，阈值没有按提醒成本进一步调优。"
    )


def train_and_evaluate(df: pd.DataFrame) -> dict:
    """② → ⑥ 完整流程：看数据 → 定基线 → 比较候选 → 评估 → 组织结论。"""
    observation = look_at_data(df)
    features = [c for c in df.columns if c != TARGET]
    X, y = df[features], df[TARGET]

    # stratify=y：让训练/测试集里的失约比例都与整体一致（不平衡数据尤其要这样切）
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=TEST_SIZE, random_state=RANDOM_STATE, stratify=y
    )

    baseline = build_baseline(y_test)
    scores, fitted = compare_candidates(X_train, X_test, y_train, y_test)

    # ⑤ 评估：业务先要"别漏人"（recall 达标），再看谁的误报更少（precision 高）
    ok = {n: s for n, s in scores.items() if s["recall"] >= RECALL_MIN}
    best = max(ok, key=lambda n: ok[n]["precision"]) if ok else max(scores, key=lambda n: scores[n]["recall"])
    model, x_test_used = fitted[best]
    pred = model.predict(x_test_used)

    return {
        "model": best,
        "n_train": int(len(X_train)),
        "n_test": int(len(X_test)),
        "n_rows": int(len(df)),
        "metrics": {
            "recall": round(float(recall_score(y_test, pred)), 4),
            "precision": round(float(precision_score(y_test, pred)), 4),
            "accuracy": round(float(accuracy_score(y_test, pred)), 4),
        },
        "baseline": baseline,
        "threshold": 0.5,
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
            f"reference {expected['reference']['model']} recall={expected['reference']['recall']} "
            f"precision={expected['reference']['precision']}"
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
    print(
        f"[{'达标' if ok else '未达标'}] recall={m['recall']} precision={m['precision']} "
        f"（要求 recall ≥ {RECALL_MIN} 且 precision ≥ {PRECISION_MIN}；现有做法 recall=0、"
        f"accuracy={result['baseline']['accuracy']}）"
    )


if __name__ == "__main__":
    main()
