# 深度学习实验二：手写数字分拣（小图分类 · 卷积结构）

**形态：应用驱动**（`docs/EXPERIMENT-DESIGN-FRAMEWORK.md` §2.6）—— 学生拿到的是**需求**而不是
"模型名字 + 口径"：要解决的问题（把扫描表单里的手写数字分拣对、每一档都要认得出）、达标线
（macro F1 + 逐档召回）、约束（必须记录逐轮训练过程）由题干给出；**网络结构 / 增强 / 优化器 / 轮数
由学生自己决定**，判据按"是否达到业务目标 + 是否说清怎么处理扫描偏移"判。

**教学向设计**（§3.5 七件事）：学习目标 / 知识铺垫 / 导学步骤 / 参考资料与 FAQ 见下方
「项目字段文案」；参考实现随包下发（`problem/reference/`）、骨架留解释层、反思环节落在骨架的
「能力边界」「实测档案」。

```
dl-cnn-images/
├── problem/            → problem.zip        题目包（**随包下发给学生**）
│   ├── manifest.json   IO 契约（outputFile=output.json）+ 13 条确定性断言
│   ├── task.md         需求 + 三条要求 + 达标线 + 数据字典 + 交付格式
│   ├── judge.md        语义判据（训练曲线、怎么处理偏移、可疑地过于好、基线语义）
│   ├── README.md       导学
│   ├── cases/case0N/{data.csv, expected.json}
│   └── reference/      参考实现（16-32 通道卷积 + 半概率平移增强 + 早停 + 三张图）
├── skill-template/     → skill-template.zip 学生起点（结构已搭好，三个 TODO 自己填）
├── tools/gen_data.py                        造题工具：公开小图数据集 → 两批扫描件（**不下发**）
└── README.md
```

## 场景与数据

- 应用：纸质表单里的**手写数字**自动分拣（分错一档就串档，所以逐档召回都要达标）
- 数据：公开数据集 **UCI Optical Recognition of Handwritten Digits**（sklearn 自带 `load_digits`，
  1797 张真实手写数字）→ 8×8 灰度（64 列 `pixel_rc`，取值 0~1）+ 标签 `label`（0~9）
- case01：扫描质量好（1797 张、10 档均衡）；case02：**扫描质量差**（1639 张）
  —— 每张随机平移 1 像素 + 叠加噪点，数字 0 与 8 的样本更少

## 判据设计要点（**"位置不变性"是本实验的判别核心**）

1. **达标线双卡**：`macro_f1 ≥ 0.93`（case02 为 0.85）**且逐档召回率 ≥ 0.85**（case02 为 0.65）。
   只卡 macro F1 会被"放弃少数几档、把大类做满"混过去 —— 逐档召回是防退化项。
2. **"真的训练了"是硬性条件**：断言要求 `training.history` ≥5 轮、每轮都有 `loss` 与 `val_loss`，
   且 `epochs_run === history.length`、`early_stopped` 是布尔 —— 与另两个实验一致。
3. **基线语义**：上一版系统 = 64 个像素直接进线性分类器，在**同一测试集**上算；
   断言核对 `baseline.macro_f1` 与参考值相差 ≤0.12。
4. **case01 是基础档（刻意留的常规路径）**：好批次上"上一版系统"也能过线（0.971 对 0.93）——
   这没问题，实验的判别力在 case02：那里线性基线掉到 0.53，不改做法必然不达标。
5. **语义交给模型**（`judge.md`）：训练曲线的 `takeaway` 有没有说清"从哪一轮开始过拟合"；
   `notes` 有没有说清"**怎么处理扫描偏移**"（卷积 / 增强 / 对齐预处理都算），并给出前后差距；
   是否可疑地过于好（macro F1 超参考 0.08 且无解释）。

### 出题时的实测依据（不是推测）

同一测试集（`random_state=42`）下量出三档差距：

| 做法 | case01 macro F1 | case02 macro F1 |
|---|---|---|
| 上一版系统：64 像素 → 线性分类器 | 0.971 | **0.528** |
| 卷积（无增强） | 0.937 | 0.779 |
| **卷积 + 半概率平移增强（参考实现）** | **0.982** | **0.946** |
| 卷积 + 全批次平移增强 | 0.917 | 0.784 |

> 结论：① "把它当一行像素"在 case02 上直接塌掉（0.53 → 必须换做法）；
> ② 增强不是越猛越好 —— 全批次都平移会把干净批次也拖差（0.982 → 0.917），
> 参考实现改成"一半批次原样喂进去"，两个批次同时变好。这正是本实验要练的判断。

