# 应用实验 B：门诊预约失约预测（二分类 · 类别不平衡）

**形态：应用驱动** —— 学生拿到**需求**而不是"模型名 + 口径"：找出会失约的预约（好打电话提醒）、
达标要求（**recall ≥ 0.65 且 precision ≥ 0.40**、可复现、说清选择）；**模型/特征/阈值自己定**，
判据按"是否达到业务目标"判，而不是"是否等于标准答案"。

```
noshow-predict/
├── problem/            → problem.zip        题目包（**随包下发给学生**）
│   ├── manifest.json   IO 契约 + 9 条确定性断言（达标线 / 防退化 / 基线核对）
│   ├── task.md         需求 + 四条要求 + 数据字典 + 交付格式
│   ├── judge.md        语义判据（怎么处理不平衡、自洽性、可疑地过于好）
│   ├── README.md       导学
│   ├── cases/case0N/{data.csv, expected.json}
│   └── reference/      参考实现（逻辑回归 + class_weight + 基线对比）—— 随包下发
├── skill-template/     → skill-template.zip 学生起点（结构已搭好，两个 TODO 自己填）
├── tools/gen_data.py                        造题工具：固定种子生成数据（**不下发**）
└── README.md
```

## 场景与数据

- 应用：门诊预约制下，提前找出**会失约**的预约（运营团队据此打电话提醒、调整排班）
- 数据（合成教学数据）：`age` / `lead_days` / `prior_noshow` / `distance_km` / `reminder_called` → `noshow`
- case01（800 行，失约率 27.5%）、case02（600 行，失约率 33.5%）

## 判据设计要点（**防退化**是这里的核心）

1. **两个指标同时卡**：`recall ≥ 0.65` **且** `precision ≥ 0.40`。只卡 recall 会被
   "全判失约"刷满（recall=1.0，但 precision 只有失约率 0.28），只卡 precision 会被
   "全判会来"刷满（precision 无意义、recall=0）。**这两条正好对应两个退化解。**
2. **基线必须是"不做预测"**：现有做法 = 一律认为患者会来 → `baseline.recall ≤ 0.05`（断言核对）；
   `baseline.accuracy` 与参考值相差 ≤15%（防"填个假基线"）。这样"准确率骗人"的教学点也落在判据里。
3. **达标线由"认真做能达到"定**：参考实现（逻辑回归 + `class_weight="balanced"`）在两批数据上
   recall 0.73 / 0.76、precision 0.47 / 0.55 —— 达标线留了约 8~12% 余量。
4. **语义判定（`judge.md`）**：`notes` 有没有讲清"怎么处理不平衡"、model 与指标是否自洽、
   是否可疑地过于好（同时远超参考水平且无解释）。

> 判据分层见 `docs/EXPERIMENT-DESIGN-FRAMEWORK.md` §5.1：算术/阈值 → `manifest.assertions`（代码），
> 语义 → `judge.md`（LLM）。

## 打包 / 自检 / 上传

```sh
cd server/fixtures/noshow-predict
rm -f problem.zip skill-template.zip
(cd problem && zip -qr ../problem.zip .) && (cd skill-template && zip -qr ../skill-template.zip .)

# 结构 + 依赖自检
docker run --rm -v "$PWD:/p:ro" nju-lab-verify:0.2.0-rc.2-pkg5 \
  --check --skill /p/skill-template.zip --problem /p/problem.zip

# 教师侧自检闭环（拿参考实现跑复验，应全部通过）
docker run --rm --env-file ../../../server/.env -v "$PWD:/p:ro" -v /tmp/out:/outputs \
  nju-lab-verify:0.2.0-rc.2-pkg5 \
  --skill /p/problem/reference --problem /p/problem.zip --out /outputs/result.json
```

## 重新生成数据与参考水平

```sh
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/w" --entrypoint python3 \
  nju-lab-verify:0.2.0-rc.2-pkg5 /w/tools/gen_data.py
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/w" --entrypoint python3 \
  nju-lab-verify:0.2.0-rc.2-pkg5 /w/problem/reference/scripts/train.py --regen-expected
```

## 出题提醒

- **改动失约率或信号强度后必须重新标定**：达标线要让"两个退化解都过不了、认真做能过"。
  本实验造数据时调了三轮才有现在的数字（见 `tools/gen_data.py` 的注释与下面的实测记录）。
- **不要把达标线收到"只有一种模型能过"**：那是技术考据，不是应用判断（应用任务应该允许多种解法）。
- 若还想加难度：把失约率调得更低（更不平衡）、或加入弱相关特征让特征选择变重要。

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

### 2026-10-21（初版）

**数据标定**（三轮调整后）：

| case | 规模 | 失约率 | 现有做法（全判会来） | 退化解（全判失约） | 参考实现（LR + balanced） |
|---|---|---|---|---|---|
| case01 | 800 | 27.5% | recall 0.00 / accuracy 0.725 | recall 1.00 / precision 0.275 | recall 0.727 / precision 0.465 |
| case02 | 600 | 33.5% | recall 0.00 / accuracy 0.667 | recall 1.00 / precision 0.333 | recall 0.760 / precision 0.551 |

→ 达标线（recall ≥ 0.65 / precision ≥ 0.40）**两个退化解都过不了**，参考实现有 8~12% 余量。
另测：不加 `class_weight` 时 LR 的 recall 只有 0.17（模型学会"全判会来"）—— 这正是实验要教的。

**`--check`**：通过（`source=manifest`、cases `[case01, case02]`、inputs `[data.csv]`、
识别到 **9 条断言**、依赖 ok）。

**复验（pkg5）**：参考实现 **2/2 通过**（`hard=9/9`，case01 79.5s / case02 48.4s）。

**平台**：项目「实验：门诊预约失约预测（二分类 · 类别不平衡）」已创建并发布
（`problem.zip` sha256 `473f5cac…` 与本地一致），5 个教学字段按 §3.5 写入。
