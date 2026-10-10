# 实验创建指南 —— 从零做一个新实验的思路

> **这份文档是核心方法论**：以后要加新实验（新对话、新同学接手），照它走。
> 配套阅读：设计范式与判据分层见 [`EXPERIMENT-DESIGN-FRAMEWORK.md`](EXPERIMENT-DESIGN-FRAMEWORK.md)，
> 包格式细节见 [`EXPERIMENT-PACKAGE-SPEC.md`](EXPERIMENT-PACKAGE-SPEC.md)，
> 部署/镜像的环境坑见 [`UPGRADE-playbook.md`](UPGRADE-playbook.md)。

---

## 0. 先想清楚：我们为什么要做这样的实验

这一节是**全部设计的出发点**，题目、判据、材料都从这里推导。

1. **教学优先，不是考核优先**。实验的目的是让学生**经历一次完整的实验**、知道"该怎么想"，
   而不是把人分成三六九等。判据是"是否做到"，不是"是否比别人强"。
2. **AI 时代的能力定位**：操作可以外包给 AI，**判断与解释外包不了**。
   所以学生要练的是 —— 选什么模型、基线是多少、指标说明了什么、哪里想错了。
   （学生端 LLM 因此设成「**引导监督模式**」：带他走完流程、看住每一步别被跳过；
   但**不把"关键决定必须自己拍板"当门槛** —— 本阶段是**学习过程，不是考察过程**，
   他拿不准时模型可以直接给建议甚至替他定。见 FRAMEWORK §3.5 第 8 件。）
3. **题目必须应用驱动**：有真实业务需求 + 达标线，而不是"练某个 API"。
   学生做的是"解决一个具体问题"，模型只是他选用的工具。
4. **学生带得走**：实验结束后，学生手里是一套可迁移的流程
   （看懂需求 → 看数据 → 定基线 → 训练 → 评估 → 写结论），而不是某个库的用法。

> 一句话：**我们要交付的不是一个能跑的 skill，而是一次完整的思考经历。**

> ⚠️ **别把"一系列实验"读成"一个实验只练一个技术点"**（2026-11 实测教训，同 FRAMEWORK §2.6）：
> 我们确实按任务类型分了几个实验（回归 / 二分类 / 多分类 / 深度学习……），但那是**多个实验之间**的
> 切分维度。**单个实验内部不是"练一类决策"** —— 它是一个**完整的小应用**：学生在这个应用里做
> **技术选型**（用什么模型、要不要预处理、看哪个指标）并说清理由，走完六步。
> 写实验定位时就写"这个应用要解决什么、数据长什么样、达标要求是什么"，**不要**写成"练 xxx 技术点" ——
> 后者会把六步链条断裂成"某个技术点的练习"。

---

## 1. 设计思路：从需求推导出题目的顺序（顺序不能反）

九步，**每一步都为后一步服务**；写材料是最后的事，想清楚需求才是第一件事。

| 序 | 做什么 | 关键要求 |
| --- | --- | --- |
| 1 | **定应用需求** | 谁遇到什么问题、现在怎么做、怎样算解决。场景要**通用直观、零领域门槛**（医学院学生也能懂），避免"分子医学"这种需要专业背景的题 |
| 2 | **翻译成达标线** | 业务语言 → 可计算的指标 + 数值门槛（例如"比现有做法好 20%" → `mae ≤ 0.8 × baseline.mae`） |
| 3 | **造数据** | 固定种子；有**真实相关性 + 噪声**；不均衡度要适中（既不平凡也不至于学不动） |
| 4 | **定基线** | "什么都不做 / 沿用现有做法"的成绩，写进题干与 `expected.json`，学生要自己算出来 |
| 5 | **写参考实现** | 自己先**走完六步**：证明题目可解、给出参考水平、产出两张图。它随题目包下发（`problem/reference/`），是学生"先读后仿"的示范 |
| 6 | **设计防退化** | 把两个偷懒解都堵死（见 §3.4）：一端是"不建模"，另一端是"全都判成同一类" |
| 7 | **分层写判据** | 能写死的事实 → `manifest.assertions`（代码判）；主观的"是否看懂" → `judge.md`（LLM 判） |
| 8 | **写题干与骨架** | 题干 = 需求文档（业务背景 + 六步 + 交付格式）；骨架只留 TODO，不要给答案 |
| 9 | **自检与发布** | `--check` → 参考实现复验 → 打包 → 平台绑定 |

