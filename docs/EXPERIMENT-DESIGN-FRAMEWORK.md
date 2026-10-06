# 实验设计框架（教师向）

> 从"想让学生练什么"到"成绩怎么算"的完整流程，用于**设计一个新实验**。
> 三份文档的分工：
>
> | 文档 | 回答什么 | 读者 |
> |---|---|---|
> | **本文** | 一个实验怎么设计（目标 / 任务 / 材料 / 过程 / 评判 / 上线） | 出题教师 |
> | `docs/EXPERIMENT-PACKAGE-SPEC.md` | 上传的包**技术格式**（manifest 字段、cases 约定、依赖预装集） | 出题教师 |
> | `HANDOFF.md` | 平台运行态、镜像 tag、部署与回滚 | 平台维护者 |
>
> 可直接复制的骨架：`server/fixtures/ml-basics/`（ML 类）、`server/fixtures/sales-report/`（表格类）、
> `server/fixtures/csv-cleaner/`（最简，内置回落型）。

---

## 0. 一个实验的五要素

```
① 实验目的  →  ② 任务与口径  →  ③ 材料（两个 ZIP）  →  ④ 学生过程  →  ⑤ 评判
   （能力点）      （可复现）        （模板 + 数据集）      （领取→自测→提交）   （机器 + 教师）
```

关键前提：**平台的评判建立在"同一任务，用 Skill 与不用 Skill 各跑一遍"的对比上**。
所以每个要素都要能被机器观测到 —— 这是本框架与普通实验指导书最大的区别。

---

## 1. ① 实验目的：写成"平台能测到的东西"

实验目的不能只写"掌握机器学习基本流程"，要落到平台真实产出的信号上。可用信号只有五个：

| 平台信号 | 来源 | 说明 |
|---|---|---|
| **复验成功率** | treatment 轮逐 case 判定 | 用学生的 Skill 跑测试集，通过比例（0~1） |
| **lift（提升量）** | treatment 成功率 − baseline 成功率 | "有了这个 Skill 到底强多少" |
| **证据一致性** | `.dshc` 证据包 + 逐文件 sha256 | 学生自报哈希 vs 平台容器内实测哈希 |
| **能力边界填写质量** | 扫 `SKILL.md` 的 `## 能力边界…` 小节（非空且无 `TODO`） | 布尔值 |
| **踩坑记录条数** | 扫 `SKILL.md` 的踩坑列表项 | 整数 |

**写法对照**

| 弱（测不到） | 强（落到信号） |
|---|---|
| 掌握逻辑回归的用法 | 在给定切分口径下复现指标（成功率 ≥ 2/3）；能说明模型不适用的情况（能力边界） |
| 熟悉数据清洗 | 3 个含脏数据的用例清洗后与期望输出一致；记录至少 2 条真实踩坑 |
| 了解 Skill 规范 | Skill 目录结构合规、可被平台装入并在 treatment 轮跑通（成功率 > baseline） |

> 每个实验建议只设 **2~3 个能力点**。能力点越多，题干越长、判分越糊。

---

## 2. ② 任务与口径：可复现是第一原则

### 2.1 口径必须钉死三件事

| 要素 | 必须写清 | 反例（会让学生与 baseline 各做各的） |
|---|---|---|
| **输入** | 文件名、列/字段含义、编码 | "给定一批销售数据" |
| **处理规则** | 每一步的判定与优先级 | "合理清洗一下" |
| **输出格式** | 文件名、结构、键名、精度 | "输出一个报告" |

参考 `server/fixtures/ml-basics/dataset/task.md`：它把切分函数、`random_state`、指标名、四舍五入位数全写死，
所以同一份输入任何人跑都得到同一个期望值。

### 2.2 `task.md` 必须自包含（这条最容易被忽略）

复验会跑**两轮**：

```
baseline   ：只给题干 + 输入文件，模型裸做   ← 用来衡量"没有 Skill 时的水平"
treatment  ：题干 + 输入文件 + 学生的 Skill  ← 学生的交付物
```

baseline 轮**看不到你的 Skill**。所以题干里少写一条口径，baseline 就变弱 → lift 虚高 → 这个实验的
"提升量"就不再有意义。**把口径全部写进 `task.md`，不要藏进模板。**

### 2.3 用例（cases）设计

