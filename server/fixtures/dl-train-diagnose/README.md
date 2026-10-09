# 深度学习实验一：细胞核形态辅助筛查（二分类 · 训练过程诊断）

**形态：应用驱动**（`docs/EXPERIMENT-DESIGN-FRAMEWORK.md` §2.6）—— 学生拿到的是**需求**而不是
"模型名字 + 口径"：要解决的问题（把恶性样本查出来、比现有做法更可靠）、达标线（recall / precision）、
约束（必须记录逐轮训练过程、要解释选择）由题干给出；**网络结构 / 优化器 / 早停策略 / 判定阈值由学生自己决定**，
判据按"是否达到业务目标 + 训练过程是否讲得清"判，而不是"是否等于标准答案"。

**教学向设计**（§3.5 七件事）：学习目标 / 知识铺垫 / 导学步骤 / 参考资料与 FAQ 见下方
「项目字段文案」（可直接粘贴到平台项目里）；参考实现随包下发（`problem/reference/`）、
骨架留解释层（`skill-template/SKILL.md`）、反思环节落在骨架的「能力边界」「实测档案」。

```
dl-train-diagnose/
├── problem/            → problem.zip        题目包（**随包下发给学生**）
│   ├── manifest.json   IO 契约（outputFile=output.json）+ 13 条确定性断言
│   ├── task.md         需求 + 三条要求 + 两档达标线 + 数据字典 + 交付格式
│   ├── judge.md        语义判据（训练曲线是否说清过拟合、自洽性、可疑地过于好、基线语义）
│   ├── README.md       导学（学什么 / 怎么走 / 包内有什么）
│   ├── cases/case0N/{data.csv, expected.json}
│   └── reference/      参考实现（标准化 + MLP + dropout + 早停 + 三张图）—— 随包下发，先读后仿
├── skill-template/     → skill-template.zip 学生起点（结构已搭好，三个 TODO 自己填）
├── tools/gen_data.py                        造题工具：公开数据集 → 两批数据（**不下发**）
└── README.md
```

## 场景与数据

- 应用：检验科**辅助筛查** —— 由细胞核形态测量判断样本是否恶性（recall 优先，precision 防退化）
- 数据：公开数据集 **UCI Breast Cancer Wisconsin**（sklearn 自带 `load_breast_cancer`，569 条真实测量）
  → 30 个数值特征（10 个测量量 × 均值/标准误/最差值）+ 标签 `malignant`
- case01：全量 569 条、原始量程；case02：**"另一台仪器"** 320 条 —— 每列乘 10^±2.5 的固定增益、
  叠加 5% 相对测量噪声、恶性占比降到 22%

## 判据设计要点（**训练过程**是本实验的判别核心）

1. **达标线**：case01 `recall ≥ 0.90`、case02 `recall ≥ 0.85`，两者 `precision ≥ 0.80`
   （达标线写进各 case 的 `expected.json.accept`，由 `manifest.assertions` 引用 —— 算术交给代码）。
2. **防退化**：`precision ≥ 0.80` 挡住"全判恶性"（恶性占比只有 22%/37%）。
3. **"真的训练了"是硬性条件**：断言要求 `training.history` ≥5 轮、每轮都有 `loss` 与 `val_loss`，
   且 `epochs_run === history.length`、`early_stopped` 为布尔。逻辑回归那类"一次求解"的做法给不出
   逐轮 `val_loss` —— 学生的注意力因此被推到**训练过程**上（这正是本章的教学点）。
4. **基线语义**：现有做法 = 只看 `mean_radius`、按出厂上限 15 µm 判恶性，且必须**在同一测试集**上算；
   断言核对 `baseline.recall` / `baseline.precision` 与参考值（±0.15 / ±0.25 个点）——挡住"填个假基线"。
   实测：case01 基线 recall 0.72 / precision 0.86（**过不了 0.90 的线**）；case02 量程变了，
   固定上限直接失效（recall 0.00）。
5. **语义交给模型**（`judge.md`）：训练曲线的 `takeaway` 有没有说清"从哪一轮开始过拟合、怎么处理"；
   `model` 与 `metrics`/`training` 是否自洽；是否可疑地过于好（recall 与 precision 同时超参考 0.10 且无解释）。

### 出题时的实测依据（不是推测）

用同一个测试集（`random_state=42`）实测了几种做法，说明达标线"能分开不建模与真做"：

| 做法 | case01 recall / precision | case02 recall / precision |
|---|---|---|
| 现有做法（`mean_radius ≥ 15`） | 0.717 / 0.864 | 0.000 / 0.000 |
| **不标准化**就训练 MLP | 0.887 / 1.000 | **0.000 / 0.000** |
| 仅 `mean_radius` 一列 + 标准化 + 逻辑回归 | 0.774 / 0.759 | 0.941 / 0.727 |
| 标准化 + MLP + dropout + 早停（参考实现） | **0.962 / 0.981** | **0.941 / 0.941** |

