#!/usr/bin/env python3
"""第 4 章（大语言模型原理）实验的造题工具：生成「句子 + 输入表示 + 权重 + logits」。

**不下发给学生**（`tools/` 是造题工具）。

设计要点（出题时的实测依据见 `README.md`）：

- **输入全部写死**：所有小数落地成固定 3 位小数的十进制字符串（学生读到的就是这些数字），
  所以 Q/K/V、注意力矩阵、校验和、`top_attend` 都是**跨平台逐位一致**的确定值 ——
  判据才敢断言"谁算都一样"；
- **score 的量级要标定**：缩放（除以 √d_head）之后仍要有区分度，去掉缩放之后明显变尖 ——
  这样"缩放到底解决什么"才能被**量出来**（`max_row_weight` 变大、行熵变小）；
- **logits 的 top-1 优势要标定**：小锐化系数压得住、大锐化系数压不住 ——
  这样"不同锐化系数下 top1_ratio 的变化"才有梯度。

用法：

  python3 tools/gen_data.py            # 重新生成 problem/cases/case01|case02 的输入文件
  python3 tools/gen_data.py --print    # 只打印统计，不落盘
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import random
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
CASES_DIR = HERE.parent / "problem" / "cases"

D_MODEL = 8  # 输入表示维度（相当于 d_model 的一个小切片）
D_HEAD = 4  # 单个注意力头的维度（√d_head = 2，缩放因子）

# ---------------------------------------------------------------- 语料（虚构教学数据）

CASES: dict[str, dict] = {
    "case01": {
        "seed": 4101,
        "sentences": [
            "The patient reported fever and cough for three days .",
            "The chest radiograph showed a small infiltrate in the right lung .",
            "The patient recovered after five days of treatment and was discharged .",
        ],
        "vocab": ["therapy", "the", "patient", "fever", "days", "lung", "after", "was"],
        "logits": [3.10, 2.42, 1.36, 0.44, -0.30, -0.95, -1.40, -1.75],
    },
    "case02": {
        "seed": 4102,
        "sentences": [
            "The patient reported chest pain and shortness of breath after exercise .",
            "The electrocardiogram showed ST elevation in the anterior leads .",
            "The patient was taken to the catheterisation laboratory within one hour .",
            "The patient recovered well after coronary stenting and was discharged in five days .",
        ],
        "vocab": ["infarction", "chest", "pain", "the", "coronary", "hours", "after", "and"],
        "logits": [3.24, 2.30, 1.12, 0.28, -0.34, -0.88, -1.52, -1.94],
    },
}

PUNCT = ".,;:!?"  # 切 token 时要去掉的标点（口径写死在 task.md）


# ---------------------------------------------------------------- 切词口径（与学生侧一致）


def tokenize_sentences(sentences: list[str]) -> list[str]:
    """口径：按空白切分 → 去掉 `.,;:!?` → 丢掉空片段；大小写**保持原样**。"""
    tokens: list[str] = []
    for text in sentences:
        for raw in text.split():
            token = raw
            for ch in PUNCT:
                token = token.replace(ch, "")
            if token:
                tokens.append(token)
    return tokens


# ---------------------------------------------------------------- 造数


def build_case(name: str, spec: dict) -> dict:
    rng = np.random.default_rng(spec["seed"])
    tokens = tokenize_sentences(spec["sentences"])
    n_tokens = len(tokens)

    # 输入表示（已经查表并叠加位置编码之后的向量 —— 由 embeddings.csv 直接给出）
    x = np.round(rng.normal(0.0, 0.8, size=(n_tokens, D_MODEL)), 3)
    # 三副"眼镜"的权重（写死在 params.json 里）
    w_q = np.round(rng.normal(0.0, 0.5, size=(D_MODEL, D_HEAD)), 3)
    w_k = np.round(rng.normal(0.0, 0.5, size=(D_MODEL, D_HEAD)), 3)
    w_v = np.round(rng.normal(0.0, 0.5, size=(D_MODEL, D_HEAD)), 3)

    return {
        "name": name,
        "tokens": tokens,
        "sentences": spec["sentences"],
        "x": x,
        "w_q": w_q,
        "w_k": w_k,
        "w_v": w_v,
        "vocab": spec["vocab"],
        "logits": spec["logits"],
    }


# ---------------------------------------------------------------- 标定（打印两端数值）


def softmax(mat: np.ndarray) -> np.ndarray:
    shifted = mat - mat.max(axis=-1, keepdims=True)
    exp = np.exp(shifted)
    return exp / exp.sum(axis=-1, keepdims=True)


def causal_mask(mat: np.ndarray) -> np.ndarray:
    n = mat.shape[0]
    return np.where(np.tril(np.ones((n, n), dtype=bool)), mat, -np.inf)


def score_variants(case: dict) -> list[dict]:
    """本实验的三档消融 —— 打印出来是为了标定「差异够不够明显」。"""
    x, w_q, w_k = case["x"], case["w_q"], case["w_k"]
    q, k = x @ w_q, x @ w_k  # V 只在 O = A·V 那一步用到，标定阶段不需要
    raw = q @ k.T

    variants = {
        "full": causal_mask(raw / math.sqrt(D_HEAD)),
        "no_scale": causal_mask(raw),
        "no_mask": raw / math.sqrt(D_HEAD),
    }
    rows = []
    for variant, scores in variants.items():
        attn = softmax(scores)
        max_row_weight = float(attn.max(axis=-1).mean())
        entropy = float((-(attn * np.log(attn + 1e-12)).sum(axis=-1)).mean())
        n = attn.shape[0]
        future = float(attn[np.triu(np.ones((n, n), dtype=bool), 1)].sum() / n)
        rows.append(
            {
                "variant": variant,
                "raw_score_sd": round(float(raw.std()), 3),
                "max_row_weight": round(max_row_weight, 4),
                "entropy": round(entropy, 4),
                "mean_future_weight": round(future, 4),
            }
        )
    return rows


def sampling_rows(case: dict, n_samples: int = 200, seed: int = 4100) -> list[dict]:
    logits = np.array(case["logits"], dtype=float)
    rows = []
    for scale in (0.5, 1.0, 2.0):
        probs = softmax((logits / scale).reshape(1, -1))[0]
        order = probs.argsort(kind="stable")[::-1]
        top1 = int(order[0])
        rng = random.Random(seed)
        hits = 0
        for _ in range(n_samples):
            u = rng.random()
            cum = 0.0
            pick = len(probs) - 1
            for i, p in enumerate(probs):
                cum += float(p)
                if u < cum:
                    pick = i
                    break
            if pick == top1:
                hits += 1
        rows.append(
            {
                "scale": scale,
                "top1_prob": round(float(probs[top1]), 4),
                "entropy": round(float(-(probs * np.log(probs)).sum()), 4),
                "top1_ratio": round(hits / n_samples, 4),
            }
        )
    return rows


# ---------------------------------------------------------------- 落盘


def write_embeddings(path: Path, case: dict) -> None:
    header = ["pos", "token"] + [f"dim_{i}" for i in range(D_MODEL)]
    with path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(header)
        for pos, (token, row) in enumerate(zip(case["tokens"], case["x"])):
            writer.writerow([pos, token] + [f"{value:.3f}" for value in row])


def write_sentences(path: Path, case: dict) -> None:
    with path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(["sent_id", "text"])
        for i, text in enumerate(case["sentences"], start=1):
            writer.writerow([f"S{i:02d}", text])


def write_params(path: Path, case: dict) -> None:
    def mat(values: np.ndarray) -> list[list[str]]:
        return [[f"{v:.3f}" for v in row] for row in values]

    params = {
        "d_model": D_MODEL,
        "d_head": D_HEAD,
        "scale_divisor": round(math.sqrt(D_HEAD), 4),
        "W_q": mat(case["w_q"]),
        "W_k": mat(case["w_k"]),
        "W_v": mat(case["w_v"]),
        "sampling": {
            "n_samples": 200,
            "rng_seed": 4100,
            "scales": [0.5, 1.0, 2.0],
            "vocab": case["vocab"],
            "logits": [f"{v:.2f}" for v in case["logits"]],
        },
    }
    path.write_text(json.dumps(params, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--print", action="store_true", dest="only_print")
    args = ap.parse_args()

    for name, spec in CASES.items():
        case = build_case(name, spec)
        stats = {
            "case": name,
            "n_tokens": len(case["tokens"]),
            "n_sentences": len(case["sentences"]),
            "vocab_size": len(case["vocab"]),
        }
        print(f"\n=== {name} ===")
        print(f"tokens({stats['n_tokens']}): {' '.join(case['tokens'])}")
        print(f"vocab_size={stats['vocab_size']}  d_model={D_MODEL}  d_head={D_HEAD}")
        for row in score_variants(case):
            print(
                f"  ablation {row['variant']:9s} raw_sd={row['raw_score_sd']:.3f} "
                f"max_row_weight={row['max_row_weight']:.4f} entropy={row['entropy']:.4f} "
                f"future={row['mean_future_weight']:.4f}"
            )
        for row in sampling_rows(case):
            print(
                f"  scale={row['scale']:.1f} top1_prob={row['top1_prob']:.4f} "
                f"entropy={row['entropy']:.4f} top1_ratio={row['top1_ratio']:.4f}"
            )

        if args.only_print:
            continue
        case_dir = CASES_DIR / name
        case_dir.mkdir(parents=True, exist_ok=True)
        write_sentences(case_dir / "sentences.csv", case)
        write_embeddings(case_dir / "embeddings.csv", case)
        write_params(case_dir / "params.json", case)
        print(f"  → {case_dir}")


if __name__ == "__main__":
    main()
