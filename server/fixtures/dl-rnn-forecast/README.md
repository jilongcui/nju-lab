# 深度学习实验三：传感器时序下一值估计（序列建模 · 滑窗 + LSTM）

**形态：应用驱动**（`docs/EXPERIMENT-DESIGN-FRAMEWORK.md` §2.6）—— 学生拿到的是**需求**而不是
"模型名字 + 口径"：要解决的问题（提前一分钟估出设备温度，比"当前值当下一秒"明显更准）、
达标线（MAE 相对基线的比值）、约束（窗口 ≥ 3 分钟、按时间切分、必须记录逐轮训练过程）由题干给出；
**窗口长度 / 网络结构 / 特征组合 / 优化器由学生自己决定**，判据按"是否达到业务目标 +
时序纪律是否正确"判。

**教学向设计**（§3.5 七件事）：学习目标 / 知识铺垫 / 导学步骤 / 参考资料与 FAQ 见下方
「项目字段文案」；参考实现随包下发（`problem/reference/`）、骨架留解释层、反思环节落在骨架的
「能力边界」「实测档案」。

```
dl-rnn-forecast/
├── problem/            → problem.zip        题目包（**随包下发给学生**）
│   ├── manifest.json   IO 契约（outputFile=output.json）+ 13 条确定性断言
│   ├── task.md         需求 + 三条要求 + 达标线 + 数据字典 + **口径** + 交付格式
│   ├── judge.md        语义判据（训练曲线、时序纪律、可疑地过于好、基线语义）
│   ├── README.md       导学
│   ├── cases/case0N/{data.csv, expected.json}
│   └── reference/      参考实现（滑窗 + 标准化 + LSTM 预测增量 + 早停 + 三张图）
├── skill-template/     → skill-template.zip 学生起点（结构已搭好，三个 TODO 自己填）
├── tools/gen_data.py                        造题工具：合成教学时序（**不下发**）
└── README.md
```

## 场景与数据

- 应用：车间设备监控 —— 由传感器读数**提前一分钟**估出设备温度，用于过热前调低负载
- 数据（合成教学时序，固定种子）：`minute_of_day` / `ambient` / `current` / `vibration` / `temp` → `temp_next`
- 生成模型：负载按**约 45 分钟的工作循环**走（case02 为 37 分钟）→ 温度被热惯性带着起落 →
  叠加很小的仪表读数噪声。**下一分钟的走向取决于"循环处在上升段还是下降段"，而这是单个当前值给不出的信息**

| case | 规模 | 特点 |
|---|---|---|
| case01 | 1500 分钟 | 常规工况，工作循环 45 分钟 |
| case02 | 1200 分钟 | 工况变了：循环 37 分钟、中段负载抬升 6℃、噪声更大 |

## 判据设计要点（**时序纪律**是本实验的判别核心）

1. **达标线是相对的**：`metrics.mae ≤ 0.55 × baseline.mae`（case02 为 0.60）—— 业务表述是
   "比现在做法明显更准"，用相对值避免被温度尺度差异干扰。
2. **窗口是硬性要求**：断言核对 `window ≥ 3`，且滑窗样本数自洽
   （`n_train + n_test` ≈ 行数 − `window` + 1，±5 容差）—— 逼学生真的把时序变成监督样本，
   而不是"用一行特征做个回归"。
3. **训练过程是硬性要求**：`training.history` ≥5 轮且每轮有 `loss` / `val_loss`、
   `epochs_run` 自洽、`early_stopped` 是布尔 —— 与另两个实验一致，把注意力推到训练过程上。
4. **防"可疑地过于好"**：断言给 MAE 一条下界（≥ 0.02 × 基线），`judge.md` 进一步判
   "低于参考水平 0.3 倍且无解释 → 可疑"（典型原因是打乱切分、用测试段调参、把 `temp_next` 当特征）。
5. **基线语义**：现有做法 = 把当前读数当下一秒，在**同一测试段**上算；断言核对它与参考值的差
   （±0.12 / ±0.15）。实测：case01 0.617、case02 0.749（时序切分固定，值几乎完全可复现）。
6. **时序纪律交给 judge**：随机打乱切分 = 数据泄漏，语义判据里有一条专门判它。

### 出题时的实测依据（不是推测）

同一时间切分（测试段 = 最后 25%）下，量出"不建模 / 只用当前行 / 用一段窗口"的三档差距：