> 下面命令里的镜像 tag 是当前生产复验镜像（`pkg6`）；本轮材料首次实测是在 `pkg5` 上做的，
> 两个镜像的区别只在 judge 请求的 token 预算（见 `server/verify-image/README.md`），与题目材料无关。

## 重新生成数据与参考水平

```sh
cd server/fixtures/dl-cnn-images
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/w" --entrypoint python3 \
  nju-lab-verify:0.2.0-rc.2-pkg6 /w/tools/gen_data.py
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/w" --entrypoint python3 \
  nju-lab-verify:0.2.0-rc.2-pkg6 /w/problem/reference/scripts/train.py --regen-expected
```

## 打包 / 自检 / 上传

```sh
cd server/fixtures/dl-cnn-images
rm -f problem.zip skill-template.zip
(cd problem && zip -qr ../problem.zip .) && (cd skill-template && zip -qr ../skill-template.zip .)

# 结构 + 依赖自检（不烧 token）
docker run --rm -v "$PWD:/p:ro" nju-lab-verify:0.2.0-rc.2-pkg6 \
  --check --skill /p/skill-template.zip --problem /p/problem.zip

# 教师侧自检闭环（拿参考实现跑复验，应全部通过）
docker run --rm --memory 2g --env-file ../../../server/.env -v "$PWD:/p:ro" -v /tmp/out:/outputs \
  nju-lab-verify:0.2.0-rc.2-pkg6 \
  --skill /p/problem/reference --problem /p/problem.zip --out /outputs/result.json
```

上传两个 zip 拿 `fileId`、绑定到项目并写入教学字段的命令模板见
[`../dl-train-diagnose/README.md`](../dl-train-diagnose/README.md)（三个实验同一套流程）。

## 项目字段文案（§3.5 第 1~4 项，可直接粘贴）

**objectives**

```
1. 能讲清"结构要对得上数据"：为什么 64 个像素排成一行会让位置信息丢失，卷积的局部连接与池化各自在解决什么。
2. 能讲清"数据增强的取舍"：为什么训练时也要引入扫描偏移（增强），又为什么不能把干净批次全换掉（用自己跑出来的数字说明）。
3. 能讲清"多分类该看哪个指标"：macro F1 与逐档召回揭示了什么，为什么只看 accuracy 会掩盖"放弃某一档"。
```

**background**

```
· 图像与二维结构：像素之间"挨着"是信息；全连接把二维关系拉平，卷积用局部感受野保住它。
· 卷积 / 池化：卷积学局部模式（笔画、拐角），池化带来一定平移不变性并压缩尺寸。
· 数据增强：把"已知会发生的失真"在训练时也造出来，等价于给模型更多同类样本；过度使用会偏离真实分布。
· 类别不平衡与指标：某几档样本少时，accuracy 会被大类主导；macro F1 给每档同等权重，逐档召回看"有没有放弃谁"。
· 混淆矩阵：看清"哪两档容易被搞混"，比一个总分更能指导改进。
· 过拟合与早停：训练损失继续降、验证损失回升 = 开始记训练集；交出去的是最优轮次的权重。
· 基线：上一版系统（像素 + 线性分类器）是现实存在的对照物，让"换做法有没有用"可量化。
```

**description**（八步，每步说明"在学什么"）

```
1. 读 task.md：看清需求（每一档都要认出来）、达标线与交付格式 —— 学"把业务约束翻译成指标"。
2. 打开工作区里的 cases/case01/data.csv，看列名规律（pixel_rc）与取值范围 —— 学"看数据的结构"。
3. 画第一张图（figures/data_overview.png）：逐档样本数 + 每档一张缩略图 —— 学"从图里发现不均衡与笔画粗细"。
4. 算上一版系统的成绩（64 个像素直接进线性分类器）写进 baseline —— 学"为模型找参照物"。
5. 把像素还原成 8×8 图像，切分训练/验证/测试（固定种子、stratify）—— 学"把数据整理成模型要的形状"。
6. 训练卷积网络，逐轮记录训练/验证损失；画第二张图（训练曲线）—— 学"训练过程可诊断"。
7. 在测试集上算 macro F1 / accuracy / 逐档召回，画 10×10 混淆矩阵（第三张图）—— 学"读出错在哪两档"。
8. 写 notes 与每张图的 takeaway：怎么处理扫描偏移、增强怎么取舍、哪一档最弱 —— 学"把判断说清楚"。
```

**references**

```
· PyTorch 卷积网络教程：https://pytorch.org/tutorials/beginner/blitz/cifar10_tutorial.html
· PyTorch 数据增强（torchvision transforms）：https://pytorch.org/vision/stable/transforms.html
· scikit-learn 分类指标（macro F1 / 混淆矩阵）：https://scikit-learn.org/stable/modules/model_evaluation.html
· 原始数据集说明：https://archive.ics.uci.edu/dataset/80/optical+recognition+of+handwritten+digits
```

