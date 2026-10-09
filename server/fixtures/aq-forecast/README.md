# 应用实验 A：估算下一小时的 PM2.5（回归）

**形态：应用驱动**（2026-10-08 起的新范式）—— 学生拿到的是**需求**而不是"模型名字 + 口径"：
要解决的问题（提前一小时估算 PM2.5，比现有做法明显更好）、约束（测试集占比、可复现、要解释选择）
由题干给出；**模型/特征/切分由学生自己决定**，判据按"是否达到业务目标"判，而不是"是否等于标准答案"。

结构（与其它实验一致，但 `problem/` 里没有"标准答案"，只有**参考水平**）：

```
aq-forecast/
├── problem/            → problem.zip        题目包（**随包下发给学生**）
│   ├── manifest.json   IO 契约（outputFile=output.json；inputs=[data.csv]）
│   ├── task.md         业务需求 + 三条要求 + 数据字典 + 交付格式
│   ├── judge.md        判据：达标线（相对基线）+ 防伪核对 + 防退化
│   ├── README.md       导学
│   ├── cases/case0N/{data.csv, expected.json}
│   └── reference/      参考实现（Ridge + 全特征 + 基线对比）—— 随包下发，先读后仿
├── skill-template/     → skill-template.zip 学生起点（结构已搭好，两个 TODO 要自己填）
├── tools/gen_data.py                        造题工具：固定种子生成数据（**不下发**）
└── README.md
```

## 场景与数据

- 应用：估算某监测点**下一小时**的 PM2.5（供值班人员提前提示敏感人群）
- 数据（合成，固定种子）：`temp` / `humidity` / `wind_speed` / `pm25_lag1` / `pm25_neighbor` / `hour` → `pm25_next`
- case01（600 行，常规季节）、case02（420 行，冬季重污染）

## 判据设计要点（**达标判定**，与"逐字段比对"型题目不同）

1. **达标线是相对的**：`metrics.mae ≤ 0.8 × baseline.mae`（业务表述："比现有做法好 ≥20%"）。
   用相对值而不是绝对值，是因为两批数据浓度尺度不同（case02 污染更重）。
2. **防退化**：持久性基线本身（把 `pm25_lag1` 当预测）比值恰好 1.0 → 必然不达标；
   所以"不建模直接交"过不了，但"用一个简单模型"完全能过（这是刻意的 —— 应用任务重在决策与验证）。
3. **防伪核对**：学生报告的 `baseline.mae` 必须落在 `expected.json` 的参考值 **±15%** 内
   （实测：基线随切分浮动 6.5%~8.7%，±15% 覆盖正常浮动，但挡住"故意填大基线"）。
4. **防"可疑地过于好"**：`metrics.mae` 低于参考实现的 50% 且 `notes` 无解释 → 判可疑
   （通常是用测试集调参或数据泄漏）。
5. **过程要求**：必须报告 `model`/`n_train`/`n_test`/`baseline`/`notes`，且 `notes` 说清选择 ——
   这部分才是"学到了什么"的证据，抄不了。

> 通过 `judge.md`（教师判据）+ 平台统一的 LLM judge 实现；**不需要改驱动**。

## 打包 / 自检 / 上传

```sh
cd server/fixtures/aq-forecast
rm -f problem.zip skill-template.zip
(cd problem && zip -qr ../problem.zip .) && (cd skill-template && zip -qr ../skill-template.zip .)

# 结构 + 依赖自检
docker run --rm -v "$PWD:/p:ro" nju-lab-verify:0.2.0-rc.2-pkg4 \
  --check --skill /p/skill-template.zip --problem /p/problem.zip

# 教师侧自检闭环（拿参考实现跑复验，应全部通过）
docker run --rm --env-file ../../../server/.env -v "$PWD:/p:ro" -v /tmp/out:/outputs \
  nju-lab-verify:0.2.0-rc.2-pkg4 \
  --skill /p/problem/reference --problem /p/problem.zip --out /outputs/result.json
```

上传绑定与项目字段（`objectives` / `background` / `description` / `references` / `faq`）的命令
见 `server/fixtures/README.md`；项目字段按 `docs/EXPERIMENT-DESIGN-FRAMEWORK.md` §3.5 的七件事写。

## 重新生成数据与参考水平

```sh
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/w" --entrypoint python3 \
  nju-lab-verify:0.2.0-rc.2-pkg4 /w/tools/gen_data.py
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/w" --entrypoint python3 \
  nju-lab-verify:0.2.0-rc.2-pkg4 /w/problem/reference/scripts/train.py --regen-expected
```

## 出题提醒

- 达标线（0.8）与容差（±15%）都是**权衡结果**：太松则"随便做个模型"就过，太紧则学生受挫。
  改动前先按上面的命令重算 `expected.json`，确认两批数据都能分开"基线 / 参考实现"。
- 若要让任务更难，加数据（更少的特征、更强的噪声、分布漂移），而不是把达标线收紧到
  "只有一种模型能过"—— 那是技术考据，不是应用判断。

## 实测记录

### 2026-10-31（画图改造：去掉"多方案对比"，改成"用图说话"）

