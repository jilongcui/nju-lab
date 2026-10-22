# 机器学习入门实验一：按花瓣尺寸识别鸢尾花品种（三分类 · easy）

**定位（easy 档）**：第 2 章《机器学习基本理论和实践》的**入门**实验 —— 只为理解分类的基本概念、
做一次完整的小流程。例子用最经典的鸢尾花测量数据、只取两个特征（能画成一张散点图），
模型由学生在入门模型里自选。与同章的 medium 实验（`aq-forecast` 回归 / `noshow-predict`
不平衡二分类 / `customer-tier` 多分类）**不重复**：那三个是"真实业务 + 达标线 + 防退化"的完整应用，
本实验是"先把六步走通一遍"。

**形态：应用驱动**（`docs/EXPERIMENT-DESIGN-FRAMEWORK.md` §2.6）—— 学生拿到的是**需求**
（量花瓣尺寸报品种、要比"一律猜最多"明显更好），而不是"用某个模型、按某个口径写代码"。

**教学向设计**（§3.5 七件事）：学习目标 / 知识铺垫 / 导学步骤 / 参考资料与 FAQ 见下方
「项目字段文案」；参考实现随包下发（`problem/reference/`）、骨架留解释层、反思环节落在骨架的
「能力边界」「实测档案」。

```
iris-classify/
├── problem/            → problem.zip        题目包（**随包下发给学生**）
│   ├── manifest.json   IO 契约（outputFile=output.json）+ 9 条确定性断言
│   ├── task.md         需求 + 六步流程 + 数据字典 + 交付格式
│   ├── judge.md        语义判据（图是否看图说话、指标自洽、可疑地过于好、基线定义）
│   ├── README.md       导学
│   ├── cases/case0N/{data.csv, expected.json}
│   └── reference/      参考实现（逻辑回归 + 两张图）
├── skill-template/     → skill-template.zip 学生起点（结构已搭好，两处 TODO 自己填）
├── tools/gen_data.py                        造题工具：从 sklearn 经典数据集导出两特征 CSV（**不下发**）
└── README.md
```

## 场景与数据

- 应用：园艺场按花瓣尺寸判断鸢尾花品种（setosa / versicolor / virginica）
- 对应章节：课程第 2 章《机器学习基本理论和实践》（分类问题的第一个例子）
- 数据：`sklearn.datasets.load_iris` 的**两个花瓣特征**导出成 CSV（固定数据，可重跑）

| 列 | 含义 |
|---|---|
| `petal_length_cm` | 花瓣长度（cm） |
| `petal_width_cm` | 花瓣宽度（cm） |
| `species` | 目标：`setosa` / `versicolor` / `virginica` |

| case | 规模 | 特点 |
|---|---|---|
| case01 | 150 行（三类各 50） | 手工测量较准，两类重叠很少 |
| case02 | 120 行（三类各 40）+ 测量误差 σ=0.15cm | 样本更少、数据更脏，检验方案稳不稳 |

## 判据设计要点

1. **两个指标一起卡**：`accuracy ≥ 0.90`（整体对）与 `macro F1 ≥ 0.85`（每个品种都认得住）。
   只认 setosa+versicolor 时 accuracy 还能看，macro F1 会掉到 0.6 左右 —— 这是本实验的防退化项。
2. **基线可信**：断言核对 `baseline.accuracy` 与参考值（0.32 / 0.33）相差 ≤0.10，
   防止学生"用另一个训练好的模型当基线"来显得自己提升很大。
3. **切分覆盖 + 占比**：`n_train + n_test === n_rows`、测试集占比 20%~40%，
   避免"在训练集上评估"这种自欺欺人的做法。
4. **图要说人话**：两张图（看数据散点 / 评估混淆矩阵），每张 `takeaway` ≥10 字，
   语义上要求"说出哪两类重叠、错在哪一类"（judge 判，不写数字）。
5. **期望值不是满分**：参考实现 case01 0.9474 / case02 0.9333 —— 留出"学生做得比示范好"的空间，
   也避免"做错也能碰巧全对"。

## 出题时的实测依据（2026-10-17）

| 指标 | case01 | case02 |
|---|---|---|
| 全判多数类（基线）accuracy | 0.3158 | 0.3333 |
| 全判多数类 macro F1 | 0.1600 | 0.1667 |
| 参考实现（逻辑回归 + 两特征）accuracy | **0.9474** | **0.9333** |
| 参考实现 macro F1 | **0.9487** | **0.9333** |
| 达标线 | accuracy 0.90 / macro F1 0.85 | accuracy 0.88 / macro F1 0.82 |

- 数据由 `tools/gen_data.py` 固定种子导出，重跑逐字节相同；case02 的测量误差也是固定种子。
- 先量了两端（全判一类 vs 逻辑回归）再定线：线卡在中间，离参考实现留 3~5 个百分点。
- `expected.json` 由参考实现在**与复验同一个镜像**（`nju-lab-verify:0.2.0-rc.2-pkg6`）里生成。

