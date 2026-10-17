# 深度学习入门实验一：分拣手写数字（三分类 · easy）

**定位（easy 档）**：第 3 章《深度学习基本原理和实践》的**入门**实验 —— 只为理解神经网络
"输入 → 网络 → 损失 → 反向传播"这一圈怎么转起来。网络只有一层隐藏层、数据只有 8×8 小图，
选择 3/8/9 三个**笔画相近**的数字，让混淆矩阵真的有东西可看。
与同章 medium 实验（`dl-train-diagnose` 训练诊断 / `dl-cnn-images` 卷积结构 / `dl-rnn-forecast`
序列建模）**不重复**：那三个是完整应用 + 复杂结构，本实验是"先把一轮训练跑通、看懂"。

**形态：应用驱动**（`docs/EXPERIMENT-DESIGN-FRAMEWORK.md` §2.6）—— 学生拿到的是**需求**
（把小图上的 3/8/9 分开、要比"一律猜最多"好得多、要有训练过程证据）。

**教学向设计**（§3.5 七件事）：学习目标 / 知识铺垫 / 导学步骤 / 参考资料与 FAQ 见下方
「项目字段文案」；参考实现随包下发（`problem/reference/`）、骨架留解释层（画图给最小示例、
训练循环留 TODO）、反思环节落在骨架的「能力边界」「实测档案」。

```
dl-mlp-digits/
├── problem/            → problem.zip        题目包（**随包下发给学生**）
│   ├── manifest.json   IO 契约（outputFile=output.json）+ 10 条确定性断言
│   ├── task.md         需求 + 六步流程 + 数据字典 + 交付格式
│   ├── judge.md        语义判据（图是否看图说话、模型与训练历史自洽、可疑、基线定义）
│   ├── README.md       导学
│   ├── cases/case0N/{data.csv, expected.json}
│   └── reference/      参考实现（两层 MLP + 训练曲线 + 混淆矩阵）
├── skill-template/     → skill-template.zip 学生起点（画图给了最小示例，两处 TODO 自己填）
├── tools/gen_data.py                        造题工具：从 sklearn 经典数据集导出 3/8/9（**不下发**）
└── README.md
```

## 场景与数据

- 应用：图书馆把旧借书卡上的手写数字（3/8/9）自动分开
- 对应章节：课程第 3 章《深度学习基本原理和实践》（神经网络分类的第一个例子）
- 数据：`sklearn.datasets.load_digits` 的 **3/8/9 三类**，8×8 像素导出成 CSV（固定数据，可重跑）

| 列 | 含义 |
|---|---|
| `p00` … `p77` | 8×8 图像的 64 个像素值（0~16 灰度，行优先） |
| `digit` | 目标：3 / 8 / 9 |

| case | 规模 | 特点 |
|---|---|---|
| case01 | 537 行（3/8/9 各约 180） | 原始扫描质量 |
| case02 | 360 行（各 120）+ 扫描噪声（±2 灰度、10% 像素） | 样本更少、数据更脏 |

## 判据设计要点

1. **"真的训练了"是硬性条件**：`training.history` 至少 5 轮、每轮有 `train_loss`、
   且**最后一轮损失 < 第一轮** —— 只报一个 accuracy 混不过去。
2. **两个指标一起卡**：`accuracy ≥ 0.92`（整体对）与 `macro F1 ≥ 0.90`（三个数字都认得住）。
   只认两个数字时 macro F1 会掉到 0.6 左右 —— 这是防退化项。
3. **基线可信**：核对 `baseline.accuracy` 与参考值（0.34 / 0.33）相差 ≤0.10，
   防止学生"用另一个训练好的网络当基线"。
4. **切分覆盖 + 占比**：`n_train + n_test === n_rows`、测试集占比 20%~40%。
5. **期望值不是满分**：参考实现 0.9778 / 0.9667 —— 留出"学生做得更好"的空间，
   也避免"做错也能碰巧全对"；`judge.md` 里明确写了"1.0000 要能解释"。
6. **图要说人话**：看数据（样例图 + 类别计数）、训练曲线、混淆矩阵，语义上要求
   "说出笔画差在哪、损失怎么变、混在哪一对"（judge 判，不写数字）。

## 出题时的实测依据（2026-10-17）

