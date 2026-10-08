# ml-basics —— 机器学习基础建模（包驱动 + ML 依赖）

第三个任务类型的完整示例，对应平台上那个 draft 项目「机器学习基础模型构建与运行」。
用来演示**依赖 ML 库**的实验项目怎么写（与 `csv-cleaner`、`sales-report` 并列）。

## 目录结构（实验项目的四块 + 教师工具）

```
ml-basics/
├── problem/            → problem.zip        题目包：题面 + 判据 + IO 契约 + 用例（标准，不可改）
│   ├── manifest.json   IO 契约（outputFile=output.json；requires=[sklearn,pandas,numpy]）
│   ├── task.md         题面（切分口径、指标、输出结构全写死 → 结果可复现）
│   ├── judge.md        评分细则（键名 + 数值容差 + 混淆矩阵结构）
│   ├── README.md       给学生看的说明（会被下发）
│   └── cases/case0N/{input.csv, params.json, expected.json}
├── skill-template/     → skill-template.zip 学生起点：SKILL.md 骨架 + TODO
├── skill-solution/                          满配 Skill = 标准答案（不打包、不下发）
│   ├── SKILL.md  scripts/train.py           （函数划分与骨架一致；`--regen-cases` 重算期望值）
├── tools/gen_cases.py                       教师工具：固定种子生成用例输入（不打包、不下发）
└── README.md
```

`tools/` 是**第四块**：它既不是题目（不是标准），也不是 Skill（不可被装入执行），
而是"造题工具"——所以单独放，且与 `skill-solution/` 一样永不下发。

## 五个 case

| case | 配置 | 期望（测试集） | 考点 |
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
  nju-lab-verify:0.2.0-rc.2-pkg4 /w/skill-solution/scripts/train.py --regen-cases
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
  --skill /p/skill-solution --problem /p/problem.zip --out /outputs/result.json
```

ML 实验记得把 `VERIFY_DOCKER_MEMORY` 从 `1g` 调到 `2g`（torch/sklearn 的内存需求）。

## 出题提醒

- 题面（`task.md`）必须**自包含**：复验只给这份题干 + `input.csv`/`params.json` + 学生的 Skill，
  漏写切分口径，学生按自己理解做"对了"也会被判错。
- 想提高区分度，可让口径更细（更多 `model_params` 组合、多指标、边界样本），而不是把信息藏进模板。
- 改口径要三处同步：`problem/task.md`、`problem/judge.md`、`skill-solution/scripts/train.py`，
  然后重算 `expected.json`。

## 实测记录

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
  `skill-solution/scripts/train.py`（函数划分与骨架对齐），`reference/gen_cases.py` → `tools/gen_cases.py`
- 满配 Skill 在与复验同一个镜像（pkg3）里复现期望值：**3/3 逐字节一致**
- `--check` 通过：`source=manifest`、`outputFile=output.json`、
  `requires.python=[sklearn,pandas,numpy]` 全部命中镜像预装集（依赖自检 ok）

### 2026-10-01（历史，当时的目录结构 `template/ + dataset/ + reference/`）

- `--check`：结构合法、`source=manifest`、`outputFile=output.json`、
  `requires.python=[sklearn,pandas,numpy]` 全部命中镜像预装集（依赖自检 ok）
- 端到端复验见 HANDOFF §0 的 2026-10-01 条目
