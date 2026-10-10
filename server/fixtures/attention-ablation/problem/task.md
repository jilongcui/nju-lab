# 应用任务：把"注意力"从一个名词变成一组能算、能解释的权重

## 业务背景

第 4 章讲了 Transformer 的核心：**注意力**。它给出三步 —— `softmax(QKᵀ/√d)·V` —— 并留了两句论断：

> **"为什么非要拆成 QKV"**：`Q·K` 只算"像不像"，`V` 才搬运内容；
> **"√d 缩放与因果掩码各解决什么问题"**：一个管数值，一个管时序。

读一遍公式很容易，**难的是把这两句话变成可量化的现象**。本实验就做这件事：给你一组**写死的输入**
（一小段虚构医学记录的 token 化结果 + 每个 token 的输入表示 + 三组权重的数值），你用 `numpy` 手写一遍
注意力，然后**故意做两次"阉割"**，看数值怎么变：

- 去掉 `√d` 缩放 → softmax 会不会饱和？
- 去掉因果掩码 → 每个位置会不会"看到未来"？

最后再做一段延伸：把一组 logits 当作"下一个 token 的分数"，看**换一个锐化系数**（把 logits 除以一个
系数再 softmax）时，top-1 概率与**实际采样 200 次命中的比例**怎么变。

> 这一章不要求你训练任何模型 —— 权重是给定的、输入是给定的。你要交付的是**一套算得对、解释得清的机制复现**：
> 数字要经得起"谁算都一样"的检验，解释要落到机制上。

## 你的任务

用工作目录里的 `sentences.csv` / `embeddings.csv` / `params.json` 产出 `output.json` 与两张图。具体要求：

1. **按钉死口径切 token**：从 `sentences.csv` 切出 token 序列，报出规模与出现最多的 3 个 token；
2. **手写缩放点积注意力**：按口径算 Q/K/V → 缩放 → 因果掩码 → softmax → 权重矩阵，报形状、每行权重和、
   掩码是否真的生效、**每行最关注哪个位置**、以及一个**逐字节可比的校验和**；
3. **三档消融对照（本实验的教学核心）**：同一组输入跑三遍，每遍报 `max_row_weight` / `entropy` /
   `mean_future_weight` —— 让"缩放与掩码各解决什么"变成**可量的差距**；
4. **预测下一个 token 的分布与采样**：按口径算基础分布的 top-1 概率与熵，再对每个锐化系数算
   top-1 概率、熵、以及采样 200 次命中 top-1 的比例；
5. **画两张图**（消融对照、采样对照），每张配一句"看图说话"的结论；
6. **写清机制与边界**：`notes` 要讲清 `√d` 与掩码**各自**解决什么、`Q/K/V` 为什么要拆成三副"眼镜"、
   以及这套复现的局限。

> 代码怎么组织、函数怎么切都随你（`numpy` 与 `matplotlib` 都已预装）。
> 判据看的是：**口径一致（校验和/名单/数值）+ 消融方向对 + 说得清机制**。

## 实验流程（六步，每一步都要走完）

| 步 | 做什么 | 产出/落点 |
|---|---|---|
| ① **看清需求** | 注意力到底在分配什么？"缩放"与"掩码"防的是什么？ | 心里有数（写进 `notes`） |
| ② **看懂口径** | 切 token、缩放因子、掩码方向、校验和格式、采样顺序 —— **都不许改** | 心里有数 |
| ③ **算注意力** | `Q = X·W_q`、`K = X·W_k`、`V = X·W_v` → 缩放 → 掩码 → softmax | 报告的 `attention` |
| ④ **消融对照** | 完整版 / 去缩放 / 去掩码，各算三个统计量 | 报告的 `ablation` |
| ⑤ **采样与画图** | 每个锐化系数下的 top-1 概率、熵、实测 `top1_ratio`；两张图 | 报告的 `sampling` / `figures` |
| ⑥ **写结论** | 两个机制各自解决什么、Q/K/V 的分工、这套复现的局限 | 报告的 `notes` |

> 图用 `matplotlib`（已预装）画，存到工作目录的 `figures/` 下，例如
> `plt.savefig("figures/ablation_shift.png", dpi=110)`。
> ⚠️ **图上的标题与坐标轴标签必须用英文**：运行环境里没有中文字体，中文会渲染成方框。
> 中文解释写在 `figures[].takeaway` 与 `notes` 里。

## ① 切 token 口径（**钉死**，不许改）