每个 `cases/<case0N>/` 放 `input.*` + `expected.*`。建议 3 个档位：

| 档位 | 作用 | 例子 |
|---|---|---|
| **基础** | 常规路径，确认学生真的实现了 | 三地区三产品的正常汇总 |
| **边界** | 口径中的特例 | `units=0` 的行、并列的"冠军产品"（取码点序最小者） |
| **陷阱** | 最容易被想当然做错的地方 | 类别不平衡时需要 `class_weight="balanced"`；切分要带 `stratify` |

两条硬要求：

1. **指标不要是满分**。若期望值恰好 1.0 / 100%，那么"没做好"也会碰巧全对，实验失去区分度。
   实例：`ml-basics` 的三个 case 期望 acc 为 0.90 / 0.92、R² 为 0.9861。
2. **`expected.*` 用参考实现算出来，并在与复验同一个镜像里算**。
   数值受库版本影响（sklearn 主版本变了，指标会变），`ml-basics` 的做法是：
   ```sh
   docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/w" --entrypoint python3 \
     nju-lab-verify:0.2.0-rc.2-pkg2 /w/reference/solve.py --regen-cases
   ```

### 2.4 难度与区分度

- `lift = 0`（baseline 也全过）说明**题目对当前模型太容易**。这不一定算错（题干自包含是硬要求，
  模型能裸做对是必然代价），但如果你的教学重点就是"让学生把方法沉淀成可复用资产"，
  应当通过**更细的口径**（更多 `model_params` 组合、多指标、边界样本）来拉高难度，
  而不是把信息藏进模板。
- `lift < 0`（用 Skill 反而更差）通常说明学生的 Skill 有破坏性行为，这本身是有效的教学信号。
- 判分阈值不要写进 `judge.md` 之外的地方；`judge.md` 里明确"什么算通过"。

### 2.5 反作弊设计（注意：数据集包会下发给学生）

学生领取任务时会**下载 dataset.zip**（用于本地自测）。所以：

| 能放进包 | 不能放进包 |
|---|---|
| `task.md`（题干）、`judge.md`（评分细则）、`expected.*` | **参考实现 / 标准答案代码** |
| `README.md`、`manifest.json`、cases 输入 | 你自己写的"正确 Skill" |

`expected.*` 公开是刻意的（学生要自测），这与"开放评分标准"的教学设计一致；
但答案是**实现方法**，必须留在仓库的 `reference/` 里（该目录不打进任何 zip）。

模板里也不要有答案：`template/scripts/*.py` 只留骨架 + `TODO`，平台在 treatment 轮会把模板交给模型，
它必须自己实现。

---

## 3. ③ 材料准备：两个 ZIP

```
你的实验/
├── template/          → template.zip   交给学生当起点（也是 treatment 轮的 Skill）
│   ├── SKILL.md       ← 必需，含规定小节
│   ├── scripts/       ← 骨架，留 TODO
│   └── references/    ← 清单/规范
├── dataset/           → dataset.zip    题目 + 判据 + 用例（会下发给学生）
│   ├── manifest.json  ← 输出文件名 / 输入 / judgeMode / 依赖声明
│   ├── task.md        ← 题干（自包含）
│   ├── judge.md       ← 评分细则
│   ├── README.md
│   └── cases/case0N/{input.*, expected.*}
└── reference/         ← 教师自用，**不打包、不下发**
```

### 3.1 `SKILL.md` 的必备结构

平台会扫两个小节来产出上面第 1 节里的信号，**模板必须保留这两个标题**：

```markdown
---
name: <kebab-case 名，与目录一致>
description: <一句话说明"何时该用这个 Skill"，模型据此决定是否加载>
---

# <标题>

## 能力边界（TODO：学生补全）      ← 非空且不含 TODO 才算"填写了"
- 能处理：…
- TODO：本 Skill 不处理哪些情况？

## 使用方法
```sh
python3 scripts/xxx.py <输入> <输出>
```

## <处理/建模>口径（TODO：学生实现并在自测中验证）
1. TODO：…

## 自测
用平台下发的标准测试数据集（cases/）…

## 实测档案（TODO：学生填写，dossier）
- 自测时间：
- 用例通过率：/3
- 踩坑记录（pitfalls）：
  1.                                ← 列表项条数 = "踩坑记录条数"信号
```