| 做法 | case01 MAE（比值） | case02 MAE（比值） |
|---|---|---|
| 现有做法：当前读数当下一秒（persistence） | 0.617（1.00） | 0.749（1.00） |
| 只用**当前行**特征 + Ridge | 0.495（0.80） | 0.566（0.76） |
| 滑动均值（5 分钟） | 1.805（2.93） | 2.190（2.93） |
| **窗口 8 分钟** + Ridge | 0.099（0.16） | 0.123（0.16） |
| **窗口 8 分钟** + LSTM（参考实现，预测增量） | **0.109（0.18）** | **0.299（0.40）** |

> 结论："只看当前行"在两组数据上都过不了 0.55 / 0.60 的线 —— 达标线确实要求**用上历史窗口**；
> 而窗口之上用什么模型（LSTM / GRU / 一维卷积 / 窗口特征 + 线性模型）都能过，不是"只有一种做法"。

> 下面命令里的镜像 tag 是当前生产复验镜像（`pkg6`）；本轮材料首次实测是在 `pkg5` 上做的，
> 两个镜像的区别只在 judge 请求的 token 预算（见 `server/verify-image/README.md`），与题目材料无关。

## 重新生成数据与参考水平

```sh
cd server/fixtures/dl-rnn-forecast
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/w" --entrypoint python3 \
  nju-lab-verify:0.2.0-rc.2-pkg6 /w/tools/gen_data.py
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/w" --entrypoint python3 \
  nju-lab-verify:0.2.0-rc.2-pkg6 /w/problem/reference/scripts/train.py --regen-expected
```

## 打包 / 自检 / 上传

```sh
cd server/fixtures/dl-rnn-forecast
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

上传两个 zip 拿 `fileId`、绑定到项目并写入教学字段的命令模板（`PROJECT_ID` 换成实际值）见
[`../dl-train-diagnose/README.md`](../dl-train-diagnose/README.md) 的「打包 / 自检 / 上传」一节 ——
三个实验同一套流程，只是 `objectives` 等字段文案不同（见下）。

## 项目字段文案（§3.5 第 1~4 项，可直接粘贴）

**objectives**

```
1. 能讲清"时序任务为什么不能随机切分"：随机切分让未来信息漏进训练，成绩虚高；正确做法是按时间切、测试段取最后一段。
2. 能讲清"滑窗与窗口长度"这个决策：窗口太短看不到趋势、太长会把旧工况带进来，并用自己跑出来的数字说明。
3. 能讲清"从窗口里读方向"：为什么单个当前值给不出"下一分钟往哪走"，以及预测增量为什么比预测绝对值好学。
```

**background**

```
· 时间序列的监督化：滑窗 (window 分钟 → 下一分钟) 是标准动作，样本数 ≈ 行数 − window + 1。
· 时序切分与数据泄漏：时序不能随机 shuffle；验证集也要从训练段的**末尾**划。
· 循环神经网络（LSTM/GRU）：靠隐状态传递"最近的走势"，适合"当前值看不出方向"的序列。
· 预测增量 vs 预测绝对值：增量围绕 0 波动，网络不必先学出基线水平，训练更稳。
· 特征缩放与目标缩放：都只能用训练段统计量拟合，否则测试段信息会漏进来。
· 过拟合与早停：训练损失继续降、验证损失回升 = 开始记训练段噪声；交出去的是最优轮次的权重。
· 基线：一个不需要模型、现实存在的做法（这里是"把当前读数当下一秒"），让"我的模型好不好"有参照物。
```

**description**（八步，每步说明"在学什么"）

```
1. 读 task.md：看清需求、达标线与**口径**（滑窗、按时间切分、基线怎么算）—— 学"把业务目标翻译成可核对的量"。
2. 打开工作区里的 cases/case01/data.csv，看列含义与量纲 —— 学"先看数据再动手"。
3. 画第一张图（figures/data_overview.png）：温度随时间怎么走、目标怎么分布 —— 学"从图里读出周期、台阶与噪声水平"。
4. 算现有做法的成绩（当前读数当下一秒）并写进报告的 baseline —— 学"为模型找参照物"。
5. 把时序切成 (窗口 → 下一分钟) 样本，按时间切分训练/验证/测试 —— 学"滑窗与时序纪律"。
6. 标准化后训练序列模型，逐轮记录训练/验证损失；画第二张图（训练曲线）—— 学"训练过程可诊断"。
7. 在测试段上算 MAE/RMSE，画出预测 vs 实际与残差（第三张图）—— 学"误差出现在哪一段时刻"。
8. 写 notes 与每张图的 takeaway：窗口怎么定、周期与工况怎么处理、还有什么不足 —— 学"把结论说给别人听"。
```

**references**

```
· PyTorch LSTM 文档：https://pytorch.org/docs/stable/generated/torch.nn.LSTM.html
· PyTorch 时序预测教程（含 LSTM 预测序列）：https://pytorch.org/tutorials/beginner/basics/optimization_tutorial.html
· scikit-learn 指标：https://scikit-learn.org/stable/modules/model_evaluation.html （MAE / RMSE）
· "为什么时序不能随机切分"（scikit-learn 时序交叉验证）：https://scikit-learn.org/stable/modules/cross_validation.html#cross-validation-of-time-series-data
```

**faq**

```
Q：我的 MAE 和基线差不多，怎么都降不下去？
A：先看数据图：下一分钟的走向取决于"循环处在上升段还是下降段"。只用当前行特征（甚至只用一个点）拿不到这个信息 ——
   必须真的把一段窗口喂进去。

