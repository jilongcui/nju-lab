# 实验包规范（老师向）

> 面向出题教师：**做一次实验要准备什么、每份材料长什么样、怎么自检、怎么上线**。
> 实现与运行态细节见 `server/verify-image/README.md`；平台为什么这么设计见本文 §6。
>
> 本文只讲**材料格式**。要设计一个新实验的完整流程（目标怎么定、题干怎么写、判分口径怎么设计、
> 成绩怎么算），先看 **`docs/EXPERIMENT-DESIGN-FRAMEWORK.md`**。
>
> 一句话：**题目与评分口径随「题目包」走，执行与判分口径由平台钉死** ——
> 新增一个实验类型不需要改平台代码、不需要重建镜像。

## 1. 一个实验项目 = 题目包 + Skill 两态

| 材料 | 谁看 | 作用 |
|---|---|---|
| **题目包 ZIP**（仓库里叫 `problem/` → `problem.zip`） | 学生（claim 时下载）+ 复验容器（只读挂载） | **标准**：题面（`task.md`）、评分细则（`judge.md`）、IO 契约（`manifest.json`）、用例（`cases/`：输入 + 期望输出） |
| **Skill 模板 ZIP**（`skill-template/` → `skill-template.zip`） | 学生（claim 时下载） | **起点**：`SKILL.md` 骨架 + `scripts/` + `references/`，关键处留 TODO |
| **满配 Skill**（`skill-solution/`） | 只有教师 | **答案**：与模板同构但填满；不打包、不下发 |

上传两个 ZIP 各拿一个 `fileId`，在「项目详情 → 编辑项目信息」里分别绑到
**Skill 模板** 与 **标准测试数据集** 两个文件位（后者沿用平台旧称，见下面的命名说明）。
发布项目后学生即可按解锁规则领取。

### 命名说明：为什么"数据集包"里装着题干与判据

历史上题目与判据**写死在驱动里**，那时的"数据集包"真的只有 `cases/*`（纯数据）。
2026-10-01 改成包驱动后，题面/判据/契约被搬进同一个 ZIP（复用已有上传位，零迁移），
这个包于是变成了**一整份考卷**（题干 + 答案 + 评分标准 + 测试数据），名字却留了下来。

因此：**仓库里统一叫 `problem/`（题目包）与 `problem.zip`**；
平台文件位、驱动内部变量名、客户端文案仍是历史称法（"标准测试数据集" / `dataset.zip` /
`testDataset`）—— 指的是同一件东西。

> 题目包会**下发给学生**（用于本地自测），所以：`expected.*`、`judge.md`、`task.md`
> 都可以放（评分标准公开是教学设计）；**满配 Skill / 参考实现不要放**（放进去等于泄题）。

## 2. Skill 模板 ZIP（学生起点）

```
skill-template/          ← 可以包一层顶层目录，但只允许一层
  SKILL.md               ← 必需：含 SKILL.md 的那一层就是「Skill 根」
  scripts/*.py           ← 学生实现；运行时是容器里的 python3（依赖见 §4）
  references/*.md
```

同目录下还有一个**满配 Skill** `skill-solution/`（本题标准答案）：形态与模板完全一致，
只是 TODO 全填满。它**不打包、不下发**，但可以被复验直接当 Skill 装入 ——
跑通即"题目可解性 + 模板契约可行"的机器证明（命令见各示例项目 README）。

硬性要求：

1. **必须能唯一定位到一层 `SKILL.md`**（根目录，或唯一子目录里）。否则学生端领取解压、
   学生提交自检、平台复验三处都会报 `no unique SKILL.md layer`。
2. 模板里的 `TODO` 是**故意留的**：平台会扫 `SKILL.md` 的 `## 能力边界…` 小节
   （非空且不含 `TODO` 才算填写）与踩坑记录条数，这两项进复验产物 `skillInfo`，
   是 rubric 里「能力边界填写质量」等维度的依据。所以模板要保留这两节的标题结构。
3. 打包：zip 根即 `SKILL.md`（`cd skill-template && zip -qr ../skill-template.zip .`）。

## 3. 题目包 ZIP（题面 + 判据 + 用例）

```
problem/
  manifest.json    ← 可选（不写则完全按内置「CSV 清洗」语义跑，见 §5）
  task.md          ← 可选：题干，被测 agent 看到的任务描述
  judge.md         ← 可选：评分细则，LLM judge 的判据
  README.md        ← 给人看（会下发给学生）
  cases/case01/{input.csv, expected.json}
  cases/case02/…
```

> 复验时这个包只读挂载给驱动：`cases/*/input.*` 会被拷进 agent 的工作目录，
> 而 `expected.*` 与 `judge.md` 只用于判分 —— **agent 看不到答案**。