> ⚠️ 扫描器看的是 `## 能力边界…` 这一节的正文**不含 `TODO` 字样**；模板里那句话本身带 `TODO`，
> 学生必须真的改写才会被计为"已填写"。

### 3.2 依赖：先查预装集，别写装不上的库

复验容器**没有外网**（`--internal` 网络 + SNI 白名单），运行时依赖必须已烘进镜像。
在 `manifest.json` 里声明，驱动开跑前会自检，缺了直接失败（不会跑到一半才 ImportError）：

```json
{ "requires": { "python": ["sklearn", "pandas", "numpy"] } }
```

当前镜像 `nju-lab-verify:0.2.0-rc.2-pkg2` 的预装集（完整清单见 `docs/EXPERIMENT-PACKAGE-SPEC.md` §4）：

```
pandas · numpy · scipy · scikit-learn · statsmodels · matplotlib · torch(CPU) · openpyxl
requests · beautifulsoup4 · lxml · PyYAML · tabulate · pytest    +  命令 jq / unzip / zstd
```

**要用的库不在里面** → 找平台维护者加进镜像并重建（一学期一两次），
或改用已有的等价库。`requires.python` 写 import 名（`sklearn`）或 pip 名（`scikit-learn`）都认。

### 3.3 上传前自检（不烧 token）

```sh
docker run --rm -v "$PWD:/p:ro" nju-lab-verify:0.2.0-rc.2-pkg2 \
  --check --skill /p/template.zip --dataset /p/dataset.zip
```

它会检查：结构（唯一 `SKILL.md` 层 / `cases/` 层）、每 case 的输入与期望文件是否齐全、
`manifest.json` 是否合法、**依赖是否都在镜像里**。退出码 2 = 不合格，报错会指出具体原因。

### 3.4 最小上手路径

```sh
cp -r server/fixtures/ml-basics server/fixtures/<你的实验名>
# 改 template/、dataset/{task.md,judge.md,manifest.json,cases}、reference/
# 重算期望值 → 打包 → --check → 上传绑定（命令见包内 README.md）
```

---

## 4. ④ 学生过程（平台会怎么跑）

```
领取 claim ─→ 本地开发 ─→ 用 cases 自测 ─→ 提交 submit ─→ 平台复验 ─→ 学生看反馈
```

| 环节 | 平台行为 | 对实验设计的要求 |
|---|---|---|
| **领取** | 校验解锁规则（默认：完成该实验所属章节之前的全部已发布章节），下发模板 + 数据集 + 评估条件（模型/推理档位/工具白名单，此后钉死不可改） | 实验挂在正确的章节下，否则解锁条件错 |
| **开发** | 学生在工作区 `nju-lab/<assignmentId>/skill/` 里改模板 | 模板目录结构不能太深（Skill 根必须是含 `SKILL.md` 的那一层） |
| **自测** | 学生拿 `cases/` 自己比对 `expected.*` | 用例要能让学生自己判断对错 → `README.md` 里给自测命令 |
| **提交** | 自检 Skill 根 → 逐文件 sha256 → 打包 ZIP → 生成 `.dshc` 证据包 → 上传；**多版本**（上限 10） | 交付物是完整 Skill 目录，不是单个文件 |
| **复验** | 一次性容器：逐 case 跑 baseline/treatment 两轮 → judge 逐 case 判定 | 容器整体超时 = `evalConfig.timeoutSeconds`（默认 600s）；**每轮 dsh 另有上限**（平台当前钉在 ≤300s/轮）；用例太多太慢要设 `maxCases` |
| **反馈** | 学生端看复验结果 + 教师评语 | `judge.md` 的 rationale 会进反馈，写清"错在哪"对学生最有用 |

**给学生的两条经验规则**（可以写进课程说明）：

1. 第一次提交前至少用**全部** cases 自测一遍 —— 复验失败会浪费一次版本额度。
2. `SKILL.md` 的"能力边界"和"踩坑记录"是评分信号，不是走过场，如实写就行（别用模板里的 TODO 占位）。

---

## 5. ⑤ 评判：三层，最终以平台复验为准

### 5.1 第一层：机器复验（客观实测）

每个 case 跑两轮，逐轮产出 `{pass, score, rationale}`。汇总口径：