> 结论：**不标准化**在 case02 上直接归零；**只看一列**在两个 case 上都会撞到某一根线。
> 达标线因此不是"只有一种模型能过"，而是"必须真的看数据、真的训练"。

> 下面命令里的镜像 tag 是当前生产复验镜像（`pkg6`）；本轮材料首次实测是在 `pkg5` 上做的，
> 两个镜像的区别只在 judge 请求的 token 预算（见 `server/verify-image/README.md`），与题目材料无关。

## 重新生成数据与参考水平

```sh
cd server/fixtures/dl-train-diagnose
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/w" --entrypoint python3 \
  nju-lab-verify:0.2.0-rc.2-pkg6 /w/tools/gen_data.py
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/w" --entrypoint python3 \
  nju-lab-verify:0.2.0-rc.2-pkg6 /w/problem/reference/scripts/train.py --regen-expected
```

## 打包 / 自检 / 上传

```sh
cd server/fixtures/dl-train-diagnose
rm -f problem.zip skill-template.zip
(cd problem && zip -qr ../problem.zip .) && (cd skill-template && zip -qr ../skill-template.zip .)

# 结构 + 依赖自检（不烧 token）
docker run --rm -v "$PWD:/p:ro" nju-lab-verify:0.2.0-rc.2-pkg6 \
  --check --skill /p/skill-template.zip --problem /p/problem.zip

# 教师侧自检闭环（拿参考实现跑复验，应全部通过；torch 实验建议给容器 2g 内存）
docker run --rm --memory 2g --env-file ../../../server/.env -v "$PWD:/p:ro" -v /tmp/out:/outputs \
  nju-lab-verify:0.2.0-rc.2-pkg6 \
  --skill /p/problem/reference --problem /p/problem.zip --out /outputs/result.json
```

上传两个 zip 拿 `fileId`，再绑定到项目并写入教学字段（**命令模板**，把 `PROJECT_ID` 换成实际值）：

```sh
TOKEN=$(curl -s http://127.0.0.1:3100/api/auth/login -X POST -H 'Content-Type: application/json' \
  -d '{"username":"teacher","password":"teacher123"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["accessToken"])')
SKILL_ID=$(curl -s http://127.0.0.1:3100/api/files -X POST -H "Authorization: Bearer $TOKEN" -F "file=@skill-template.zip" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["id"])')
PROBLEM_ID=$(curl -s http://127.0.0.1:3100/api/files -X POST -H "Authorization: Bearer $TOKEN" -F "file=@problem.zip" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["id"])')
python3 - "$TOKEN" "$PROJECT_ID" "$SKILL_ID" "$PROBLEM_ID" <<'PY'
import json, sys, urllib.request
token, pid, skill_id, problem_id = sys.argv[1:5]
payload = {
    "skillTemplateFileId": skill_id,
    "problemFileId": problem_id,
    "evalConfig": {"timeoutSeconds": 900, "maxCases": 0, "reasoningEffort": "high"},
    "objectives": "…",  # 见下方「项目字段文案」
    "background": "…",
    "description": "…",
    "references": "…",
    "faq": "…",
}
req = urllib.request.Request(
    f"http://127.0.0.1:3100/api/projects/{pid}", method="PATCH",
    data=json.dumps(payload).encode(), headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
)
print(urllib.request.urlopen(req).status)
PY
```

> ⚠️ 上线前确认：项目**挂对章节**（第三章「深度学习」）、`evalConfig.reasoningEffort` 只能是
> `off/low/high/max`、截止时间已设、发布（`draft → published`）后才为学生派发任务。
> torch 实验把 `VERIFY_DOCKER_MEMORY` 从 `1g` 调到 `2g`（见 `server/.env.example`）。

## 项目字段文案（§3.5 第 1~4 项，可直接粘贴）

**objectives**

```
1. 能讲清"训练过程怎么看"：从训练/验证损失曲线判断从哪一轮开始过拟合，并说明早停、dropout、权重衰减各自在解决什么。
2. 能讲清"预处理为什么不是可选项"：特征量纲差几个数量级时不做标准化会发生什么（用自己跑出来的数字说明）。
3. 能讲清"指标怎么对业务说话"：不平衡数据里为什么用 recall 而不是 accuracy，precision 又挡住了哪种退化解。
```

**background**

```
· 二分类与决策阈值：模型输出概率，阈值决定"报不报"；下调阈值换更高 recall、代价是更多误报。
· 过拟合与泛化：训练损失继续下降但验证损失回升 = 开始记住训练集；处理手段有早停、dropout、L2、减小网络。
· 早停与"取哪一轮的权重"：验证损失最低的那一轮才是要交出去的那一轮（不是最后一轮）。
· 特征缩放：梯度下降对量纲敏感；StandardScaler 要把"只用训练集拟合"这条纪律记住，否则测试集信息会漏进训练。
· 不平衡数据的指标：accuracy 会被多数类主导；recall（漏报）、precision（误报）是一对需要权衡的量。
· 基线：一个不需要模型、现实里真实存在的做法（这里是"单特征 + 出厂上限"），它让"我的模型好不好"有参照物。
```

