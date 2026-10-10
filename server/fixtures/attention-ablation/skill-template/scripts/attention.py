#!/usr/bin/env python3
"""第 4 章（大语言模型原理）的**起点骨架**：把你的实现写在标了 TODO 的地方。

结构已经搭好，与 `problem/reference/scripts/attention.py` 的函数划分**完全一致** ——
先跑通参考实现、读懂它的输出，再回来把自己的 TODO 填掉。

要填的五处：
  ① `causal_mask` / `attention_weights` —— 缩放、掩码、softmax 的正确组合
  ② `attn_checksum` / `top_attend`     —— 两个"口径钉死"的可比字段
  ③ `run_ablation`                     —— 三档消融与三个统计量（含"看到未来"的量）
  ④ `sample_next_token` / `run_sampling` —— 锐化系数、逆变换采样、top1_ratio
  ⑤ `plot_ablation` / `plot_sampling` / `compose_notes` —— 两张图与结论

已经给出的部分（最小示例）：读三份输入文件并对齐 `pos`、切 token、`softmax`（数值稳定写法）、
以及 `output.json` 的整体组装与命令行入口。

用法：
  python3 scripts/attention.py <case目录> <output.json>   # 单个 case（图写到当前目录的 figures/）
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import random
from collections import Counter
from pathlib import Path

import matplotlib

matplotlib.use("Agg")  # 容器内无显示环境
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

HERE = Path(__file__).resolve().parent
CASES_DIR = HERE.parent.parent / "problem" / "cases"
FIG_DIR = Path("figures")
FIG_ABLATION = "ablation_shift.png"
FIG_SAMPLING = "sampling_shift.png"

PUNCT = ".,;:!?"  # 口径写死在 task.md
VARIANTS = ("full", "no_scale", "no_mask")
SAMPLE_PREVIEW = 5


# ---------------------------------------------------------------- 已给出：切 token 与读数据


def tokenize(sentences: list[str]) -> list[str]:
    """口径：按空白切分 → 去掉 `.,;:!?` → 丢掉空片段；**大小写保持原样**。"""
    tokens: list[str] = []
    for text in sentences:
        for raw in text.split():
            token = raw
            for ch in PUNCT:
                token = token.replace(ch, "")
            if token:
                tokens.append(token)
    return tokens


def top_terms(tokens: list[str], k: int = 3) -> list[str]:
    """口径：出现次数降序；次数相同按 token 的字符串升序（ASCII）；取前 k 个。"""
    counts = Counter(tokens)
    return [t for t, _ in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:k]]


def load_case(case_dir: Path) -> tuple[list[str], np.ndarray, dict]:
    """读 sentences.csv / embeddings.csv / params.json，并核对两边的 token 序列是否逐位一致。"""
    with (case_dir / "sentences.csv").open(encoding="utf-8", newline="") as fh:
        sentences = [dict(r)["text"] for r in csv.DictReader(fh)]
    tokens = tokenize(sentences)

    with (case_dir / "embeddings.csv").open(encoding="utf-8", newline="") as fh:
        rows = [dict(r) for r in csv.DictReader(fh)]
    dims = sorted((k for k in rows[0] if k.startswith("dim_")), key=lambda k: int(k.split("_")[1]))
    rows.sort(key=lambda r: int(r["pos"]))
    if [r["token"] for r in rows] != tokens:
        raise SystemExit("embeddings.csv 的 token 列与 sentences.csv 切出来的 token 序列不一致")
    x = np.array([[float(r[d]) for d in dims] for r in rows], dtype=float)

    params = json.loads((case_dir / "params.json").read_text(encoding="utf-8"))
    return tokens, x, params


def softmax(mat: np.ndarray) -> np.ndarray:
    """已给出的数值稳定版 softmax（逐行减最大值再取 exp、归一化）：`-inf` 掩码位出来就是 0。"""
    shifted = mat - mat.max(axis=-1, keepdims=True)
    exp = np.exp(shifted)
    return exp / exp.sum(axis=-1, keepdims=True)


# ---------------------------------------------------------------- ① TODO：缩放 + 掩码


def causal_mask(mat: np.ndarray) -> np.ndarray:
    """TODO：因果掩码 —— 把 `j > i`（上三角，**不含对角线**）的位置置为 `-inf`。

    提示：`np.tril` / `np.triu`，或自己写双重循环；注意第 i 个位置**必须**能看到自己（对角线保留）。
    """
    raise NotImplementedError("TODO ①：因果掩码")


def attention_weights(x: np.ndarray, params: dict, scaled: bool = True, masked: bool = True) -> np.ndarray:
    """TODO：返回注意力权重矩阵 `A`（n×n）。三档消融共用这一个函数：

      1. `Q = X·W_q`、`K = X·W_k`（V 在 O = A·V 那步才用得上）；`scores = Q·Kᵀ`
      2. `scaled=True` 时除以 `math.sqrt(params["d_head"])`
      3. `masked=True` 时套 `causal_mask`
      4. 逐行 softmax
    """
    raise NotImplementedError("TODO ①：注意力权重")


# ---------------------------------------------------------------- ② TODO：两个可比字段


def attn_checksum(attn: np.ndarray) -> str:
    """TODO：口径见 task.md —— 行内 `,`、行间 `\\n`、末尾不加换行、`f"{v:.4f}"`，取 sha256 前 12 位。"""
    raise NotImplementedError("TODO ②：校验和")


def row_entropy(attn: np.ndarray) -> float:
    """已给出：每行熵（自然对数）的平均。`+1e-12` 是防止 log(0)。"""
    return float((-(attn * np.log(attn + 1e-12)).sum(axis=-1)).mean())


# ---------------------------------------------------------------- ③ TODO：三档消融


def run_ablation(x: np.ndarray, params: dict) -> list[dict]:
    """TODO：按 `VARIANTS`（full / no_scale / no_mask）各跑一遍，报三个统计量：

      - `max_row_weight` = 每行最大权重的平均（4 位小数）
      - `entropy`        = 每行熵的平均（4 位小数，用 `row_entropy`）
      - `mean_future_weight` = 每行 `j > i` 位置的权重之和，再对行取平均（4 位小数）

    提示：`np.triu(..., 1)` 取的是"严格上三角"（不含对角线）的掩码。
    """
    raise NotImplementedError("TODO ③：消融对照")


# ---------------------------------------------------------------- ④ TODO：采样


def sample_next_token(probs: np.ndarray, n_samples: int, seed: int) -> list[int]:
    """TODO：逆变换采样 —— `random.Random(seed)`，每次取 `u = rng.random()`，
    按 `probs` 的顺序累加，取第一个使「累加值 > u」的下标（都不满足则取最后一个）。返回下标列表。"""
    raise NotImplementedError("TODO ④：逆变换采样")


def run_sampling(params: dict) -> dict:
    """TODO：读 `params["sampling"]`，对每个锐化系数算 `probs = softmax(logits / s)`，报：

      - `scale` / `top1_token` / `top1_prob`（4 位小数）/ `entropy`（4 位小数）
      - `top1_ratio` = 采样 200 次里命中 top-1 的比例（4 位小数）
      - `samples` = 前 5 个采样结果（token 字符串）

    另外报一组**基础分布**（不除系数）：`n_samples` / `top1_token` / `top1_prob` / `entropy`。
    注意：三个锐化系数各自从同一个种子**重新开始**（共用同一串 `u`）。
    """
    raise NotImplementedError("TODO ④：采样与统计")


# ---------------------------------------------------------------- ⑤ TODO：图与结论


def plot_ablation(ablation: list[dict], fig_root: Path) -> dict:
    """TODO：画消融对照图（存 `figures/ablation_shift.png`），返回 `{"path", "takeaway"}`。

    提示：两张柱（`max_row_weight` 与 `entropy`）× 三个变体；标题与轴标签用**英文**；
    `takeaway` 里的数字要**直接从 `ablation` 取**（别另写公式），并与它自洽。
    """
    raise NotImplementedError("TODO ⑤：消融图")


def plot_sampling(sampling: dict, fig_root: Path) -> dict:
    """TODO：画采样对照图（存 `figures/sampling_shift.png`），返回 `{"path", "takeaway"}`。

    提示：每个锐化系数两根柱（`top1_prob` 与 `top1_ratio`）；轴标签用英文。
    """
    raise NotImplementedError("TODO ⑤：采样图")


def compose_notes(tokens: dict, attention: dict, ablation: list[dict], sampling: dict) -> str:
    """TODO：写 ≥60 字的结论。要点（见 task.md 与 judge.md）：

      - `√d` 缩放**解决什么**（数值量级 / softmax 会不会饱和 / 梯度）
      - 因果掩码**解决什么**（不许看未来；解码要能逐步进行）
      - `Q`/`K`/`V` **为什么拆三副"眼镜"**（谁负责"像不像"、谁搬运内容）
      - 这套复现的**局限**（写死的权重、单头、注意力权重 ≠ 因果解释……）
    """
    raise NotImplementedError("TODO ⑤：结论")


# ---------------------------------------------------------------- 已给出：组装与入口


def run_case(case_dir: Path, fig_root: Path | None = None) -> dict:
    tokens, x, params = load_case(case_dir)
    fig_root = fig_root or Path(".")

    attn = attention_weights(x, params)
    out_tokens = {
        "n_tokens": len(tokens),
        "n_unique_tokens": len(set(tokens)),
        "top_terms": top_terms(tokens),
    }
    attention = {
        "shape": [int(attn.shape[0]), params["d_head"]],
        "row_sums": [round(float(s), 8) for s in attn.sum(axis=-1)],
        "masked_upper_is_zero": bool(np.allclose(attn[np.triu(np.ones(attn.shape, dtype=bool), 1)], 0.0)),
        "top_attend": [int(i) for i in np.argmax(attn, axis=-1)],
        "attn_checksum": attn_checksum(attn),
    }
    ablation = run_ablation(x, params)
    sampling = run_sampling(params)
    return {
        "tokens": out_tokens,
        "attention": attention,
        "ablation": ablation,
        "sampling": sampling,
        "figures": [plot_ablation(ablation, fig_root), plot_sampling(sampling, fig_root)],
        "notes": compose_notes(out_tokens, attention, ablation, sampling),
    }


def run_case_to_file(case_dir: Path, out_path: Path) -> None:
    out = run_case(case_dir, Path("."))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[ok] {case_dir.name} → {out_path}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("case_dir", nargs="?")
    ap.add_argument("out_path", nargs="?")
    args = ap.parse_args()
    if not args.case_dir or not args.out_path:
        ap.error("需要 <case目录> <output.json>")
    run_case_to_file(Path(args.case_dir), Path(args.out_path))


if __name__ == "__main__":
    main()
