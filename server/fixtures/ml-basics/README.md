# ml-basics —— 机器学习基础建模（包驱动 + ML 依赖）

第三个任务类型的完整示例，对应平台上那个 draft 项目「机器学习基础模型构建与运行」。
用来演示**依赖 ML 库**的实验项目怎么写（与 `csv-cleaner`、`sales-report` 并列）。

## 目录结构（实验项目的四块 + 教师工具）

```
ml-basics/
├── problem/            → problem.zip        题目包（**随包下发给学生**）
│   ├── manifest.json   IO 契约（outputFile=output.json；requires=[sklearn,pandas,numpy]）
│   ├── task.md         题干（切分口径、指标、输出结构全写死 → 结果可复现）
│   ├── judge.md        判据（键名 + 数值容差 + 混淆矩阵结构）
│   ├── README.md       导学（学什么 / 怎么走 / 包内有什么）
│   ├── cases/case0N/{input.csv, params.json, expected.json}
│   └── reference/      **参考实现（学习示范）** —— 随包下发，学生"先读后仿"
│       ├── SKILL.md  scripts/train.py       （函数划分与骨架对齐；`--regen-cases` 重算期望值）
├── skill-template/     → skill-template.zip 学生起点：SKILL.md（原理 + 示例 + TODO）+ scripts/
├── tools/gen_cases.py                       教师工具：固定种子生成用例输入（**不下发**）
└── README.md
```

两块的关系（教学向）：

- **`problem/`** 是"标准 + 示范"：`task.md`（要按什么做）、`judge.md`（怎么算对）、`cases/`（用例与期望值）、
  `reference/`（一份写完的示范实现）。三者同版本、一起下发，学生读得到。
- **`skill-template/`** 是学生的起点骨架：把 `reference/` 的实现换成"原理 + 最小示例 + TODO"，
  形态与 `reference/` 完全一致（同样的 `load_case` / `train_and_evaluate` / `main`），便于逐段对照。
- **`tools/`** 既不是题目也不是 Skill，是"造题工具"（生成用例输入），**不下发**。

> 为什么把参考实现放进题目包（而不是留在仓库里当"教师的答案"）？因为教学目标是**让学生理解**：
> 卡住时能立刻对照一份正确的实现，比"自己憋"有效得多。代价是复验成功率不再能区分
> "自己写的"与"抄来的" —— 原创性改由 `SKILL.md` 的能力边界/踩坑记录与 `.dshc` 证据包体现
> （那部分抄不了，也正好是最需要动脑的部分）。

## 五个 case

| case | 配置 | 期望（测试集） | 观察点 |
|---|---|---|---|
| case01 | `LinearRegression` | `r2=0.9861`、`mae=0.4626` | 回归口径与四舍五入 |
| case02 | `LogisticRegression` | `accuracy=0.90`、CM=`[[22,4],[1,23]]` | `stratify=y` 与混淆矩阵结构 |
| case03 | `LogisticRegression(class_weight="balanced")` | `accuracy=0.92`、CM=`[[61,6],[0,8]]` | `model_params` 透传 + 类别不平衡 |
| case04 | `LogisticRegression`、`test_size=0.2`、`random_state=7`、`stratify=false`、三分类 | `accuracy=0.75`、CM=`[[11,2,0],[1,12,3],[0,6,13]]` | 多分类（CM **3×3**）、**不传 `stratify` 的分支**、非默认切分与种子 |
| case05 | `LinearRegression(fit_intercept=false)`、`test_size=0.3` | `r2=0.4907`、`mae=2.662` | `model_params` **是否真透传**（漏传 → R²≈0.98，一眼暴露） |

指标**都明显不是满分**（0.49 ~ 0.92）—— 口径抄错（漏 `stratify`、漏传 `model_params`、随机种子写死）
会真的掉分，很难碰巧全对。

## 重新生成数据与期望值