**description**（八步，每步说明"在学什么"）

```
1. 读 task.md：看清需求与达标线 —— 学"把业务目标翻译成指标"。
2. 打开工作区里的 cases/case01/data.csv，看行数、两类占比、各列数值范围 —— 学"先看数据再动手"。
3. 画第一张图（figures/data_overview.png）：类别分布 + 最区分类别的特征分布 —— 学"用图发现不均衡与量纲问题"。
4. 算现有做法的成绩（mean_radius ≥ 15）并写进报告的 baseline —— 学"为模型找参照物"。
5. 划分训练/验证/测试集（固定种子、stratify）并做标准化（只用训练集拟合）—— 学"可复现的切分与防泄漏"。
6. 训练一个多轮模型，逐轮记录训练损失与验证损失；画第二张图（训练曲线）—— 学"训练过程可诊断"。
7. 在测试集上算 recall/precision 并画混淆矩阵（第三张图）—— 学"读懂漏报与误报的业务含义"。
8. 写 notes 与每张图的 takeaway：怎么处理过拟合、和基线比如何、还有什么不足 —— 学"把结论说给别人听"。
```

**references**

```
· PyTorch 官方教程：https://pytorch.org/tutorials/ （训练循环、优化器、保存最优权重）
· scikit-learn 预处理：https://scikit-learn.org/stable/modules/preprocessing.html （StandardScaler）
· scikit-learn 指标：https://scikit-learn.org/stable/modules/model_evaluation.html （recall / precision / 混淆矩阵）
· 原始数据集说明：https://archive.ics.uci.edu/dataset/17/breast+cancer+wisconsin+diagnostic
```

**faq**

```
Q：我的 recall 上不去（0.7 左右）？
A：先确认两件事：① 有没有标准化（量纲差几个数量级时网络几乎学不动）；② 有没有用满 30 列特征，而不是只看一列。

Q：训练损失一直降、验证损失在涨，怎么办？
A：那就是过拟合。做三件事：早停（并回退到验证损失最低那一轮的权重）、加 dropout 或权重衰减、或把网络缩小。

Q：我的 recall 很高但 precision 很低？
A：说明你把太多良性报成了恶性（退化解的一种）。检查判定阈值是不是太低、类别是否失衡，
   也可以给恶性样本加权（BCEWithLogitsLoss 的 pos_weight）。

Q：case02 上什么都训不出来？
A：case02 来自"另一台仪器"，量程差两个数量级。先看各列的取值范围，再做标准化。

Q：训练太慢/超时？
A：把数据放在 CPU 上跑小网络（几百个参数到几万个参数），epoch 上限 200 以内、batch 用全量或 64 都很够用。
```

## 出题提醒

- 达标线是**权衡结果**：太松则"随便训一下"就过，太紧则学生受挫。改动前先按上面的命令重算
  `expected.json`，确认"不标准化""只看一列"仍然过不了。
- 想加难，优先加**数据侧的坑**（更强的量程漂移、更多测量噪声、更少的恶性样本），
  而不是把达标线收到"只有一种网络结构能过"。
- `task.md` / `judge.md` / 参考实现三处事实源改动要同步，然后重算 `expected.json`。

### 端到端复验（拿参考实现跑真实复验流程）

```sh
docker run --rm --memory 2g --cpus 2 --env-file server/.env   -v "$PWD/server/fixtures/dl-train-diagnose:/p:ro" -v /tmp/out:/outputs   nju-lab-verify:0.2.0-rc.2-pkg6 --skill /p/problem/reference --problem /p/problem.zip --out /outputs/result.json
```

实测（pkg5、pkg6 各跑一次）：**case01 / case02 均 pass=true、score=1、硬性断言 13/13**；单轮 dsh 耗时 82s / 56s（pkg5）、66s / 183s（pkg6）。

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

- 数据：`load_breast_cancer` → case01 569 行 / case02 320 行（另一台仪器：10^±2.5 增益 + 5% 噪声 + 恶性 22%）
- 参考实现（MLP 32-16 + dropout 0.2 + Adam lr 0.01 + 早停 patience 20，**CPU 1 核 1g 内存**）：
  case01 recall 0.9623 / precision 0.9808（36 轮，best 16）；case02 recall 0.9412 / precision 0.9412（100 轮，best 80）
- 单 case 运行 6~7 秒（含 torch import、训练与出图）；`--check` 通过（依赖自检覆盖 torch / sklearn / matplotlib）
- 负样本实测（见上「出题时的实测依据」表）：不标准化 case02 recall 0.000；只看一列 recall 0.774 / 0.941 且 precision ≤ 0.76
