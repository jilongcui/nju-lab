# 大语言模型实验：手写缩放点积注意力 + 三档消融 + 采样（第 4 章）

> 课程《分子医学人工智能理论与实验》**第 4 章《大语言模型原理和实践》**（chapter id
> `df1a6ec0-a6d3-48e0-9bb0-0677a7094ad7`）。
> 第 4 章原文**没有「动手实践」节**，也没讲"温度"（那属于另一门课）—— 本实验从零设计，
> 并配套在章末补了一小节「动手实践」指向它（见 `docs/PLAN-2026-10-experiment-roadmap.md` §7）。

**用户选定的口径（2026-10-10，路线图 §6 第 7 项）**：第 4 章实验**含"下一个 token 的概率分布 + 采样"**
（不只是注意力 + 消融）；题干里用「**锐化系数**」这个名义引入（正文没讲"温度"，不新造概念）。

## 结构

```
attention-ablation/
├── problem/            → problem.zip        题目包（**随包下发给学生**）
│   ├── manifest.json   IO 契约（outputFile=output.json）+ 14 条确定性断言
│   ├── task.md         需求 + 六步流程 + 切 token / 注意力 / 消融 / 采样四套口径 + 交付格式
│   ├── judge.md        语义判据（√d 与掩码各自解决什么、Q/K/V 分工、局限）
│   ├── README.md       导学 + 排错表
│   ├── cases/case0N/{sentences.csv,embeddings.csv,params.json,expected.json}
│   └── reference/      参考实现（numpy 手写注意力 + 三档消融 + 采样 + 两张图）
├── skill-template/     → skill-template.zip 学生起点（结构已搭好，五处 TODO 自己填）
├── tools/gen_data.py                        造题工具（**不下发**）
└── README.md
```

## 场景与数据

- 应用：把第 4 章的两句论断 —— "为什么要拆 QKV"、"√d 缩放与因果掩码各解决什么" —— **变成可量的现象**
- 形态：**机制复现 + 消融对照**（不训练模型；权重与输入都是给定的、写死的）
- 数据（合成教学数据，英文，无真实患者）：

| 文件 | 列/键 | 说明 |
|---|---|---|
| `sentences.csv` | `sent_id,text` | 虚构医学记录句子（按 `sent_id` 升序切 token） |
| `embeddings.csv` | `pos,token,dim_0…dim_7` | 每个 token 的输入表示（已含位置信息），`pos` 与切出的 token 序列逐位对齐 |
| `params.json` | `W_q/W_k/W_v`、`d_head`、`scale_divisor`、`sampling` | 三组写死的权重 + 采样段（候选 token、logits、锐化系数、种子） |

| case | 规模 | 特点 |
|---|---|---|
| case01 | 31 个 token（3 句）/ 词表 8 | 短序列 |
| case02 | 44 个 token（4 句）/ 词表 8 | 长序列（掩码与缩放的差异更明显） |

## 判据设计要点

1. **输入写死 → 校验和逐字节可比**：`gen_data.py` 把所有小数落地成**固定 3 位小数的十进制字符串**，
   学生读到的就是这些数字 ⇒ Q/K/V、注意力矩阵、`attn_checksum`、`top_attend`、采样结果
   **跨平台逐位一致**。这是本实验敢做"精确比对"的前提（浮点输入若由种子现算，跨 BLAS 版本就会漂）；
2. **离散量优先于连续量**：`top_attend`（每行 `argmax` 的列号，并列取最小）本身是**离散**的，
   完全不受浮点误差影响；用它 + 校验和一起锁住"注意力算对了没有"；
3. **连续量用容差 + 方向性双判**：消融的 `max_row_weight` / `entropy` / `mean_future_weight`
   与 `expected` 比对（容差 `1e-3`），**另有**方向性断言（去缩放 → 更尖、熵更低；去掩码 → 未来权重 > 0）
   —— 后者比数值更能说明"读懂了口径"，也不会被浮点末位差异误杀；
4. **把"偷看未来"做成判据**：`mean_future_weight` 在完整版必须为 0、去掩码版必须 > 0；
   掩码位若写成 0（而不是 `-inf`）会被这条抓出来（0 也是"有权重"的语义）；