## 项目字段文案（建项目时用）

- **title**：入门实验：按花瓣尺寸识别鸢尾花品种（三分类 · 容易）
- **difficulty**：`easy`
- **content**（学生详情页首屏 = task.md 的「业务背景」；**不写"你的任务"**——执行要求属于
  `description` 与题目包 `task.md`，容易档只讲清课题本身）：

  > 园艺场里有一批鸢尾花，老师傅看花瓣就能报出品种：setosa 又短又窄，virginica 最长最宽，
  > versicolor 介于两者之间。
  > 场里攒下 150 朵花的手工测量记录，每条只有花瓣长度和花瓣宽度两个数，三个品种各 50 朵。
  > 现在要把这份经验做成「量尺寸报品种」的小工具：给出花瓣的长和宽，报出品种。

- **objectives**（陈述句，一个目标一个概念；容易档不夹问句）：
  1. 理解基线：不建模、一律报最多品种时准确率约 1/3，这个真实算出来的数是模型必须超过的下限；
  2. 会用 accuracy 与 macro F1 评价三分类结果，知道两个指标各回答什么、为什么可能不一致；
  3. 会读混淆矩阵，指出错分落在哪两个品种之间，并说明原因。

  > 表述口径（2026-10-17 用户确认）：**基线不是"人会这么做"的业务做法，而是零信息的下限**——
  > `output.json.baseline` 要真算出来（`build_baseline`：训练集多数类），断言核对它与参考值
  > 相差 ≤0.10。文案里不要把它写成"场里目前的办法"，那会被读成编出来的稻草人。
- **background**（**每条 = 概念 + 一句人话解释**；出现术语当场解释——`softmax` 就是例子。
  容易档不写公式，只讲"是什么、为什么和本实验有关"）：

  - **鸢尾花数据**：150 朵花、三个品种各 50 朵，只留花瓣长度与宽度两个测量值。这是统计学最经典的
    入门数据集，三个品种在花瓣尺寸上确实有差别。
  - **为什么两个特征就够**：setosa 的花瓣明显又短又窄，和另外两个几乎不重叠；versicolor 与 virginica
    尺寸接近，只在交界处会混——困难集中在后两个品种。
  - **训练集与测试集**：模型只能看训练集，评分只看测试集；`stratify` 让两边保持同样的品种比例
    （各占三分之一），避免某一类在测试集里太少、分数忽高忽低。
  - **逻辑回归怎么给出答案**：模型先给每个品种打一个分数，再用 `softmax` 把这组分数换算成
    "加起来等于 1"的概率（分数越高占比越大，差距还会被放大），最后取概率最大的那个品种。
    所以分类模型交出的通常是概率，而不是一个硬答案。
  - **多数类基线**：不建模、一律报数量最多的品种。数据均衡时按类别比例猜只能对三分之一，
    这个值代表"什么都没学到"的准确率。
- **description**（导学步骤，≤8 步）：
  读 `task.md` → 画散点看两类重叠 → 算多数类基线 → 选一个入门模型训练 →
  算 accuracy / macro F1 → 画混淆矩阵 → 对照 `judge.md` 自测两个 case → 补全 `SKILL.md` 的能力边界与实测档案。
- **references**：`sklearn` 的 `LogisticRegression` / `confusion_matrix` 文档；
  `problem/reference/scripts/train.py`（示范实现）。
- **faq**：为什么我的 accuracy 0.95 却没通过？（macro F1 或基线/切分项没过）；
  为什么两个 case 的达标线不一样？（case02 样本更少、有测量误差，线略低一档）；
  能不能只用花瓣长度？（可以，但重叠区会错得更多，自己用图说明）。

## 打包 / 自检 / 复验

```sh
cd server/fixtures/iris-classify
rm -f problem.zip skill-template.zip
(cd problem && zip -qr ../problem.zip .) && (cd skill-template && zip -qr ../skill-template.zip .)

# ① 结构 + 依赖自检（不烧 token）
docker run --rm -v "$PWD:/p:ro" nju-lab-verify:0.2.0-rc.2-pkg6 \
  --check --skill /p/skill-template.zip --problem /p/problem.zip

# ② 参考实现复验（应 2/2 通过 = 题目可解 + 判据不误杀）
cd /home/ubuntu/nju-lab && mkdir -p .verify-scratch/out
docker run --rm --env-file server/.env --memory 2g -e VERIFY_REASONING_EFFORT=low \
  -v "$PWD/server/fixtures/iris-classify:/p:ro" -v "$PWD/.verify-scratch/out:/outputs" \
  nju-lab-verify:0.2.0-rc.2-pkg6 --skill /p/problem/reference --problem /p/problem.zip \
  --out /outputs/iris-classify.json --timeout-ms 300000
```