对 `sentences.csv` 的 `text` 列，**按 `sent_id` 升序**逐句处理，把结果**按顺序拼成一个序列**：

1. 按**空白**切分；
2. 每个片段去掉 `.,;:!?` 这些字符（其它字符保留）；
3. 去掉清空后为空的片段；
4. **大小写保持原样**（不做小写化）。

- `tokens.n_tokens` = 序列长度；`tokens.n_unique_tokens` = 不同 token 的个数；
- `tokens.top_terms` = 出现次数**降序**取前 3；次数相同时按 token 的**字符串升序**（ASCII 序）。

> `embeddings.csv` 的 `pos` 列与这个序列**逐位对齐**（`pos=0` 是第一个 token）。若两者对不上，
> 说明你的切 token 口径与题目不一致。

## ② 注意力口径（**钉死**）

设 `X` 是 `embeddings.csv` 给出的输入表示（`n_tokens × d_model`，列名 `dim_0 … dim_7`），
`W_q` / `W_k` / `W_v` 是 `params.json` 里写死的三组权重（`d_model × d_head`）。计算：

```
Q = X · W_q          K = X · W_k          V = X · W_v
scores = Q · Kᵀ                                      # n_tokens × n_tokens
scores = scores / √d_head                            # √d_head = params.scale_divisor = 2.0
scores[i][j] = -inf        当 j > i                  # 因果掩码（上三角，不含对角线）
A = softmax(scores)  逐行做（每行减该行最大值后再取 exp、归一化）
O = A · V
```

- **`attention.shape`** = `[n_tokens, d_head]`（即 `O` 的形状）；
- **`attention.row_sums`** = `A` 每行的和（**保留 8 位小数**）—— 逐行 softmax 之后应当全是 1；
- **`attention.masked_upper_is_zero`** = `A` 里所有 `j > i` 的位置是否**全为 0**（布尔）；
- **`attention.top_attend`** = 每一行 `A[i]` 中**最大权重所在的列号**（从 0 开始）；
  并列时取**最小的列号**；
- **`attention.attn_checksum`**（口径钉死，逐字节可复现）：把 `A` 按行主序展开，
  每个元素按 Python 的 `f"{value:.4f}"` 格式化（四舍五入到 4 位小数），
  **同一行内用 `,` 连接、行与行之间用 `\n` 连接、末尾不加换行**；
  UTF-8 编码后取 sha256 十六进制字符串的**前 12 位**。

## ③ 消融口径（**钉死**）

同一组 `X` / 权重跑三档，每档只改一件事：

| `variant` | 缩放（除以 √d_head） | 因果掩码 |
|---|---|---|
| `full` | ✅ 要 | ✅ 要 |
| `no_scale` | ❌ 不要 | ✅ 要 |
| `no_mask` | ✅ 要 | ❌ 不要 |

`ablation` 里三档**按这个顺序**给出，每档三个统计量（都**保留 4 位小数**）：

- **`max_row_weight`** = `A` **每行最大权重的平均值**（衡量"分布有多尖"）；
- **`entropy`** = `A` **每行熵的平均**（自然对数，`-Σ p·ln p`；熵越高越分散）；
- **`mean_future_weight`** = **每行 `j > i` 位置的权重之和，再对所有行取平均**
  （掩码生效时它必须是 0；没有掩码时会 > 0 —— 这就是"看到未来"的量）。

## ④ 采样口径（**钉死**，"预测下一个 token"）

从 `params.json` 的 `sampling` 段读 `vocab`（候选 token，顺序固定）与 `logits`（与 `vocab` 等长）。
对 `sampling.scales` 里的**每一个锐化系数 s**（顺序就是 `0.5 / 1.0 / 2.0`）：

```
probs = softmax(logits / s)        # 逐元素除以 s，再 softmax（一维）
```

> "锐化系数"在本课程正文里没有出现，你只需要知道它**怎么用**：`s` 越小分布越尖、越大越平。
> 本实验把它当作一条**操作口径**，不需要涉及它的其它名字或用法。

- **`top1_token` / `top1_prob`** = `probs` 最大那一项的下标对应的 token 与它的概率；
  下标并列时取**最小下标**；`top1_prob` 保留 4 位小数；
- **`entropy`** = `-Σ p·ln p`（自然对数），保留 4 位小数；
- **`top1_ratio`** = 下面这套采样里，"抽到的下标 == top-1 下标"的次数 ÷ 200，保留 4 位小数；
- **`samples`** = 这套采样的**前 5 个结果**（token 字符串数组）。

采样口径（必须逐位一致，否则 `samples` 对不上）：