**顺序不能反的原因**：如果先写代码再想需求，题目会退化成"技术点练习"，学生学到的只是
"这个 API 怎么调"。反过来，从需求出发时，"用哪个模型"自然变成学生要自己做的判断。

---

## 2. 十一步照做（含命令与检查点）

以 `<fx>` 表示实验目录名（例如 `aq-forecast`），全部在 `server/fixtures/<fx>/` 下。

### 步骤 1 · 建目录骨架

```sh
server/fixtures/<fx>/
  README.md                 # 实验说明 + 实测记录（对外）
  tools/gen_data.py         # 造数据 + 标定（可复现，固定种子）
  problem/                  # 题目包（下发给学生）
    task.md                 #   业务需求 + 六步流程 + 交付格式
    manifest.json           #   判据（硬性 assertions）
    judge.md                #   语义判据（LLM）
    README.md               #   包内说明（怎么自测）
    cases/caseNN/data.csv   #   若干 case（2 个足够：不同规模/不同种子）
    cases/caseNN/expected.json
    reference/              #   ✅ 参考实现（走完六步的示范）
      SKILL.md
      scripts/train.py
  skill-template/           # 起点骨架（下发给学生）
    SKILL.md                #   能力边界 / 实测档案（学生要补）
    scripts/train.py        #   只留 TODO
```

### 步骤 2 · 写 `tools/gen_data.py`（造数据）

要点：固定 `seed`；真实但不过分的相关性；加入噪声；**类别不均衡度要标定**。
生成后打印关键统计（行数、均值/分布、正类占比），方便肉眼判断是否平凡。

### 步骤 3 · 定 case（2 个为宜）

两个 case 用不同种子/规模（例如 600 行与 420 行），让"方案要普适"这件事真的被检验到。
平台会对**每个 case 各判一次**。

### 步骤 4 · 写 `problem/reference/scripts/train.py`（参考实现 = 六步示范）

必须真的走完六步，且 **② 与 ⑤ 各出一张图**：

```python
matplotlib.use("Agg")                    # 容器内无显示环境
def plot_data_overview(df, fig_dir): ...  # ② 分布 / 特征与目标关系 / 类别是否均衡
def build_baseline(...): ...              # ③ 不做模型能做到多少
def train_model(...): ...                 # ④ 一个能讲清楚的模型
def plot_evaluation(y_true, pred, fig_dir): ...  # ⑤ 回归:预测vs实际+残差；分类:混淆矩阵
def train_and_evaluate(...): ...          # 串起来，返回 dict
def run_case(case_dir, out_path): ...      # 单 case
def regen_expected(): ...                  # 重算 cases/*/expected.json（图写临时目录）
```

**硬性要求**：

- 图存 `<工作目录>/figures/`，返回 `{"path": ..., "takeaway": "一句话结论"}`；
- **图上的标题与坐标轴标签用英文** —— 镜像里没有中文字体，中文会渲染成方框；
- `takeaway` 里引用的数字**必须与 `metrics` 自洽**（实测被 judge 抓出来过：写了"名单 81 人"，
  但按 `precision` 算应是 69 人 → 判"与 metrics 矛盾"）；
- `--regen-expected` 必须在**与复验同一个镜像**里跑（否则离线依赖版本差异会导致期望值漂移）。

### 步骤 5 · 生成 `expected.json`

```sh
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD/server/fixtures/<fx>:/w" \
  --entrypoint python3 nju-lab-verify:0.2.0-rc.2-pkg5 \
  /w/problem/reference/scripts/train.py --regen-expected
```

`expected.json` 里放 4 类东西：`n_rows`（核对切分覆盖）、`baseline`（核对学生的基线是否可信）、
`reference`（识别"可疑地过于好"）、`accept`（达标线与容差）。