| 指标 | case01 | case02 |
|---|---|---|
| 全判多数类（基线）accuracy | 0.3407 | 0.3333 |
| 参考实现（两层 MLP 64→32→3，30 轮）accuracy | **0.9778** | **0.9667** |
| 参考实现 macro F1 | **0.9778** | **0.9665** |
| 训练损失（第 1 轮 → 第 30 轮） | 1.114 → 0.011 | 1.113 → 0.002 |
| 达标线 | accuracy 0.92 / macro F1 0.90 | accuracy 0.90 / macro F1 0.88 |

- **踩过的坑**：最初用 0/1/2 三个数字，30 轮训练就把测试集做到 100%（期望值满分、失去区分度），
  且混淆矩阵空无一物；换成语义上相近的 **3/8/9** 后才出现"3↔9 / 3↔8 偶尔混"的真实结果。
- 标签是 3/8/9，但 `CrossEntropyLoss` 要 0/1/2 的下标 —— 参考实现里显式做了映射。
- `expected.json` 由参考实现在**与复验同一个镜像**（`nju-lab-verify:0.2.0-rc.2-pkg6`）里生成。

## 项目字段文案（建项目时用）

- **title**：入门实验：分拣手写数字（三分类 · 神经网络 · 容易）
- **difficulty**：`easy`
- **content**（学生详情页首屏 = task.md 的「业务背景 + 你的任务」）：

  > 旧借书卡上的手写数字扫描成了 8×8 小图，要自动把 3/8/9 分开。现有做法是"一律报最多的那个数字"，
  > 正确率只有 1/3。你的任务：训练一个小神经网络（一层隐藏层就够），在测试集上 accuracy ≥ 0.92、
  > macro F1 ≥ 0.90，并记下逐轮训练损失（证明真的训练了）；看数据画一张图、训练与评估再各画一张，
  > 每张图写一句结论。

- **objectives**（学完能讲清什么）：
  1. 一个神经网络的前向计算是什么（输入 → 加权组合 → 输出分数）；
  2. 训练在做什么（算损失 → 反向传播 → 更新参数），损失曲线说明什么；
  3. 训练损失很低、测试集仍会错，说明什么（过拟合 / 样本难）。
- **background**：8×8 像素 → 64 维输入；隐藏层与激活函数；`CrossEntropyLoss` 与类别下标；
  优化器（Adam）与学习率；训练集/测试集切分。
- **description**（导学步骤，≤8 步）：
  读 `task.md` → 画样例图与类别计数 → 算"一律猜最多"的基线 → 搭 64→32→3 的小网络 →
  逐轮记录损失 → 算 accuracy / macro F1 → 画训练曲线与混淆矩阵 → 补全 `SKILL.md` 的边界与实测档案。
- **references**：`torch.nn` 的 `Linear`/`ReLU`/`CrossEntropyLoss` 文档；
  `sklearn.metrics.confusion_matrix`；`problem/reference/scripts/train.py`（示范实现）。
- **faq**：为什么 loss 降得很快但测试 accuracy 上不去？（学习率太大/网络太小，或标签没映射对）；
  为什么 3 和 9 容易混？（上半部都是圆弧，8×8 分辨率下差别很小）；
  训练多少轮合适？（看损失曲线，平了就够；本实验 20~40 轮）。

## 打包 / 自检 / 复验

```sh
cd server/fixtures/dl-mlp-digits
rm -f problem.zip skill-template.zip
(cd problem && zip -qr ../problem.zip .) && (cd skill-template && zip -qr ../skill-template.zip .)

# ① 结构 + 依赖自检（不烧 token）
docker run --rm -v "$PWD:/p:ro" nju-lab-verify:0.2.0-rc.2-pkg6 \
  --check --skill /p/skill-template.zip --problem /p/problem.zip

# ② 参考实现复验（应 2/2 通过 = 题目可解 + 判据不误杀）
cd /home/ubuntu/nju-lab && mkdir -p .verify-scratch/out
docker run --rm --env-file server/.env --memory 2g -e VERIFY_REASONING_EFFORT=low \
  -v "$PWD/server/fixtures/dl-mlp-digits:/p:ro" -v "$PWD/.verify-scratch/out:/outputs" \
  nju-lab-verify:0.2.0-rc.2-pkg6 --skill /p/problem/reference --problem /p/problem.zip \
  --out /outputs/dl-mlp-digits.json --timeout-ms 300000
```