**faq**

```
Q：为什么我把像素直接进线性分类器，case01 还行、case02 就崩了？
A：case02 每张图都平移过 1 像素。线性分类器给每个像素位置一套固定权重，位置一变就全部错位；
   卷积 + 池化对这种平移稳定得多（还可以在训练时做平移增强）。

Q：我加了平移增强，结果 case01 反而变差了？
A：增强把训练分布改了，干净批次上会吃亏。折中办法是"只对一部分批次增强"
   （参考实现是 50% 概率），或者按批次的失真程度分别处理。

Q：macro F1 还行，但某一档召回很低，能过吗？
A：不能。判据要求每一档的召回率都不低于底线（串档比少认几张更贵）。针对弱档加样本/加增强。

Q：训练很慢？
A：容器通常只给 1 个 CPU：torch 默认按可见核数开线程反而互相抢（设 OMP_NUM_THREADS=1 会快很多）；
   另外小批量（64）比全批量收敛快得多。

Q：验证集怎么划？
A：从训练集里分层抽 20%（stratify），固定随机种子；测试集全程不要看一眼，更不要拿它调参。
```

## 出题提醒

- 达标线（0.93 / 0.85 + 逐档 0.85 / 0.65）是权衡结果：改动前先按上面的命令重算 `expected.json`，
  并用「出题时的实测依据」那张表复核"不换做法过不了 case02"。
- 想加难，优先加**数据侧的坑**（更强平移、缩放/旋转、更多噪点、更极端的类别不平衡），
  而不是把达标线收到"只有一种网络能过"。
- `task.md` / `judge.md` / 参考实现三处事实源改动要同步，然后重算 `expected.json`。

### 端到端复验（拿参考实现跑真实复验流程）

```sh
docker run --rm --memory 2g --cpus 2 --env-file server/.env   -v "$PWD/server/fixtures/dl-cnn-images:/p:ro" -v /tmp/out:/outputs   nju-lab-verify:0.2.0-rc.2-pkg6 --skill /p/problem/reference --problem /p/problem.zip --out /outputs/result.json
```

实测（pkg5、pkg6 各跑一次）：**case01 / case02 均 pass=true、score=1、硬性断言 13/13**；单轮 dsh 耗时 300s / 79s（pkg5）、208s / 77s（pkg6）—— 耗时浮动较大，case01 曾贴着 300s 的单轮上限（见下方"已知风险"）。
case01 那轮**贴着 300s 的单轮上限**（平台钉死 ≤300s/轮），上线前建议留意（见下方"已知风险"）。

## 已知风险与调法

- **单轮 dsh 耗时贴近上限**：平台把单轮 dsh 钉在 ≤300s，而深度学习实验的 agent 轮
  （读题 → 写代码 → 训练 → 出图 → 写报告）在负载高时会冲到 200~300s。若学生报告出现超时：
  ① 把项目 `evalConfig.timeoutSeconds`（容器整体，默认 600）调大；
  ② 把 `evalConfig.maxCases` 设为 `1`（只跑一个 case —— case 数减半、风险与 token 成本都减半，代价是覆盖度下降）；
  ③ 题面已提示"训练别开大"，必要时可再收紧数据规模。
- **judge 空响应**（表现为 `judge output not parseable`）：已由复验镜像 `pkg6` 修复
  （judge `max_tokens` 2048 → 4096）。若仍遇到，先确认 `VERIFY_IMAGE` 指向 `pkg6` 及以上。
- **判定口径**：上线前用一个测试学生账号走一遍「领取 → 提交 → 复验 → 批改」，确认耗时与 rationale 措辞。

## 实测记录

### 2026-11（本实验包首次落地）

- 参考实现（16/32 通道卷积 + 池化 + **半概率**平移增强 ±1 像素 + Adam + 早停，CPU 1 核 2g 内存）：
  case01 macro F1 0.982 / 逐档最低 0.930；case02 macro F1 0.946 / 逐档最低 0.875
- 上一版系统（64 像素 + 逻辑回归）同一测试集：case01 macro F1 0.971、case02 **0.528**
- 单 case 运行 40~70 秒；`--check` 通过（依赖自检覆盖 torch / sklearn / matplotlib）
- ⚠️ 训练有极小的非确定性（多线程浮点归约顺序），参考水平在 ±0.003 内浮动；
  基线与阈值都留了足够余量，不影响判定
- ⚠️ 环境注意：容器 `--cpus 1` 时 torch 默认线程数按宿主核数开，训练慢十几倍 ——
  自测/复验建议带 `-e OMP_NUM_THREADS=1`