用户反馈："多个方案我觉得不太需要，不要把教学任务搞复杂了；看数据时能调用 plot 画出图示就好了，
最后结果也要展示训练和评估结果的图示。" 据此调整（三个实验一致）：

- **② 看数据时画图**、**⑤ 评估结果时画图**；图存到工作目录 `figures/`，结论写进报告的 `figures`
  字段（`[{"path", "takeaway"}]`）—— judge 看不到图片本身，只能读文本，所以要求"每张图一句话结论"。
- **去掉"至少比较两个方案"**（那会把教学任务搞复杂；实测加它之后参考实现耗时从 40s 涨到 124s）。
- 新增 1 条断言「图表说明齐全（至少 2 张图、每张 path + ≥10 字 takeaway）」。
- 图用 `matplotlib`（镜像已预装 3.11.2），用 `Agg` 后端；**标题与轴标签用英文** —— 镜像里没有中文字体，
  中文会渲染成方框（第一版实测图里全是方框，已写进题干提醒）。
- `judge.md` 语义项改为"`figures` 与 `notes` 是否看图说话"，并要求图里的数字与 `metrics` 自洽。

实测：`--check` 通过（断言 8 条）；参考实现复验 **2/2 通过**（`hard=8/8`，121.7s / 90.7s）；
平台重新绑定 + `description` 换成六步（含画图）。

**过程中的一个真发现**：B 的 case02 首次被 LLM 判为**不通过** —— 判据说"评估图 takeaway 里
『名单 81 人』与 metrics.precision 对不上（应为 69 人）"。查证属实：参考实现里混淆矩阵的算式写错了，
已改为直接由混淆矩阵计算（名单 = 真阳性 + 误报）。**新判据的自洽性检查真的抓出了示范里的 bug。**

### 2026-10-30（表述浅化）

按"**通用直观**"原则把题干里的环境领域术语换成大白话（"周边站点反映区域输送 / 湿度偏高时二次生成
更活跃" → "附近监测站的读数 / 湿度高时浓度往往略高"），并同步 `reference` 的 `notes`、
`tools/gen_data.py` 的注释与平台项目的 `background` 字段。

改后重新生成 expected（数值未变：6.074 → 3.5568 / 7.9419 → 4.7527）、重打包、重测：
`--check` 通过（7 条断言）；参考实现复验 **2/2 通过**（`hard=7/7`，120.0s / 40.6s）；
平台重新绑定（sha256 `4cc1bc30…` 与本地一致）+ 更新 `background`（已无旧术语）。

### 2026-10-10（初版）

**数据可分性**（决定达标线能否分开"不建模 / 真想"）：

| case | 持久性基线 MAE | 参考实现 MAE | 比值 | 达标线（0.8×基线） |
|---|---|---|---|---|
| case01 | 6.07 | 3.56 | 0.59 | 4.86 |
| case02 | 7.94 | 4.75 | 0.60 | 6.35 |

→ 达标线落在两者之间：**直接交基线（比值 1.0）过不了，用上特征就能过**；两端都留了余量。
顺带量到：只用 `pm25_lag1` 一列的线性回归（4.19 / 5.60）也能达标 —— 这是**刻意的**，
应用任务重在"做选择 + 建基线 + 解释"，不强迫特定特征组合。

**基线浮动**：跨 `test_size`(0.2~0.4) × `random_state`(0/42/2026) 共 12 组，持久性基线 MAE 相对跨度
6.5%~8.7% → 断言容差取 ±15%（覆盖正常浮动，但挡住"故意填大基线"）。

**`--check`**：通过（`source=manifest`、cases `[case01, case02]`、inputs `[data.csv]`、依赖 ok）。

**判分链路（pkg5，含 `assertions`）**：

| 跑什么 | 结果 |
|---|---|
| 参考实现复验 | ✅ **2/2 通过**（`hard=7/7`），case01 94s / case02 67s |
| 负样本"不建模"（我写了退化脚本想验证判据） | ⚠️ **也通过（7/7）** —— 但**不是断言失效**：agent 根本不理那个脚本，读了 `task.md` 就自己写了个达标模型 |
| 临时把达标线收到 0.1（不可能达到） | ✅ `pass=false score=0.5 hard=6/7`，rationale 明确指出 **"达标：MAE 比持久性基线低 ≥20%" 不成立** |

**两条教训**（已写进规范 §2.6 / §5.1）：

1. **"负样本"不能用脚本构造**：被测 agent 是照着 `task.md` 干活的 —— 你想让它交一个差方案，
   它会自己把方案做好。要验证判据，得从**判据侧**验证（收紧阈值，看它是否拦住）。
2. **达标线不能让 LLM 去算**：最初把"MAE ≤ 0.8×基线"写进 `judge.md`，同一个"不建模"的产出被
   LLM 判成了**通过**。改由 `manifest.assertions` + 驱动代码判定后，拦截是确定性的。

**平台侧**：项目「实验：下一小时 PM2.5 估算（回归应用）」已创建并发布（`problem.zip` sha256 与本地一致），
5 个教学字段按 §3.5 写入；原 `ml-basics` 项目已删除下线（其教学内容已被本实验取代）。
复验镜像切到 **pkg5**（`assertions` 支持 + judge 输出加固）。