### 步骤 6 · 写 `problem/manifest.json`（硬性判据）

```json
{
  "schemaVersion": 1,
  "name": "<fx>",
  "title": "应用实验：……",
  "outputFile": "output.json",
  "inputs": ["data.csv"],
  "judgeMode": "llm",
  "maxCases": 0,
  "assertions": [ { "name": "……", "expr": "……" } ]
}
```

`maxCases: 0` = 跑全部 case。`expr` 是 JS 表达式，可用 `out`（学生产出）与 `expected`（期望值），
支持 `abs` / `min` / `max` / `round`；**求值必须严格为 `true`**，任一不成立即 fail 并不再交给 LLM。

**参考实验的 8 条断言**（新实验照抄这组骨架，按需增删）：字段完整（含 `figures`）→
图表说明齐全（≥2 张，每张 `path` + ≥10 字 `takeaway`）→ 指标与基线为正 → 切分覆盖全部样本 →
测试集占比 20%~40% → 基线可信（±容差）→ **达标线** → `notes` 有实质内容（≥20 字）。

### 步骤 7 · 写 `problem/judge.md`（语义判据）

只写**代码判不了**的事，通常是四项：`figures`/`notes` 是否"看图说话"、结果是否自洽、
是否"可疑地过于好"、基线定义是否可信。每条给出**通过 / 不通过**的判法，用反例收口（"空洞小结、
与 `model` 字段矛盾、只是复述题目 → 不通过"）。

> ⚠️ **不要把数值达标线写进 `judge.md`** —— 实测教训：把 `MAE ≤ 0.8×基线` 写成语义项时，
> 同一个"不建模"的产出被 LLM 判**通过**。数字必须由 `assertions` 判。

### 步骤 8 · 写 `problem/task.md`（题干 = 需求文档）

结构：业务背景（含"现有做法"）→ 你的任务（几条达标要求，业务语言）→ **六步流程表**
（每步产出落在报告哪个字段）→ 数据字典 → 交付格式（`output.json` 样例）→ 怎么算完成。

**六步固定为**：① 看清需求 → ② **看一眼数据（并画图）** → ③ 定基线 → ④ **训练模型**
（不要求多方案对比）→ ⑤ **评估（并画图）** → ⑥ 写结论。

### 步骤 9 · 写 `skill-template/`（起点骨架）

`scripts/train.py` 只留两处 TODO（读数据 + 串联流程），其余靠学生自己写；
`SKILL.md` 留"能力边界""实测档案"等由学生填写的段落，并在开头给他**六步流程**与材料导航。

### 步骤 10 · 打包 + 自检 + 复验

```sh
cd server/fixtures/<fx>
(cd problem && zip -qr ../problem.zip .) && (cd skill-template && zip -qr ../skill-template.zip .)

# ① 包结构自检（断言条数 / 依赖可用性），几秒完成
docker run --rm -v "$PWD:/p:ro" nju-lab-verify:0.2.0-rc.2-pkg5 \
  --check --skill /p/skill-template.zip --problem /p/problem.zip

# ② 参考实现复验：必须 2/2 通过（这一步证明"题目可解 + 判据不误杀"）
cd /home/ubuntu/nju-lab && mkdir -p .verify-scratch/out
docker run --rm --env-file server/.env --memory 2g -e VERIFY_REASONING_EFFORT=low \
  -v "$PWD/server/fixtures/<fx>:/p:ro" -v "$PWD/.verify-scratch/out:/outputs" \
  nju-lab-verify:0.2.0-rc.2-pkg5 --skill /p/problem/reference --problem /p/problem.zip \
  --out /outputs/<fx>.json --timeout-ms 300000
```

复验结果读 `<fx>.json`：看每个 case 的 `judge.pass`、`hardChecks.failed`、`judge.rationale`。
**不通过时先看 rationale** —— 它指向的往往是自己示范或判据里的真问题（实测抓出过一次算式错误）。

### 步骤 11 · 发布到平台