5. **采样口径钉到随机数序列**：`random.Random(4100)`、三个锐化系数**各自重新初始化**（共用同一串 `u`）、
   按 `vocab` 顺序累加做逆变换采样 ⇒ `samples`（前 5 个）可逐项比对，顺序或累加方式错了立刻暴露；
6. **判据分层**：14 条 `assertions` 全部是"能写死的事实"；语义（机制讲清没有、图结论是否自洽、
   是否正视局限）交给 `judge.md` —— **数值达标线一条都没写进 judge**。

## 出题时的实测依据（不是推测，2026-10-10 在复验镜像 `pkg6` 里跑）

| 指标 | case01 | case02 |
|---|---|---|
| token 数 / 不同 token | 31 / 26 | 44 / 38 |
| `top_terms` | `["The","and","days"]` | `["The","and","patient"]` |
| `attn_checksum` | `8d16d6b80dda` | 见 `cases/case02/expected.json` |
| 消融 `max_row_weight`：full → no_scale | **0.2761 → 0.4329** | **0.3149 → 0.5296** |
| 消融 `entropy`：full → no_scale | **2.2074 → 1.7238** | **2.2831 → 1.5123** |
| 去掩码 `mean_future_weight` / `entropy` | **0.4725** / **3.1066** | **0.4989** / **3.1275** |
| `top1_ratio`：s=0.5 → 1.0 → 2.0 | **0.745 → 0.540 → 0.360** | **0.820 → 0.620 → 0.370** |
| `top1_prob`：s=0.5 → 1.0 → 2.0 | 0.7728 → 0.5489 → 0.3444 | 0.8541 → 0.6170 → 0.3758 |

- **标定过程**（`tools/gen_data.py` 每次都会打印这些量）：输入表示 `N(0, 0.8)`、权重 `N(0, 0.5)`，
  使缩放后的分数标准差落在 1~1.5（有区分度、不饱和），去掉缩放后到 2~3（明显更尖）——
  两端都量过，才敢把"方向性"写成断言；
- **复验**：参考实现 **2/2 通过、硬性 14/14**（case01 58s / case02 33s，`hardChecks.failed` 为空，
  rationale 无"矛盾"类问题）；
- **`--check`**：退出码 0，14 条断言，`dependencyCheck.ok = true`（`numpy` + `matplotlib` 均已预装）。

## 项目字段文案（上传到平台时用）

**objectives**

1. 能说清注意力在分配什么：`Q`/`K`/`V` 三副"眼镜"各管什么，为什么"算像不像"与"搬运内容"要分开。
2. 能说清 `√d` 缩放与因果掩码**各自**解决什么问题，并用**消融数据**（最大行权重、行熵、"看到未来"的权重）
   把差别量出来，而不是背结论。
3. 能说清"概率 ≠ 每次都会选中的词"：不同锐化系数下分布怎么变、200 次采样的实测占比为什么贴近 top-1 概率。

**background**

- **注意力 = 软对齐**：每个 token 用 `Q`（我在找什么）去和全序列的 `K`（我是什么被找的）比"像不像"，
  再用这组权重去加权取 `V`（我实际交出的内容）—— 权重逐行和为 1，可读、可画、可解释成"看了哪里"。
- **为什么除以 `√d`**：`Q·K` 是 d 项之和，方差随 d 线性增长 ⇒ 分数被维度放大 ⇒ softmax 饱和成近似 one-hot ⇒
  梯度几乎传不回来。除以 `√d` 把方差拉回 1 附近。
- **为什么要有因果掩码**：语言模型在位置 i 只能看到 1..i；不掩就是把"下一个词"提前给模型看。
  掩码同时让解码可以**逐 token 增量**进行（不需要重算整个序列）。
- **下一个 token 的分布**：logits 经 softmax 得到概率；把 logits 除以一个**锐化系数**再 softmax，
  系数越小越"自信"（top-1 概率高、熵低）、越大越"发散"。采样不是每次都取概率最大的那个词。
- **边界**：注意力权重只说明"模型看了哪里"，**不等于**"模型为什么这样回答" —— 这是幻觉难以追溯的原因之一。

**description**（导学步骤）

