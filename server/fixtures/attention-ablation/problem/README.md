# 包内说明（大语言模型 · 注意力实验）

你拿到的题目包里有这些材料：

| 文件/目录 | 作用 |
|---|---|
| `task.md` | **题干**：业务背景、六步流程、切 token / 注意力 / 消融 / 采样四套口径、交付格式 |
| `judge.md` | 判据（哪些是硬性口径、哪些是语义判断） |
| `cases/case01`、`cases/case02` | 两种序列长度（31 个 token / 44 个 token），每个 case 有 `sentences.csv` / `embeddings.csv` / `params.json` 与 `expected.json` |
| `reference/` | **参考实现**（一份写完的方案）—— 先读后仿，不是标准答案 |
| `manifest.json` | IO 契约（`outputFile`、输入文件、断言）—— 平台复验用它 |

## 本地自测（两个 case 都要跑）

把工作目录切到某一个 case，脚本把 `output.json` 与两张图写到当前目录：

```sh
mkdir -p /tmp/attention-run && cd /tmp/attention-run

# 用参考实现跑一遍（看看"对的"长什么样）
python3 <题目包>/reference/scripts/attention.py <题目包>/cases/case01 ./output.json

# 用你自己的实现跑一遍（Skill 根下的 scripts/）
python3 <skill>/scripts/attention.py <题目包>/cases/case01 ./output.json
```

然后自己核对五件事（这就是判据的口径）：

1. **token 段**：`n_tokens` / `n_unique_tokens` / `top_terms` 与 `cases/<case>/expected.json` 相同；
2. **注意力**：`attn_checksum` 与 `top_attend` 与 `expected.json` 一致，`row_sums` 全为 1；
3. **消融**：三档的 `max_row_weight` / `entropy` 与 `expected.json` 一致（容差 1e-3），
   且**方向对**（去缩放 → 更尖、熵更低；去掩码 → `mean_future_weight` > 0）；
4. **采样**：每个锐化系数下的 `top1_prob` / `entropy` / `top1_ratio` 与 `expected.json` 一致，
   `samples`（前 5 个）逐个相同；锐化系数越大 `top1_ratio` 越低；
5. **两张图**都存在，且 `takeaway` 里的数字与报告字段自洽。

> `expected.json` 是**参考水平**不是标准答案：四套口径都钉死了，所以只要口径对，
> 这些数值本来就该相同；口径错了就会不一样 —— 它同时是你自查"我哪一步理解偏了"的镜子。

## 常见问题

| 现象 | 原因 | 怎么做 |
|---|---|---|
| `attn_checksum` 对不上 | 校验和格式与口径不同 | 行内 `,`、行间 `\n`、**末尾不加换行**、每项 `f"{v:.4f}"`（四舍五入到 4 位小数），取 sha256 前 12 位 |
| `row_sums` 不是 1 | softmax 没"逐行"做（对整矩阵做了一次） | 归一化的轴是**每一行**（`axis=-1`），不是整个矩阵 |
| `masked_upper_is_zero` 是 false | 掩码方向写反（掩了下三角），或掩码位填的是 0 而不是 `-inf` | 要掩的是 `j > i`（严格上三角，**不含对角线**）；掩码位必须是 `-inf`，不能是 0 |
| 去缩放那档反而"更平" | 除的是 `d_head` 而不是 `√d_head`，或者根本没做缩放对照 | `params.scale_divisor = 2.0` 就是 `√4`；`no_scale` 档**不除**任何数 |
| `mean_future_weight` 在完整版里不是 0 | 掩码位填成了 0（0 也是"有权重"的语义） | 置 `-inf` 后 softmax 出来的概率才是 0 |
| `top_attend` 差一两个位置 | 并列时取了**最大**列号 | 口径是并列取**最小**列号（`np.argmax` 正好是第一个最大值） |
| `samples` 与 expected 不同 | 采样顺序/累加方式/种子处理不同 | `random.Random(4100)`，**每个锐化系数都重新初始化**；按 `vocab` 顺序累加；取第一个 `累加值 > u` 的下标 |
| 图里中文变方框 | 运行环境没有中文字体 | 图上的标题/轴标签用英文，中文写在 `takeaway` / `notes` 里 |
| 图没生成在 `figures/` 下 | `savefig` 的相对路径写错了 | 用 `figures/<文件名>.png`；报告里的 `path` 要与实际写到的一致 |