```sh
# 登录拿 token
TOKEN=$(curl -s -X POST http://127.0.0.1:3100/api/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"teacher","password":"teacher123"}' | python3 -c 'import json,sys;print(json.load(sys.stdin)["data"]["accessToken"])')

# 上传两个包（各返回 data.fileId），再建项目并绑定（chapterId 决定学生在哪里看到它）
curl -s -X POST http://127.0.0.1:3100/api/files -H "Authorization: Bearer $TOKEN" -F "file=@problem.zip"
curl -s -X POST http://127.0.0.1:3100/api/files -H "Authorization: Bearer $TOKEN" -F "file=@skill-template.zip"
curl -s -X POST http://127.0.0.1:3100/api/projects -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"title":"...","chapterId":"...","skillTemplateFileId":"...","problemFileId":"...","description":"..."}'
curl -s -X POST http://127.0.0.1:3100/api/projects/<id>/publish -H "Authorization: Bearer $TOKEN"
# 后续调整用 PATCH /api/projects/<id>（title/objectives/background/description/evalConfig/rubric/... 全部可选）
```

`description` 建议逐条重复六步并注明 **② ⑤ 要画图**；`objectives` / `background` 用学生看得懂的大白话。

---

## 3. 判据怎么设计（最容易做错的地方）

### 3.1 分层

| 层 | 落点 | 判什么 | 谁判 |
| --- | --- | --- | --- |
| 硬性 | `manifest.assertions` | 能写死的事实与数值门槛 | 代码（确定性） |
| 语义 | `judge.md` | 是否看懂、是否自洽、是否"可疑地过于好" | LLM |

### 3.2 硬性判据的写法

一条断言只判一件事，名字写清"判什么"，`expr` 里同时给出**通过条件**。
数值门槛一律用 `expected.accept.*`，不要在表达式里写死数字（换 case 才能复用）。

### 3.3 语义判据的写法

用"反例收口"：不只是说"应该具体"，还要说"什么样算不通过"（空洞、复述题目、与字段矛盾）。
judge 的 `max_tokens` 已调到 2048 并有短 JSON 重试 —— 别把判据写成长篇大论。

### 3.4 防退化：每个实验都要卡两端

| 实验 | 偷懒解 A（不建模） | 偷懒解 B（全判一类） |
| --- | --- | --- |
| 回归 | 沿用上一小时 → 卡 `mae ≤ 0.8×baseline.mae` | 用均值/中位数预测 → 同上（基线可信检查 ±15% 防虚报基线） |
| 二分类·不平衡 | 全判"会来" → 卡 `recall ≥ 0.65` | 全判"失约" → 卡 `precision ≥ 0.40` |
| 多分类 | 全判多数类 → 卡 `macro_f1 ≥ 0.60` | 放弃人少的档 → 卡**每档召回 ≥ 0.50** |

设计达标线时，**先算出两个退化解的成绩**，再把线卡在中间（离参考实现留出余量）。

---

## 4. 实测踩过的坑（照抄避免重犯）

| 坑 | 现象 | 做法 |
| --- | --- | --- |
| 图里中文变方框 | 标题/轴标签渲染成 "□□□" | 镜像无中文字体 → **图的标签用英文**，中文写在 `takeaway` / `notes` |
| 数值线写进语义判据 | "不建模"的产出被判**通过** | 达标线一律进 `assertions`（见 §3.3） |
| "负样本"用脚本构造 | 期望判 fail，实际判 pass —— 因为 agent 照 `task.md` 自己写出了达标模型 | **从判据侧验证**：把达标线收紧（如 0.8→0.1），看断言是否真的 fail、rationale 是否指明哪条不成立 |
| `takeaway` 与 `metrics` 不一致 | 被判"与 metrics 矛盾"而不通过 | 图里的数字**直接从同一来源算**（如混淆矩阵 `ravel()`），不要另写公式 |
| 多方案比较时的选优 | 选中年"未收敛"的方案（成绩高是假象） | 已按用户要求**取消多方案要求**；若将来恢复，务必先排除未收敛方案 |
| 数据太平凡/太难 | 参考实现 recall 只有 0.61，或任务一次就满分 | 反复标定：不均衡度、噪声、特征区分度都要调到"学生努力能达到" |
| judge 输出被截断 | `judge output not parseable` | `max_tokens` 提到 2048 + 重试时要求短 JSON（驱动已内置） |
| expected 漂移 | 期望值与复验对不上 | `--regen-expected` 必须用**同一个镜像版本** |
| 引导指令污染复验 | 复验的 agent 拒写代码 / 只引导不干活 | `nju-lab-client` 只装学生端；verify profile 不装它 |
| 环境类坑 | 沙箱不能 sudo / `zip`、`unzip` 需自装 / `node:22.x-slim` 拉不到 / L2 测试必须带 `DSH_BIN` | 见 [`UPGRADE-playbook.md`](UPGRADE-playbook.md) §4 |

