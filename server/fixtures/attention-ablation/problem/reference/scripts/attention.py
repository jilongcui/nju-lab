#!/usr/bin/env python3
"""第 4 章（大语言模型原理）参考实现：用 numpy 手写缩放点积注意力 + 三档消融 + 采样。

📖 这份实现**随题目包一起下发**（`problem/reference/`）—— 先读懂它，再写你自己的。
   **它不是唯一正确答案**：代码怎么组织随你；判据只看"口径一致 + 消融方向对 + 说得清机制"。

它把本章的两个论断落成了可量的东西：

- **注意力 = 软对齐**（`attention` 段）：每个 token 造一副查询（Q）、一副钥匙（K）、一份内容（V），
  用 `softmax(QKᵀ/√d)·V` 把"它该看谁"变成一组**和为 1 的权重**；因果掩码保证第 i 个位置
  只能看 1..i（不许偷看未来）；
- **缩放与掩码各解决什么**（`ablation` 段）：同一组输入跑三遍 —— 完整版 / 去掉 √d 缩放 /
  去掉因果掩码 —— 用**最大行权重**与**行熵**两个数把差别量出来：
  去掉缩放 → logits 被放大 → softmax 更尖 → 权重更集中、熵更低（梯度更容易消失）；
  去掉掩码 → 每个位置会去"看未来" → 未来位置的权重不再为 0（训练时等于提前看答案）；
- **预测下一个 token**（`sampling` 段）：把 logits 除以不同的**锐化系数**再 softmax，
  看 top-1 概率、分布熵与实际采样 200 次的 `top1_ratio` 怎么变 —— 越小越"自信"，越大越"发散"。

流程（与 task.md 的六步一致）：

  ① 看清需求      —— 要复现的机制是"注意力怎么分配权重"，要说清它解决什么问题
  ② 看懂口径      —— 切 token、缩放因子、掩码方向、校验和格式、采样顺序**都不许改**
  ③ 算注意力      —— Q/K/V → scores → 缩放 → 掩码 → softmax → 权重矩阵
  ④ 消融对照      —— 三档各算 max_row_weight / entropy / mean_future_weight
  ⑤ 采样与画图    —— 不同锐化系数下的 top-1 概率与实测 top1_ratio，两张图
  ⑥ 写结论        —— `notes` 讲清 √d 与掩码各自解决什么、Q/K/V 为什么要拆三副"眼镜"

用法：

  python3 scripts/attention.py <case目录> <output.json>    # 单个 case（图写到当前目录的 figures/）
  python3 scripts/attention.py --regen-expected            # 重算 problem/cases/*/expected.json

请在**与复验同一个镜像内**生成 expected（当前 pkg6）：

  docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/w" --entrypoint python3 \
    nju-lab-verify:0.2.0-rc.2-pkg6 /w/problem/reference/scripts/attention.py --regen-expected
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import random
import tempfile
from collections import Counter
from pathlib import Path

import matplotlib

matplotlib.use("Agg")  # 容器内无显示环境
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

HERE = Path(__file__).resolve().parent
CASES_DIR = HERE.parent.parent / "cases"
FIG_DIR = Path("figures")
FIG_ABLATION = "ablation_shift.png"
FIG_SAMPLING = "sampling_shift.png"

PUNCT = ".,;:!?"  # 口径写死在 task.md
VARIANTS = ("full", "no_scale", "no_mask")
SAMPLE_PREVIEW = 5  # 报告里附带每次采样的前 5 个结果（口径钉死，可逐项比对）


# ---------- ② 口径：切 token ----------


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


# ---------- ③ 算注意力 ----------


def load_case(case_dir: Path) -> tuple[list[str], np.ndarray, dict]:
    with (case_dir / "sentences.csv").open(encoding="utf-8", newline="") as fh:
        sentences = [dict(r)["text"] for r in csv.DictReader(fh)]
    tokens = tokenize(sentences)

    with (case_dir / "embeddings.csv").open(encoding="utf-8", newline="") as fh:
        rows = [dict(r) for r in csv.DictReader(fh)]
    dims = sorted((k for k in rows[0] if k.startswith("dim_")), key=lambda k: int(k.split("_")[1]))
    # 输入表示按 `pos` 升序排列；同时核对 embeddings.csv 与切 token 的结果是否对得上
    rows.sort(key=lambda r: int(r["pos"]))
    if [r["token"] for r in rows] != tokens:
        raise SystemExit("embeddings.csv 的 token 列与 sentences.csv 切出来的 token 序列不一致")
    x = np.array([[float(r[d]) for d in dims] for r in rows], dtype=float)

    params = json.loads((case_dir / "params.json").read_text(encoding="utf-8"))
    return tokens, x, params


def softmax(mat: np.ndarray) -> np.ndarray:
    """数值稳定版 softmax（逐行减最大值）；`-inf`（掩码位）出来就是 0。"""
    shifted = mat - mat.max(axis=-1, keepdims=True)
    exp = np.exp(shifted)
    return exp / exp.sum(axis=-1, keepdims=True)


def causal_mask(mat: np.ndarray) -> np.ndarray:
    """因果掩码：把 `j > i`（上三角，不含对角线）的位置置为 `-inf`（第 i 个位置不许看未来）。"""
    n = mat.shape[0]
    return np.where(np.tril(np.ones((n, n), dtype=bool)), mat, -np.inf)


def attention_matrices(x: np.ndarray, params: dict, scaled: bool = True, masked: bool = True) -> np.ndarray:
    """三档消融共用一套实现：`scaled` 决定要不要除以 √d_head，`masked` 决定要不要加因果掩码。"""
    w_q = np.array([[float(v) for v in row] for row in params["W_q"]], dtype=float)
    w_k = np.array([[float(v) for v in row] for row in params["W_k"]], dtype=float)
    w_v = np.array([[float(v) for v in row] for row in params["W_v"]], dtype=float)

    q, k, v = x @ w_q, x @ w_k, x @ w_v
    scores = q @ k.T
    if scaled:
        scores = scores / math.sqrt(params["d_head"])
    if masked:
        scores = causal_mask(scores)
    return softmax(scores) @ v  # O = A · V（本实验只需要 O 的形状与注意力权重本身）


def attention_weights(x: np.ndarray, params: dict, scaled: bool = True, masked: bool = True) -> np.ndarray:
    w_q = np.array([[float(v) for v in row] for row in params["W_q"]], dtype=float)
    w_k = np.array([[float(v) for v in row] for row in params["W_k"]], dtype=float)

    scores = (x @ w_q) @ (x @ w_k).T
    if scaled:
        scores = scores / math.sqrt(params["d_head"])
    if masked:
        scores = causal_mask(scores)
    return softmax(scores)


def attn_checksum(attn: np.ndarray) -> str:
    """口径写死在 task.md：注意力矩阵逐行展开，每个元素 `f"{v:.4f}"` 格式化，
    行内 `,` 连接、行间 `\\n`、末尾不加换行，UTF-8 → sha256 十六进制**前 12 位**。"""
    lines = [",".join(f"{value:.4f}" for value in row) for row in attn]
    return hashlib.sha256("\n".join(lines).encode("utf-8")).hexdigest()[:12]


def row_entropy(attn: np.ndarray) -> float:
    """每行熵（自然对数）的平均；熵越高说明"注意力越分散"。"""
    return float((-(attn * np.log(attn + 1e-12)).sum(axis=-1)).mean())


# ---------- ④ 消融对照 ----------


def run_ablation(x: np.ndarray, params: dict) -> list[dict]:
    rows = []
    for variant in VARIANTS:
        attn = attention_weights(
            x, params, scaled=variant != "no_scale", masked=variant != "no_mask"
        )
        n = attn.shape[0]
        future = attn[np.triu(np.ones((n, n), dtype=bool), 1)]
        rows.append(
            {
                "variant": variant,
                "max_row_weight": round(float(attn.max(axis=-1).mean()), 4),
                "entropy": round(row_entropy(attn), 4),
                "mean_future_weight": round(float(future.sum() / n), 4),
            }
        )
    return rows


# ---------- ⑤ 采样（预测下一个 token） ----------


def sample_next_token(probs: np.ndarray, n_samples: int, seed: int) -> list[int]:
    """口径写死在 task.md：`random.Random(seed)` 每次取一个 `u = rng.random()`，
    按 **vocab 顺序**累加概率，取第一个使 `累加值 > u` 的下标（逆变换采样）。"""
    rng = random.Random(seed)
    picks: list[int] = []
    for _ in range(n_samples):
        u = rng.random()
        cumulative = 0.0
        picked = len(probs) - 1
        for i, p in enumerate(probs):
            cumulative += float(p)
            if u < cumulative:
                picked = i
                break
        picks.append(picked)
    return picks


def run_sampling(params: dict) -> dict:
    spec = params["sampling"]
    vocab = list(spec["vocab"])
    logits = np.array([float(v) for v in spec["logits"]], dtype=float)
    n_samples = int(spec["n_samples"])
    seed = int(spec["rng_seed"])
    base_probs = softmax((logits / 1.0).reshape(1, -1))[0]
    base_top1 = int(np.argmax(base_probs))

    scales = []
    for scale in spec["scales"]:
        probs = softmax((logits / float(scale)).reshape(1, -1))[0]
        top1 = int(np.argmax(probs))
        picks = sample_next_token(probs, n_samples, seed)
        hits = sum(1 for p in picks if p == top1)
        scales.append(
            {
                "scale": float(scale),
                "top1_token": vocab[top1],
                "top1_prob": round(float(probs[top1]), 4),
                "entropy": round(float(-(probs * np.log(probs + 1e-12)).sum()), 4),
                "top1_ratio": round(hits / n_samples, 4),
                # 前 5 个采样结果（口径钉死 → 可逐项比对：采样顺序或累加方式错了就对不上）
                "samples": [vocab[i] for i in picks[:SAMPLE_PREVIEW]],
            }
        )
    return {
        "n_samples": n_samples,
        "top1_token": vocab[base_top1],
        "top1_prob": round(float(base_probs[base_top1]), 4),
        "entropy": round(float(-(base_probs * np.log(base_probs + 1e-12)).sum()), 4),
        "scales": scales,
    }


# ---------- ⑤ 画图 ----------


def plot_ablation(ablation: list[dict], fig_root: Path) -> dict:
    fig_dir = fig_root / FIG_DIR
    fig_dir.mkdir(parents=True, exist_ok=True)
    names = [row["variant"] for row in ablation]
    x = range(len(names))
    width = 0.38
    weights = [row["max_row_weight"] for row in ablation]
    entropies = [row["entropy"] for row in ablation]

    fig, ax = plt.subplots(figsize=(6.6, 4.2))
    ax.bar([i - width / 2 for i in x], weights, width, label="mean max attention weight", color="#1565c0")
    ax.bar([i + width / 2 for i in x], entropies, width, label="mean row entropy", color="#ef6c00")
    ax.set_xticks(list(x))
    ax.set_xticklabels(names)
    ax.set_ylabel("value (weights are 0-1)")
    ax.set_title("Attention sharpness: full vs ablated variants")
    ax.legend(loc="upper left", fontsize=8)
    fig.tight_layout()
    fig.savefig(fig_dir / FIG_ABLATION, dpi=110)
    plt.close(fig)

    by_name = {row["variant"]: row for row in ablation}
    takeaway = (
        "去掉 √d 缩放后，最大行权重从 "
        f"{by_name['full']['max_row_weight']:.3f} 升到 {by_name['no_scale']['max_row_weight']:.3f}、"
        f"行熵从 {by_name['full']['entropy']:.3f} 降到 {by_name['no_scale']['entropy']:.3f} —— "
        "缩放让 softmax 不至于饱和；去掉因果掩码后行熵升到 "
        f"{by_name['no_mask']['entropy']:.3f}（每个位置多看了一些词，权重被摊薄）。"
    )
    return {"path": f"{FIG_DIR}/{FIG_ABLATION}", "takeaway": takeaway}


def plot_sampling(sampling: dict, fig_root: Path) -> dict:
    fig_dir = fig_root / FIG_DIR
    fig_dir.mkdir(parents=True, exist_ok=True)
    scales = sampling["scales"]
    labels = [f"{row['scale']:g}" for row in scales]
    x = range(len(scales))
    width = 0.38

    fig, ax = plt.subplots(figsize=(6.6, 4.2))
    ax.bar([i - width / 2 for i in x], [row["top1_prob"] for row in scales], width,
           label="top-1 probability", color="#2e7d32")
    ax.bar([i + width / 2 for i in x], [row["top1_ratio"] for row in scales], width,
           label="top-1 share of 200 samples", color="#6a1b9a")
    ax.set_xticks(list(x))
    ax.set_xticklabels(labels)
    ax.set_xlabel("sharpening divisor applied to logits")
    ax.set_ylabel("value (0-1)")
    ax.set_ylim(0, 1.05)
    ax.set_title("Next-token prediction under different divisors")
    ax.legend(loc="upper right", fontsize=8)
    fig.tight_layout()
    fig.savefig(fig_dir / FIG_SAMPLING, dpi=110)
    plt.close(fig)

    takeaway = (
        "锐化系数越小分布越尖："
        + "；".join(f"{row['scale']:g} → top-1 概率 {row['top1_prob']:.3f}、采样命中 {row['top1_ratio']:.3f}" for row in scales)
        + f"；采样 200 次的 top1 占比始终贴近 top-1 概率，说明采样分布就是这组概率本身。"
    )
    return {"path": f"{FIG_DIR}/{FIG_SAMPLING}", "takeaway": takeaway}


# ---------- ⑥ 结论 ----------


def compose_notes(tokens: dict, attention: dict, ablation: list[dict], sampling: dict) -> str:
    by_name = {row["variant"]: row for row in ablation}
    full, no_scale, no_mask = by_name["full"], by_name["no_scale"], by_name["no_mask"]
    return (
        f"口径与做法：把 {tokens['n_tokens']} 个 token 的输入表示（embeddings.csv，已含位置编码的信息）"
        "分别乘三组写死的权重，得到 Q（我在找什么）、K（我是什么被找的）、V（我实际交出的内容）三套向量；"
        "注意力权重 = softmax(QKᵀ/√d_head)，先缩放、再上因果掩码（第 i 个位置只许看 1..i），最后 O = A·V。"
        f"完整版的行和恒为 1、掩码位恒为 0（校验和 {attention['attn_checksum']}，形状 {attention['shape']}）。"
        f"√d_head 缩放解决「分数被维度放大」的问题：去掉它以后最大行权重从 {full['max_row_weight']} 涨到 "
        f"{no_scale['max_row_weight']}、行熵从 {full['entropy']} 掉到 {no_scale['entropy']} —— 分布饱和成"
        "近似 one-hot，梯度几乎传不回来（这就是「除以 √d」要防的事）。因果掩码解决「不许看未来」的问题："
        f"去掉后平均未来权重从 0 变成 {no_mask['mean_future_weight']}，等于训练时提前看到了答案；"
        "它同时让解码可以逐 token 增量进行。为什么非要拆成 Q/K/V 三副眼镜？因为「我要找什么」和"
        "「我是什么」必须能用不同的方式表达：同一个 V（内容）在不同提问下该配不同的权重，"
        "而 Q·K 只负责算「像不像」、不碰内容本身 —— 这与 LSTM 用门控「决定记住多少」是同一个思想的扩编，"
        "只是把「一个标量门」换成了「对全序列的权重分布」。采样段（本实验的可选延伸）：把同一组 logits 除以 "
        f"不同的锐化系数再 softmax，top-1 概率从 {sampling['scales'][0]['top1_prob']} 变到 "
        f"{sampling['scales'][-1]['top1_prob']}，采样 200 次的 top1_ratio 也从 "
        f"{sampling['scales'][0]['top1_ratio']} 掉到 {sampling['scales'][-1]['top1_ratio']} —— 系数越大分布越平、"
        "越容易「抽到别的词」。局限：本例只用了单个头、写死的权重与写死的输入（没有真的训练、没有多层堆叠），"
        "所以它证明的是「机制怎么算」，不是「模型学到了什么」；注意力权重也只能说明「模型看了哪里」，"
        "不等于「模型为什么这样回答」（这正是幻觉难以追溯的根源之一）。"
    )


# ---------- 单 case ----------


def run_case(case_dir: Path, fig_root: Path | None = None) -> tuple[dict, dict]:
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
    figures = [plot_ablation(ablation, fig_root), plot_sampling(sampling, fig_root)]

    out = {
        "tokens": out_tokens,
        "attention": attention,
        "ablation": ablation,
        "sampling": sampling,
        "figures": figures,
        "notes": compose_notes(out_tokens, attention, ablation, sampling),
    }
    expected = {
        "note": (
            "参考水平（不是标准答案）：切 token、缩放因子、掩码方向、校验和格式、采样顺序都已在 task.md 里钉死，"
            "所以 top_terms、attn_checksum、top_attend、三档消融数值与各系数下的 top1_ratio 都是确定的 —— "
            "用于核对学生的口径，以及「消融的方向性」是否真的成立。硬性判据见 manifest.json 的 assertions，"
            "语义判据见 judge.md。"
        ),
        "tokens": out_tokens,
        "attention": {
            "shape": attention["shape"],
            "masked_upper_is_zero": attention["masked_upper_is_zero"],
            "top_attend": attention["top_attend"],
            "attn_checksum": attention["attn_checksum"],
        },
        "ablation": ablation,
        "sampling": {
            "top1_token": sampling["top1_token"],
            "top1_prob": sampling["top1_prob"],
            "entropy": sampling["entropy"],
            "scales": [
                {k: row[k] for k in ("scale", "top1_token", "top1_prob", "entropy", "top1_ratio", "samples")}
                for row in sampling["scales"]
            ],
        },
    }
    return out, expected


def run_case_to_file(case_dir: Path, out_path: Path) -> None:
    out, _ = run_case(case_dir, Path("."))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[ok] {case_dir.name} → {out_path}")


def regen_expected() -> None:
    for case_dir in sorted(p for p in CASES_DIR.iterdir() if p.is_dir()):
        with tempfile.TemporaryDirectory() as tmp:
            _, expected = run_case(case_dir, Path(tmp))
        path = case_dir / "expected.json"
        path.write_text(json.dumps(expected, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"[regen] {path}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("case_dir", nargs="?")
    ap.add_argument("out_path", nargs="?")
    ap.add_argument("--regen-expected", action="store_true")
    args = ap.parse_args()

    if args.regen_expected:
        regen_expected()
        return
    if not args.case_dir or not args.out_path:
        ap.error("需要 <case目录> <output.json>，或用 --regen-expected")
    run_case_to_file(Path(args.case_dir), Path(args.out_path))


if __name__ == "__main__":
    main()
