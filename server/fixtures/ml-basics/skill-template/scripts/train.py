#!/usr/bin/env python3
"""按 params.json 的口径训练并评估模型：<case_dir>/{input.csv,params.json} → output.json。

**骨架：核心逻辑由学生补全**（TODO 处）。平台复验会把这份 Skill 交给 agent 使用，所以：
  - 命令行约定保持稳定（不要改用法）；
  - TODO 要真正实现，**不要在脚本里写死某个测试用例的答案**。

用法：
  python3 scripts/train.py <case_dir> <output.json>
"""
import json
import sys
from pathlib import Path

# TODO：按 SKILL.md / problem/task.md 的口径实现。
# 允许用的库（复验镜像已预装）：sklearn / pandas / numpy。
# 这里刻意不 import，学生自行决定实现方式（pandas 或 csv 都行）。


def load_case(case_dir):
    """读 <case_dir>/input.csv 与 params.json，返回 (X, y, params)。

    TODO：实现。约定：
      - input.csv 第一行是表头，**最后一列是标签**，其余列是特征；
      - params.json 原样解析为 dict；
      - 分类任务要把 y 转成整数。
    """
    raise NotImplementedError("TODO: 读入 input.csv 与 params.json（见 SKILL.md 口径）")


def train_and_evaluate(X, y, params):
    """按 params 训练并评估，返回 {"model", "n_train", "n_test", "metrics"}。

    TODO：实现。口径见 SKILL.md「建模口径」与 problem/task.md：
      - 切分要照抄 params 的 test_size / random_state，并按 stratify 决定是否分层；
      - model_params 透传给模型构造函数；
      - 回归给 r2/mae，分类给 accuracy/confusion_matrix，数值 4 位小数。
    """
    raise NotImplementedError("TODO: 切分、训练、评估（见 SKILL.md 口径）")


def main(argv):
    if len(argv) != 3:
        print("usage: train.py <case_dir> <output.json>", file=sys.stderr)
        return 2
    case_dir, out_path = Path(argv[1]), argv[2]
    X, y, params = load_case(case_dir)
    result = train_and_evaluate(X, y, params)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
        f.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