1. 读 `task.md`：**先看清四套口径**（切 token、注意力、消融、采样 —— 都不许改），再看交付格式。
2. 读 `problem/reference/`：一份走完六步的示范 —— 先读懂输出，再写你自己的。
3. **切 token**：按 `sent_id` 顺序切、去标点、保持大小写；报 `n_tokens` / `n_unique_tokens` / `top_terms`。
4. **算注意力**：`Q=X·W_q`、`K=X·W_k`、`V=X·W_v` → `QKᵀ` → `/√d_head` → 因果掩码 → 逐行 softmax，
   报形状、行和、掩码是否生效、`top_attend`、`attn_checksum`。
5. **做消融**：full / no_scale / no_mask 三档各报 `max_row_weight` / `entropy` / `mean_future_weight`，
   并在 `notes` 里讲清差异从哪来。
6. **做采样**：三个锐化系数下的 top-1 概率、熵、200 次实测占比与前 5 个采样结果。
7. **画两张图**（消融对照、采样对照，标题与轴标签用英文），每张配一句"看图说话"的结论。
8. **写结论 + 自测两个 case**：与 `cases/<case>/expected.json` 对照（校验和、`top_attend`、消融数值、采样）。

**references**

- 课程第 4 章《大语言模型原理和实践》（Token 与词表、Embedding 与位置编码、注意力、Transformer、幻觉）
- 注意力机制：<https://en.wikipedia.org/wiki/Attention_(machine_learning)>
- 《Attention Is All You Need》（Transformer 原始论文）：<https://arxiv.org/abs/1706.03762>
- 本课程第 3 章《深度学习基本原理和实践》（LSTM 的门控 —— 注意力的"前身"）

**faq**

- **`attn_checksum` 对不上？** 校验和格式与口径不同：行内 `,`、行间 `\n`、**末尾不加换行**、
  每项 `f"{v:.4f}"`，取 sha256 前 12 位；最常错在末尾多了一个换行。
- **`row_sums` 不是 1？** softmax 没有"逐行"做（对整矩阵做了一次）；归一化的轴是每一行（`axis=-1`）。
- **`masked_upper_is_zero` 是 false？** 掩码方向写反（掩了下三角），或掩码位填的是 0 而不是 `-inf`；
  0 也是"有权重"的语义，softmax 后不会变成 0。
- **去缩放那档反而更平？** 除的是 `d_head` 而不是 `√d_head`；`params.scale_divisor = 2.0` 就是 `√4`。
- **`samples` 与 expected 不同？** 采样顺序/累加方式/种子处理不同：`random.Random(4100)`，
  **每个锐化系数都重新初始化**，按 `vocab` 顺序累加，取第一个「累加值 > u」的下标。
- **中文能跑吗？** 本实验的语料是英文（token 已切好）；换中文要先解决分词，环境里没有分词器。

## 打包 / 自检 / 复验

```sh
cd server/fixtures/attention-ablation
rm -f problem.zip skill-template.zip
(cd problem && zip -qr ../problem.zip .) && (cd skill-template && zip -qr ../skill-template.zip .)

# 结构与依赖自检（不烧 token）
docker run --rm -v "$PWD:/p:ro" nju-lab-verify:0.2.0-rc.2-pkg6 \
  --check --skill /p/skill-template.zip --problem /p/problem.zip

# 教师侧闭环：拿参考实现跑一遍复验（应 2/2 通过）
cd /home/ubuntu/nju-lab && mkdir -p .verify-scratch/out
docker run --rm --env-file server/.env --memory 2g -e VERIFY_REASONING_EFFORT=low -e VERIFY_MAX_CASES=0 \
  -v "$PWD/server/fixtures/attention-ablation:/p:ro" -v "$PWD/.verify-scratch/out:/outputs" \
  nju-lab-verify:0.2.0-rc.2-pkg6 --skill /p/problem/reference --problem /p/problem.zip \
  --out /outputs/attention-ablation.json --timeout-ms 300000
```

重算 `expected.json`（**必须与复验同镜像**）：

```sh
cd server/fixtures/attention-ablation
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/w" --entrypoint python3 \
  nju-lab-verify:0.2.0-rc.2-pkg6 /w/problem/reference/scripts/attention.py --regen-expected
```

上传两个 ZIP 拿 `fileId`，绑到「Skill 模板」「题目包」，再用 `chapterId` 挂到课程
《分子医学人工智能理论与实验》**第 4 章《大语言模型原理和实践》**下并 publish
（命令见 `docs/EXPERIMENT-CREATION-GUIDE.md` 步骤 11）。