Q：训练损失降了但验证损失很高？
A：过拟合（训练段只有一条轨迹，很容易记住噪声）。早停并回退最优轮次权重、减小网络、或缩短窗口。

Q：MAE 怎么能低到 0.1 以下？
A：本数据的读数噪声很小（0.1~0.2℃），而循环是确定性的，所以窗口模型能做得很好 ——
   但如果你的 MAE 低到几乎为 0，先怀疑自己把 temp_next 当特征喂进去了，或者打乱了时间切分。

Q：训练很慢？
A：容器通常只给 1 个 CPU：torch 默认按可见核数开线程反而互相抢（设 OMP_NUM_THREADS=1 会快很多）；
   另外别把网络开大 —— 这条序列的规律不需要很多参数。

Q：验证集怎么划？
A：从**训练段的末尾**划一段（例如 20%），不能随机抽 —— 随机抽等于让"之后的信息"参与调早停。
```

## 出题提醒

- 达标线（0.55 / 0.60）是权衡结果：太松则"只看当前行"也能过，太紧则学生受挫。
  改动前先按上面的命令重算 `expected.json`，并用「出题时的实测依据」那张表复核区分度。
- 想加难，优先加**数据侧的坑**（噪声更大、循环更快、工况切换更频繁、缺一段采样），
  而不是把达标线收到"只有一种网络能过"。
- `task.md` / `judge.md` / 参考实现三处事实源改动要同步，然后重算 `expected.json`。

### 端到端复验（拿参考实现跑真实复验流程）

```sh
docker run --rm --memory 2g --cpus 2 --env-file server/.env   -v "$PWD/server/fixtures/dl-rnn-forecast:/p:ro" -v /tmp/out:/outputs   nju-lab-verify:0.2.0-rc.2-pkg6 --skill /p/problem/reference --problem /p/problem.zip --out /outputs/result.json
```

实测（pkg5、pkg6 各跑一次）：**case01 / case02 均 pass=true、score=1、硬性断言 13/13**；单轮 dsh 耗时 221s / 259s（pkg5）、188s / 46s（pkg6）—— 耗时浮动较大，接近过 300s 的单轮上限（见下方"已知风险"）。
接近 300s 的单轮上限，上线前建议留意（见下方"已知风险"）。

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

- 参考实现（滑窗 8 分钟 + 标准化 + LSTM(32) 预测增量 + Adam + 早停，CPU 1 核 1g 内存）：
  case01 MAE 0.109（基线 0.617，比值 0.18）；case02 MAE 0.299（基线 0.749，比值 0.40）
- 单 case 运行 6~12 秒；`--check` 通过（依赖自检覆盖 torch / sklearn / matplotlib）
- 对比实测见上「出题时的实测依据」表：只用当前行 0.80 / 0.76（都过不了线）、窗口 0.16 / 0.16
- ⚠️ 环境注意：容器 `--cpus 1` 时 torch 默认线程数会按宿主核数开，训练慢十几倍 ——
  自测/复验建议带 `-e OMP_NUM_THREADS=1`
