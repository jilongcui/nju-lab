"""实现骨架：读 case 目录 → 产出 output.json + 两张图。

代码里的 TODO 才是你要改的地方（文档不用改）。
用法：python3 scripts/train.py <case目录> <output.json> [--fig-dir figures]
"""
import argparse
import json
from pathlib import Path

import pandas as pd


def load(case_dir: Path) -> pd.DataFrame:
    return pd.read_csv(case_dir / "data.csv")


def baseline(df: pd.DataFrame) -> dict:
    """③ 基线：不建模的朴素做法（例如一律报最多的类别 / 一律报平均值）。"""
    # TODO: 按题目口径实现基线
    return {"name": "不建模基线"}


def train(df: pd.DataFrame) -> dict:
    """④ 训练 / 搭建：选一个你能讲清楚的方案。"""
    # TODO: 固定随机种子、切分（测试集 20%~40%）、训练
    return {"model": "未命名方案", "n_train": 0, "n_test": 0, "metrics": {}}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("case_dir")
    ap.add_argument("out")
    ap.add_argument("--fig-dir", default="figures")
    a = ap.parse_args()

    df = load(Path(a.case_dir))
    result = {
        **train(df),
        "baseline": baseline(df),
        "figures": [
            # TODO: 画两张图，path 与实际落点一致（相对当前工作目录）
        ],
        "notes": "",
    }
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