### 3.1 `cases/` 的约定

- 每 `case0N/` 一个用例；case 名按字典序执行（`--max-cases N` 可截前 N 个）。
- **输入**：`manifest.inputs` 列出的文件（相对 case 目录）；不写 `inputs` 时，
  默认取该 case 目录下**除 `expected.*` 之外的全部条目**（支持多输入与子目录）。
- **期望产出**：`expected.<扩展名与 outputFile 相同>`，或目录下唯一的 `expected.*`。

### 3.2 `manifest.json`

```json
{
  "schemaVersion": 1,
  "name": "sales-report",
  "title": "销售数据汇总报告",
  "outputFile": "output.json",
  "inputs": ["input.csv"],
  "judgeMode": "llm",
  "maxCases": 0,
  "requires": { "python": ["pandas"], "commands": [] }
}
```

| 字段 | 默认 | 说明 |
|---|---|---|
| `outputFile` | `output.csv` | 被测 agent 要产出的文件（相对工作目录，不得越界）；`exact` 模式按它比对 |
| `inputs` | 全部非 `expected.*` | 相对 case 目录的路径列表 |
| `judgeMode` | `llm` | `llm`（LLM judge，推荐）或 `exact`（归一化后逐字节比对，适合输出高度确定的任务） |
| `maxCases` | `0`=全部 | 成本控制；项目级 `evalConfig.maxCases` 优先级更高 |
| `requires` | `{}` | **声明任务要用的运行时依赖**（见 §4）；`python` 写模块名，`commands` 写命令名 |

优先级：**命令行（平台项目配置）> 包内 manifest > 内置默认**。

### 3.3 `task.md`（题干）

- 这是 **复验唯一的事实源** —— 写得自包含：数据在哪、要产出什么文件、口径是什么。
  学生拿到的题目包（`problem.zip`）与复验用的是同一份材料，题干含糊 = 判分口径含糊。
- 占位符：`{{input}}`（第一个输入文件名）、`{{inputs}}`（逗号分隔）、`{{output}}`、`{{skill}}`（= `./skill`）。
- 若正文里没出现 `outputFile`，驱动会自动补一句「把结果写到 …」；另外会自动附一句
  「Skill 已在 `./skill`，优先使用它」—— 你不必自己写这两句。

### 3.4 `judge.md`（评分细则）

- 平台提供**固定的判分外壳**（必须输出 `{"pass","score","rationale"}`；行尾空白/CRLF 不扣分，
  其余差异都扣分），你写的细则填进外壳。
- 细则要写清：字段/键名约束、数值容差、并列与缺省的处理、什么算「部分正确」（score）。
- 判分口径与 `expected.*` 必须一致：**改口就要三处一起改**（`task.md`、`judge.md`、参考实现/expected）。

## 4. 依赖：镜像预装集 + 包内声明自检

复验容器在 `--internal` 网络里、**没有外网**，镜像层只读 —— 容器内 `pip install` 不可能成功。
所以运行时依赖**必须预装在镜像里**，你在包内声明，驱动在跑之前自检：

```json
{ "requires": { "python": ["pandas", "numpy"], "commands": ["jq"] } }
```

- `python` 写 **import 名**（`yaml`、`bs4`、`dateutil`）；也认常见 pip 包名
  （`PyYAML`、`beautifulsoup4`、`python-dateutil`、`Pillow`、`scikit-learn`），
  两种写法都行 —— 免得"库明明装了却报依赖缺失"。版本约束可写（`pandas>=2.0`），
  但只校验**是否存在**，版本以镜像预装集为准。
- `commands` 写命令行可执行名（如 `jq`）。
- 自检通过 → 正常复验，结果 JSON 里带 `dependencyCheck`。
- 自检失败 → **直接失败并明确报错**（不会跑到一半才发现脚本 ImportError）。

当前镜像 `nju-lab-verify:0.2.0-rc.2-pkg3` 的预装集（`python3` + 系统命令）：

| 类别 | 内容 |
|---|---|
| 表格/数值 | `pandas` `numpy` `openpyxl` `python-dateutil` |
| 文本/网页/配置 | `requests` `beautifulsoup4` `lxml` `PyYAML` |
| 传统机器学习 | `scikit-learn`（含 `scipy`）`statsmodels` |
| 深度学习 | `torch`（**CPU 版** `2.14.1+cpu` —— 平台无 GPU，镜像里不含 CUDA） |
| 出图 | `matplotlib` |
| 测试与展示 | `pytest` `tabulate` |
| 系统命令 | `python3`（含标准库）`jq` `unzip` `zstd` |
| 其他 | Node 22 + dsh（平台运行时，勿依赖） |