```sh
cd server/fixtures/ml-basics
# 1) 数据（固定种子，可重跑）：需要镜像里的 numpy
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/w" --entrypoint python3 \
  nju-lab-verify:0.2.0-rc.2-pkg4 /w/tools/gen_cases.py
# 2) 期望值：**必须在与复验同一个镜像里生成**，保证 sklearn 版本与复验环境一致
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/w" --entrypoint python3 \
  nju-lab-verify:0.2.0-rc.2-pkg4 /w/problem/reference/scripts/train.py --regen-cases
```

## 打包、自检、上传

```sh
cd server/fixtures/ml-basics
rm -f skill-template.zip problem.zip
(cd skill-template && zip -qr ../skill-template.zip .)   # zip 根即 SKILL.md
(cd problem        && zip -qr ../problem.zip .)          # zip 根即 manifest.json + cases/

# 上传前自检（不烧 token）：结构 + 依赖
docker run --rm -v "$PWD:/p:ro" nju-lab-verify:0.2.0-rc.2-pkg4 \
  --check --skill /p/skill-template.zip --problem /p/problem.zip

# 上传拿 fileId → 在「机器学习基础模型构建与运行」项目详情里绑定：
#   Skill 模板 ← skill-template.zip 的 fileId
#   题目包 ← problem.zip 的 fileId
TOKEN=$(curl -s http://127.0.0.1:3100/api/auth/login -X POST \
  -H 'Content-Type: application/json' \
  -d '{"username":"teacher","password":"teacher123"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["accessToken"])')
curl -s http://127.0.0.1:3100/api/files -X POST -H "Authorization: Bearer $TOKEN" -F "file=@skill-template.zip"
curl -s http://127.0.0.1:3100/api/files -X POST -H "Authorization: Bearer $TOKEN" -F "file=@problem.zip"
```

## 教师侧自检闭环：拿满配 Skill 跑一遍复验

```sh
docker run --rm --env-file server/.env \
  -v "$PWD/server/fixtures/ml-basics:/p:ro" -v /tmp/out:/outputs \
  nju-lab-verify:0.2.0-rc.2-pkg4 \
  --skill /p/problem/reference --problem /p/problem.zip --out /outputs/result.json
```

ML 实验记得把 `VERIFY_DOCKER_MEMORY` 从 `1g` 调到 `2g`（torch/sklearn 的内存需求）。

## 出题提醒

- 题面（`task.md`）必须**自包含**：复验只给这份题干 + `input.csv`/`params.json` + 学生的 Skill，
  漏写切分口径，学生按自己理解做"对了"也会被判错。
- 想提高区分度，可让口径更细（更多 `model_params` 组合、多指标、边界样本），而不是把信息藏进模板。
- 改口径要三处同步：`problem/task.md`、`problem/judge.md`、`problem/reference/scripts/train.py`，
  然后重算 `expected.json`。

## 实测记录

### 2026-10-08（再续）：教学向改造 —— 参考实现随包下发 + 教学字段写实

依据 `docs/EXPERIMENT-DESIGN-FRAMEWORK.md` §3.5 的**教学优先**原则（平台的目的是让学生**理解知识**，
判分只是"他做完了"的确认手段），本实验成为**教学向样板**：

- **参考实现并入题目包**：`skill-solution/` → `problem/reference/`（学生 claim 即得，**先读后仿**）；
  它同时仍是教师"题目可解性"自检的输入（`--skill problem/reference`）
- **骨架留解释层**：`skill-template/SKILL.md` 从"4 条 TODO"改为"**原理一句 + 最小示例 + 你要做的**"，
  并指向 `problem/reference/`；case05 的叙述从"照妖镜"改为"值得亲手跑一遍的观察点"
- **题目包 README 改导学**：从"用例/考点表"改为"学什么 / 怎么走 / 包内有什么 / 卡住看哪"，
  用例表的"考点"列改成"这个 case 想让你观察什么"