1. **每个锐化系数都从同一个种子重新开始**：`rng = random.Random(4100)`（Python 标准库 `random`）；
2. 重复 200 次：取 `u = rng.random()`，**按 `vocab` 的顺序**累加 `probs`，
   取**第一个**使「累加值 > u」的下标；若都不满足则取最后一个下标（理论上不会发生）；
3. 每个锐化系数**独立重跑**第 1~2 步（即三个系数用的是同一串 `u`）。

另外报一组**基础分布**（不除系数，等价于 `s = 1.0`）：`sampling.top1_token` / `top1_prob` / `entropy`。

## 数据字典

| 文件 | 列/键 | 含义 |
|---|---|---|
| `sentences.csv` | `sent_id` / `text` | 虚构医学记录的句子（英文，**没有真实患者**） |
| `embeddings.csv` | `pos` / `token` / `dim_0 … dim_7` | 每个 token 的输入表示（**已含位置信息**，直接给出） |
| `params.json` | `d_model` / `d_head` / `scale_divisor` | 维度与缩放因子（`√d_head`） |
| | `W_q` / `W_k` / `W_v` | 三组写死的权重（`d_model × d_head`，字符串形式的小数） |
| | `sampling.vocab` / `sampling.logits` | 候选 token 与"下一个 token"的分数 |
| | `sampling.scales` / `n_samples` / `rng_seed` | 锐化系数列表、采样次数（200）、随机种子（4100） |

> 数据是**虚构的教学数据**：句子是编的，权重是随机生成后**写死**的（小数固定 3 位），
> 所以任何人在任何机器上算出来的注意力矩阵、校验和、采样结果都**完全一样**。

## 交付格式

**`output.json`**（写在工作目录下；**键名与层级按下面的样例写**）：

```json
{
  "tokens": { "n_tokens": 31, "n_unique_tokens": 26, "top_terms": ["The", "and", "days"] },
  "attention": {
    "shape": [31, 4],
    "row_sums": [1.0, 1.0, "……共 n_tokens 个数，保留 8 位小数"],
    "masked_upper_is_zero": true,
    "top_attend": [0, 1, 0, "……共 n_tokens 个整数（每行最大权重所在的列号）"],
    "attn_checksum": "8d16d6b80dda"
  },
  "ablation": [
    { "variant": "full", "max_row_weight": 0.2761, "entropy": 2.2074, "mean_future_weight": 0.0 },
    { "variant": "no_scale", "max_row_weight": 0.4329, "entropy": 1.7238, "mean_future_weight": 0.0 },
    { "variant": "no_mask", "max_row_weight": 0.1267, "entropy": 3.1066, "mean_future_weight": 0.4725 }
  ],
  "sampling": {
    "n_samples": 200,
    "top1_token": "therapy",
    "top1_prob": 0.5489,
    "entropy": 1.208,
    "scales": [
      { "scale": 0.5, "top1_token": "therapy", "top1_prob": 0.7728, "entropy": 0.6395,
        "top1_ratio": 0.745, "samples": ["therapy", "therapy", "therapy", "therapy", "therapy"] }
    ]
  },
  "figures": [
    { "path": "figures/ablation_shift.png", "takeaway": "……（一句话结论，数字要与 ablation 自洽）" },
    { "path": "figures/sampling_shift.png", "takeaway": "……（一句话结论，数字要与 sampling 自洽）" }
  ],
  "notes": "……（≥60 字：√d 缩放解决什么、因果掩码解决什么、Q/K/V 的分工、局限）"
}
```

- `ablation` 三档**顺序固定**为 `full` → `no_scale` → `no_mask`；
- `sampling.scales` 顺序**固定**为 `0.5` → `1.0` → `2.0`（即 `params.json` 里的顺序）；
- 图至少 2 张：`path` + 一句 `takeaway`（结论要"看图说话"，并与报告字段自洽）；
- 报告里的数值**不需要**和任何人一致 —— 只要口径对，它们**本来就该相同**；口径错了就会不一样。

## 怎么算完成

1. 写一个能跑的方案（推荐做成 Skill 里的一段脚本），能对任意一份同结构的三份文件产出
   `output.json` 与两张图；
2. 在 `cases/case01` 与 `cases/case02`（两种序列长度）上都能跑通 —— 判据对两个 case 各判一次；
3. 把结论与踩过的坑写进 `SKILL.md` 的「实测档案」。

判据全文见 `judge.md`；怎么自测、包内还有什么，见 `README.md`。