| 字段 | 含义 |
|---|---|
| `successRate` | **treatment 轮**通过率（0~1）—— 判分的主指标 |
| `tokenCost` | 两轮 dsh 实测 token 之和（+ judge 的开销） |
| 逐 case 明细 | 每 case 的 pass/score/rationale/exitCode/耗时/sessionId |
| `skillInfo` | `{boundariesDocumented, pitfallsRecorded}` |
| `integrityCheck` | `capsuleHashVerified`、`selfReportVsRerun`（`consistent` / `suspicious` / `no-self-report`） |
| `package` / `dependencyCheck` | 本次用的包声明与依赖自检快照（可追溯评测口径） |

判分模式二选一（由 `manifest.judgeMode` 声明，教师可在项目里覆盖）：

| 模式 | 判法 | 适用 |
|---|---|---|
| `llm`（默认） | 平台固定的判分外壳 + 你的 `judge.md` 细则，由模型判等 | 输出有格式弹性、需要"容忍无意义差异"的任务 |
| `exact` | 归一化换行/行尾空白后逐字节比对 | 输出高度确定、期望完全精确的任务 |

`judge.md` 写法建议（模板见 `ml-basics/dataset/judge.md`）：

- 先写**键名/结构约束**（多键少键拼写不同都算不通过）
- 再写**数值容差**（例：绝对差 ≤ 0.001 视为一致）
- 最后写**判定口径**（哪些差异不扣分：键序、缩进、空白；`pass` 与 `score` 如何给）
- 不通过时要"指出具体哪个字段、期望与实际各是多少" —— 这段会出现在学生反馈里

### 5.2 第二层：平台的建议分（固定公式，供参考）

```text
建议分 = min(100,
           成功率 × 40
         + max(0, lift) × 15
         + (能力边界已填写 ? 20 : 10)
         + (证据一致 ? 10 : 5)
         + (tokenCost < 30000 ? 10 : 6))
```

- `成功率` = treatment 轮通过率（0~1）；`lift` = treatment 成功率 − baseline 成功率（0~1 的比例，
  例如 0.30 表示提升 30 个百分点，故该项最多贡献 15 分）
- 上限 100；**注意**：这是平台的固定公式，**不读你自定义的 `rubric`**。`rubric` 是给你在批改页展示、
  以及手动打分时参考的维度清单（`[{name, weight}]`），权重之和不必等于 100。
- 如果这个实验不看 token 成本，可以在 rubric 里弱化它 —— 最终分由你自己给。

### 5.3 第三层：教师评分（最终成绩）

- 批改页：看复验明细 + judge rationale + 证据一致性 → 填 `教师评分` 与 `教师评语`，
  提交后提交状态变 `graded`。
- 成绩导出：`GET /api/projects/:id/grades.csv`（学号 / 姓名 / 任务状态 / 版本 / 提交时间 /
  提交状态 / 复验成功率 / Token 成本 / 建议分 / 教师评分 / 教师评语，Excel 友好）。
- 原则（平台设计）：**学生自报仅供参考，成绩以平台复验结果为准**；`.dshc` 证据包用于印证过程真实性。

### 5.4 评判口径设计的三个取舍

| 取舍 | 建议 |
|---|---|
| 用例数量 vs 成本 | 每个 case 两轮 dsh 调用；先 `--max-cases 1` 试跑，确认口径后再放开全部 |
| 严格 vs 宽容 | 口径能写死的（键名、行数、取值集合）就写死用 `llm`；完全确定的输出才用 `exact` |
| 成功率 vs 过程分 | 成功率是客观的；"能力边界/踩坑"是过程分。两者权重在 rubric 里体现、由你手工落分 |

---

## 6. ⑥ 上线与验收

1. **打包 → `--check`**（§3.3，不烧 token）
2. **上传两个 ZIP** → 拿到 `fileId` → 项目详情里绑定（Skill 模板 / 标准测试数据集）
3. **确认项目挂对章节**（影响默认解锁规则）、填好截止时间、评分维度
4. **发布**：`draft → published` 时才为本课程学生生成任务（草稿不会派发）
5. **自测闭环**（强烈建议）：用一个测试学生账号走一遍
   `领取 → 开发 → 提交 → 复验 → 批改`，确认 judge rationale 是你能接受的措辞
