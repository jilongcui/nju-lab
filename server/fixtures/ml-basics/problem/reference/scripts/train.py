#!/usr/bin/env python3
"""ml-basics 的**参考实现（学习示范）**：<case_dir>/{input.csv,params.json} → output.json。

📖 这份实现**随题目包一起下发**（`problem/reference/`）—— 建议先读懂它，再在 `skill/` 里
   写自己的版本（自己敲一遍、改掉你觉得别扭的地方，比复制粘贴学得多）。

函数划分与学生起点 `skill-template/` 刻意保持一致（load_case / train_and_evaluate / main），
方便逐段对照。教师侧它也用于"题目可解性"自检：`--skill problem/reference` 跑复验应全通过。

用法：
  python3 scripts/train.py <case目录> <output.json>     # 单个 case
  python3 scripts/train.py --regen-cases                # 重算 problem/cases/*/expected.json

口径与 problem/task.md、problem/judge.md 三处必须一致（改一处要改三处）。
expected.json 请在**与复验同一个镜像内**生成，保证 sklearn 版本与复验环境一致（当前 pkg4）：

  docker run --rm -v "$PWD:/w" --entrypoint python3 \
    nju-lab-verify:0.2.0-rc.2-pkg4 /w/problem/reference/scripts/train.py --regen-cases
"""
import csv
import json
import sys
from pathlib import Path

import numpy as np
from sklearn.linear_model import LinearRegression, LogisticRegression
from sklearn.metrics import accuracy_score, confusion_matrix, mean_absolute_error, r2_score
from sklearn.model_selection import train_test_split

MODELS = {"LinearRegression": LinearRegression, "LogisticRegression": LogisticRegression}


def load_case(case_dir):
    """读 <case_dir>/input.csv 与 params.json，返回 (X, y, params)。

    骨架里的同名函数就是这个的 TODO 版本：
      - input.csv 第一行是表头，**最后一列是标签**，其余列是特征；
      - params.json 原样解析为 dict；
      - 分类任务要把 y 转成整数（在 train_and_evaluate 里做，与口径描述一致）。
    """
    with (Path(case_dir) / "input.csv").open(newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    if not rows:
        raise SystemExit(f"{case_dir}/input.csv 没有数据行")
    with (Path(case_dir) / "params.json").open(encoding="utf-8") as f:
        params = json.load(f)
    names = list(rows[0].keys())
    feature_names, target_name = names[:-1], names[-1]
    X = np.array([[float(r[c]) for c in feature_names] for r in rows])
    y = np.array([float(r[target_name]) for r in rows])
    return X, y, params


def train_and_evaluate(X, y, params):
    """按 params 切分、训练、评估，返回 {"model", "n_train", "n_test", "metrics"}。"""
    task = params["task"]
    model_name = params["model"]
    if model_name not in MODELS:
        raise SystemExit(f"不支持的 model: {model_name}（可选 {sorted(MODELS)}）")
    if task == "classification":
        y = y.astype(int)
    strat = y if (task == "classification" and params.get("stratify", True)) else None
    X_train, X_test, y_train, y_test = train_test_split(
        X, y,
        test_size=params.get("test_size", 0.25),
        random_state=params.get("random_state", 42),
        stratify=strat,
    )
    model = MODELS[model_name](**params.get("model_params", {}))
    model.fit(X_train, y_train)
    pred = model.predict(X_test)

    if task == "regression":
        metrics = {
            "r2": round(float(r2_score(y_test, pred)), 4),
            "mae": round(float(mean_absolute_error(y_test, pred)), 4),
        }
    elif task == "classification":
        metrics = {
            "accuracy": round(float(accuracy_score(y_test, pred)), 4),
            "confusion_matrix": confusion_matrix(y_test, pred).tolist(),
        }
    else:
        raise SystemExit(f"不支持的 task: {task}（可选 regression / classification）")

    return {
        "model": model_name,
        "n_train": int(len(X_train)),
        "n_test": int(len(X_test)),
        "metrics": metrics,
    }


def run_case(case_dir):
    X, y, params = load_case(case_dir)
    return train_and_evaluate(X, y, params)


def write_result(result, out_path):
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
        f.write("\n")


def regen_cases():
    cases_dir = Path(__file__).resolve().parent.parent.parent / "cases"
    for case_dir in sorted(p for p in cases_dir.iterdir() if p.is_dir()):
        result = run_case(case_dir)
        out = case_dir / "expected.json"
        write_result(result, out)
        print(f"[regen] {out} -> {json.dumps(result, ensure_ascii=False)}")


def main(argv):
    if len(argv) == 2 and argv[1] == "--regen-cases":
        regen_cases()
        return 0
    if len(argv) != 3:
        print("usage: train.py <case目录> <output.json> | --regen-cases", file=sys.stderr)
        return 2
    write_result(run_case(argv[1]), argv[2])
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