⚠️ **ML 类实验要留意资源**：`torch` 装完约 800MB，镜像整体 ~2.3GB；容器默认
`VERIFY_DOCKER_MEMORY=1g / cpus=1`（见 `server/.env.example`），CPU 上跑训练会慢且可能 OOM ——
建议 ML 实验把该值调到 `2g`（njuserver 内存充足；本机内存紧张，慎调）。

需要新库 → 找平台维护者改 `server/verify-image/Dockerfile` 的「预装依赖集」并重建镜像
（一学期一两次，可接受）；**不要**指望容器联网装包（容器在 `--internal` 网络里没有外网）。

## 5. 不写 manifest 会怎样

完全按内置的「CSV 数据清洗」语义跑：输入 `input.csv`、输出 `output.csv`、
题干与细则取内置常量、判分 `llm`。这是历史数据集（`server/fixtures/csv-cleaner/problem/`）的行为，
现在还逐字保留 —— 老包不用改。

## 6. 为什么"新增实验类型不用改代码"（设计边界）

| 内容 | 归属 | 理由 |
|---|---|---|
| 题目、评分细则、IO 约定、用例、模板 | **你的包** | 出题与评分标准本就该由教师定 |
| dsh 版本、verify profile（approval=never）、容器网络白名单、工具面收窄、token 统计、逐用例复验（题干 + 学生 Skill 一轮；baseline 轮已于 2026-10-06 取消） | **平台（镜像）** | 这是**裁判程序**：能改它就能绕过评测条件 |
| Python/系统依赖 | **平台（镜像）** | 容器无外网、镜像只读，装包只能在构建期 |

即：**裁判的外壳由平台钉死，题目与判据由你提供**。包驱动的价值是让你加实验类型时
零平台动作。

## 7. 上线流程（含上传前自检）

```sh
# 0) 目录组织见 §2/§3；打包
cd server/fixtures/sales-report
rm -f skill-template.zip problem.zip
(cd skill-template && zip -qr ../skill-template.zip .)
(cd problem        && zip -qr ../problem.zip .)

# 1) 上传前自检（不跑模型、不烧 token）：结构 + 依赖
docker run --rm -v "$PWD:/p:ro" nju-lab-verify:0.2.0-rc.2-pkg3 \
  --check --skill /p/skill-template.zip --dataset /p/problem.zip

# 1b) 教师侧自检闭环：拿满配 Skill 跑一遍复验（应全部通过 = 题目可解）
docker run --rm --env-file server/.env -v "$PWD:/p:ro" -v /tmp/out:/outputs \
  nju-lab-verify:0.2.0-rc.2-pkg3 \
  --skill /p/skill-solution --dataset /p/problem.zip --out /outputs/result.json

# 2) 上传拿 fileId（教师 token）
TOKEN=$(curl -s http://127.0.0.1:3100/api/auth/login -X POST \
  -H 'Content-Type: application/json' \
  -d '{"username":"teacher","password":"teacher123"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["accessToken"])')
curl -s http://127.0.0.1:3100/api/files -X POST -H "Authorization: Bearer $TOKEN" -F "file=@skill-template.zip"
curl -s http://127.0.0.1:3100/api/files -X POST -H "Authorization: Bearer $TOKEN" -F "file=@problem.zip"

# 3) 平台里：项目详情 → 编辑 → 绑定两个 fileId → 发布
# 4) 建议先用一个测试学生账号领取 + 提交一次，跑通「提交 → 复验 → 批改」再放开给全班
```

参考示例：`server/fixtures/` 下三个示例项目，结构统一（`problem/` + `skill-template/` +
`skill-solution/`）：`csv-cleaner` 最简（内置回落型）、`sales-report` 最典型、
`ml-basics` 另带 `tools/` 造题工具。抽象说明见 `server/fixtures/README.md`。

## 8. 自查清单

- [ ] 模板能唯一定位到一层 `SKILL.md`；`SKILL.md` 有「能力边界」与「实测档案/踩坑记录」小节结构
- [ ] `cases/*/` 的输入与 `expected.*` 齐全；`expected` 用满配 Skill 算出并**独立复核**过
- [ ] `task.md` 自包含（不看 Skill 也能照做），口径与 `judge.md`、`expected` 完全一致
- [ ] `manifest.json` 的 `outputFile` 与 `task.md`/`expected` 一致；`requires` 列的库在 §4 预装集内
- [ ] `docker run … --check` 通过（退出码 0）
- [ ] 满配 Skill 跑复验**全部通过**（`--skill skill-solution`）——否则题目本身不可解
- [ ] 题目包内**没有**满配 Skill / 参考实现（它会被下发给学生）
- [ ] 改口径时：`task.md` / `judge.md` / 满配 Skill 三处同步 + 重算 `expected` + 重新打包上传（新 fileId 即新版本）