6. **放开给全班**；期间用成绩导出跟进进度

### 常见故障对照

| 现象 | 多半原因 |
|---|---|
| 复验容器 `invalid skill package: no unique SKILL.md layer` | 模板 ZIP 里 `SKILL.md` 不唯一或层级不对 |
| 复验直接失败并报"依赖缺失" | `requires` 里的库不在镜像预装集 |
| 学生 claim 后**每个请求**都失败 | 项目 `evalConfig.reasoningEffort` 不是 `off/low/high/max`（教师端已限制为这四个值） |
| 学生领取时被拒 | 解锁规则：需完成该实验所属章节之前的全部**已发布**章节 |
| 复验超时 | 用例过多或单轮太慢 → 调 `evalConfig.timeoutSeconds`（容器整体）或 `maxCases` 收敛用例数 |
| treatment 通过但分数低 | 看 `skillInfo`（边界/踩坑没写）与 `tokenCost`（超过 30000 会掉 4 分） |

---

## 7. 检查表（复制到你的实验目录里逐条打勾）

**目标**
- [ ] 2~3 个能力点，每个都能对应到 §1 的信号表
- [ ] 明确"没做到"的判据（否则成功率无意义）

**任务与口径**
- [ ] `task.md` 自包含：不看 Skill 也能照着做（baseline 轮的公平性）
- [ ] 输入/处理/输出三件事全部写死（文件名、键名、精度、特例）
- [ ] 用例覆盖基础 / 边界 / 陷阱三档，期望值**不是满分**
- [ ] `expected.*` 在与复验同一个镜像里生成，并用独立方法复核过
- [ ] 包内**没有**参考实现或答案代码

**材料**
- [ ] `SKILL.md` 有 `## 能力边界…` 与踩坑记录小节，`scripts/` 只留骨架 + TODO
- [ ] `manifest.json` 的 `outputFile` / `inputs` 与 cases 实际文件一致
- [ ] `requires` 里每个库都在镜像预装集（`--check` 通过）
- [ ] `judge.md` 写清键名约束、数值容差、`pass/score` 口径

**上线**
- [ ] 项目挂对章节、截止时间已设、`rubric` 与能力点对应
- [ ] `--check` 退出码 0
- [ ] 发布前用测试学生跑通"领取→提交→复验→批改"

---

## 8. 常见坑（实测沉淀）

| 坑 | 说明 |
|---|---|
| 题干藏信息 | baseline 看不到 Skill，藏起来的信息等于没有 → lift 失真 |
| 期望值满分 | 实验失去区分度（`accuracy=1.0` 时"做错"也能对） |
| 在数据集包里放答案 | 数据集会下发给学生（`reference/` 目录不要打包） |
| 改了口径只改一处 | `task.md` / `judge.md` / 参考实现三份事实源必须同步，然后重算 `expected` |
| 复验容器要联网 | 不可能：`--internal` 网络 + SNI 白名单，只有模型 API 可达 |
| 在教师页保存项目后 `judgeMode/maxCases` 丢失 | 已修（提交时会带回）；若发现旧数据缺失，重设一次即可 |
| 中途换数据集 | `expected.*` 是评分基准，改任一 case 即新版本；不要在有学生做的时候换 |
| 推理档位填官方 API 的值 | 平台只认 `off/low/high/max`（教师端下拉已限制），填 `medium/xhigh` 等会让学生端全挂 |

---

## 9. 附：把平台能力当作"可选信号"的对照表

| 你想考查的 | 用哪个机制 | 怎么设 |
|---|---|---|
| 结果正确性 | 复验成功率 | 用例 + `expected.*` + `judge.md` |
| 方法是否比"裸做"更好 | lift | 题干自包含，让 baseline 有意义 |
| 是否能说清边界 | 能力边界扫描 | 模板保留 `## 能力边界` 小节 |
| 是否真做过实验 | 踩坑记录 + `.dshc` 证据 | 模板保留"实测档案/踩坑记录"小节 |
| 过程是否真实 | 证据一致性 | 平台自动对照自报哈希与实测哈希（无需配置） |
| 效率意识 | tokenCost | 平台自动统计；在 rubric 里体现权重 |
| 工程规范 | 教师评分 | rubric 写维度，人工落分 |