---

## 5. 发布前检查清单

- [ ] `--check` 通过（`assertions` 条数符合预期、`dependencyCheck.ok` 为真）
- [ ] 参考实现复验 **2/2 通过**，且 `hardChecks.failed` 为空、`rationale` 无"矛盾"类问题
- [ ] `expected.json` 由**同版本镜像**生成
- [ ] 断言覆盖：字段完整（含 `figures`）、图说明齐全、指标为正、切分覆盖、测试集占比、
      基线可信、**达标线**、`notes` 有实质内容
- [ ] **防退化**：两个偷懒解都过不了（算过或测过）
- [ ] 题干六步齐全、每步都指到报告字段；交付格式与断言一致
- [ ] 图标签为英文；`takeaway` 的数字与 `metrics` 自洽
- [ ] 骨架只留 TODO；`SKILL.md` 有填写指引与材料导航
- [ ] `README.md` 补上本次实测记录（含日期与实测数值）
- [ ] 平台：两个包已上传并绑定、`description` / `objectives` / `background` 是新版、已 publish
- [ ] 提交并 push 到 `origin`（先提交再 push；不要提交他人未跟踪的文件如 `3.sh`）

---

## 6. 三个既有实验的设计对照（照着挑一个模式）

| | A `aq-forecast` | B `noshow-predict` | C `customer-tier` |
| --- | --- | --- | --- |
| 任务类型 | 回归 | 二分类（不平衡） | 多分类 |
| 应用场景 | 估算下一小时 PM2.5 | 门诊预约失约预测 | 会员价值分级（低/中/高） |
| 达标线 | `mae ≤ 0.8 × baseline.mae` | `recall ≥ 0.65` 且 `precision ≥ 0.40` | `macro_f1 ≥ 0.60` 且每档召回 `≥ 0.50` |
| 防退化 | 不建模过不了 | 全判"会来"/全判"失约"都过不了 | 全判多数类/放弃某档都过不了 |
| ② 看数据图 | 目标分布 + 滞后项散点 | 类别计数 + 风险因素分箱 | 三档占比 + 特征箱线图 |
| ⑤ 评估图 | 预测 vs 实际 + 残差 | 混淆矩阵（2×2） | 3×3 混淆矩阵 + 逐档召回 |
| 断言条数 | 8 | 10 | 10 |
| 参考实现成绩 | MAE 3.56 / 4.75 | recall 0.73 / 0.76 | macro F1 0.78 / 0.68 |

> **深度学习章**（`dl-train-diagnose` 训练诊断 / `dl-cnn-images` 卷积结构 / `dl-rnn-forecast` 序列建模）
> 也遵循同一套流程与判据形态（各 13 条断言，`schemaVersion: 1`）—— 换的只是领域与数据，
> "应用需求 → 六步 → 判据分层"这条链子不变。这正说明**方法论是稳定的**，新实验照着这套走即可。

**怎么选**：新的实验优先考虑"和上面三个**不重复的任务类型或指标视角**"（例如聚类、异常检测、
时间序列预测），但**只要沿用同一套六步流程与判据分层**，学生就能把已有的思路迁移过去 ——
这正是我们做这一系列实验的目的。