- **项目字段写实**（学生端可见，`ExperimentDetail.tsx` 会渲染）：`objectives`（学完能讲清的三件事）、
  `background`（概念地图：监督学习 / 切分 / 回归 vs 分类 / 指标怎么读 / `fit_intercept`）、
  `description`（8 步导学，每步说明"在学什么"，并修掉原文里"虚拟机里应该已经准备好"这类与现状不符的内容）、
  `references`（sklearn 文档）、`faq`（"我的指标为什么不对"等 5 条）
- **取舍（已写进规范）**：参考实现随包下发后，复验成功率不再区分"自己写的 / 抄来的"；
  原创性由 `SKILL.md` 的能力边界/踩坑记录与 `.dshc` 证据包体现（那部分抄不来）

实测：`--regen-cases` 路径修正后期望值**逐字节未变**（5 个 case）；`--check` 通过
（problem.zip 已含 `reference/`）；参考实现跑复验 **5/5 通过**（52.8s）；平台侧重新绑定
（problem.zip sha256 `87fcd6bd…`，与本地一致）并写入 5 个教学字段。

### 2026-10-08（续）：扩到 5 个 case —— 提升考点覆盖，并实测"区分度"这个真问题

- 新增两个**陷阱**用例（`tools/gen_cases.py`，固定种子可重跑）：
  - `case04`：K=3 多分类 + `stratify=false` + `test_size=0.2` + `random_state=7`
    → `accuracy=0.75`、混淆矩阵 **3×3**；考"多分类"、"不传 `stratify` 的分支"、照抄切分口径
  - `case05`：回归 + `model_params={"fit_intercept": false}` + `test_size=0.3`
    → `R²=0.4907`（**照妖镜**：漏传 `model_params` 会变成 ≈0.98，一眼看出没透传）
- 同步放宽判据：`judge.md` 的混淆矩阵从写死的 2×2 改为 **K×K**；`task.md` 补多分类与
  "`stratify` 为假时不要传"
- **满配 Skill 复验：5/5 通过**（60.1s，3543 in / 446 out tokens；`pitfallsRecorded=5`）
- ⚠️ **骨架也 5/5 通过**（145.7s，token 相近）—— 模型在骨架下现场写出了正确实现，
  连 3×3 混淆矩阵与 `fit_intercept` 都对了。**结论：这次优化提升的是"考点覆盖与实现难度"，
  没有提升"对模型的区分度"**：题干自包含（平台要求，为了学生自测与复验同口径）+
  模型能力足够 ⇒ 裸做的成功率一样高。
  真正能拉开差距的方向（按代价排序）：
  1. **过程分**（当前最现实）：能力边界 / 踩坑记录 / 证据一致性 —— 骨架这几项是空的
     （实测骨架 `boundariesDocumented=false`、`pitfallsRecorded=1`），学生认真做才有分；
  2. **让任务超出模型一步**：更多工程约束（性能上限、多文件交付、必须复用 Skill 内既有脚本）、
     或依赖**领域口径**（但注意与"题干自包含"的张力）；
  3. 恢复 baseline 对照（衡量"Skill 有没有用"而不是"学生水平"，是另一个维度）。

### 2026-10-08（当前结构）

- 目录改为「题目包 + Skill 两态 + `tools/`」；原 `reference/solve.py` 升级为满配 Skill
  `problem/reference/scripts/train.py`（函数划分与骨架对齐），`reference/gen_cases.py` → `tools/gen_cases.py`
- 满配 Skill 在与复验同一个镜像（pkg3）里复现期望值：**3/3 逐字节一致**
- `--check` 通过：`source=manifest`、`outputFile=output.json`、
  `requires.python=[sklearn,pandas,numpy]` 全部命中镜像预装集（依赖自检 ok）

### 2026-10-01（历史，当时的目录结构 `template/ + dataset/ + reference/`）

- `--check`：结构合法、`source=manifest`、`outputFile=output.json`、
  `requires.python=[sklearn,pandas,numpy]` 全部命中镜像预装集（依赖自检 ok）
- 端到端复验见 HANDOFF §0 的 2026-10-01 条目
