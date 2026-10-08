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

## 三个 case

| case | 模型 | 期望（测试集） | 考点 |
|---|---|---|---|
| case01 | `LinearRegression` | `r2=0.9861`、`mae=0.4626` | 回归口径与四舍五入 |
| case02 | `LogisticRegression` | `accuracy=0.90`、CM=`[[22,4],[1,23]]` | `stratify` 与混淆矩阵结构 |
| case03 | `LogisticRegression(class_weight="balanced")` | `accuracy=0.92`、CM=`[[61,6],[0,8]]` | `model_params` 透传 + 类别不平衡 |

指标**都不是满分** —— 口径抄错（漏 `stratify`、随机种子写死错值）会真的掉分。

## 重新生成数据与期望值

```sh
cd server/fixtures/ml-basics
# 1) 数据（固定种子，可重跑）：需要镜像里的 numpy
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/w" --entrypoint python3 \
  nju-lab-verify:0.2.0-rc.2-pkg3 /w/tools/gen_cases.py
# 2) 期望值：**必须在与复验同一个镜像里生成**，保证 sklearn 版本与复验环境一致
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/w" --entrypoint python3 \
  nju-lab-verify:0.2.0-rc.2-pkg3 /w/skill-solution/scripts/train.py --regen-cases
```

## 打包、自检、上传

```sh
cd server/fixtures/ml-basics
rm -f skill-template.zip problem.zip
(cd skill-template && zip -qr ../skill-template.zip .)   # zip 根即 SKILL.md
(cd problem        && zip -qr ../problem.zip .)          # zip 根即 manifest.json + cases/

# 上传前自检（不烧 token）：结构 + 依赖
docker run --rm -v "$PWD:/p:ro" nju-lab-verify:0.2.0-rc.2-pkg3 \
  --check --skill /p/skill-template.zip --dataset /p/problem.zip

# 上传拿 fileId → 在「机器学习基础模型构建与运行」项目详情里绑定：
#   Skill 模板 ← skill-template.zip 的 fileId
#   标准测试数据集 ← problem.zip 的 fileId
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
  nju-lab-verify:0.2.0-rc.2-pkg3 \
  --skill /p/skill-solution --dataset /p/problem.zip --out /outputs/result.json
```

ML 实验记得把 `VERIFY_DOCKER_MEMORY` 从 `1g` 调到 `2g`（torch/sklearn 的内存需求）。

## 出题提醒

- 题面（`task.md`）必须**自包含**：复验只给这份题干 + `input.csv`/`params.json` + 学生的 Skill，
  漏写切分口径，学生按自己理解做"对了"也会被判错。
- 想提高区分度，可让口径更细（更多 `model_params` 组合、多指标、边界样本），而不是把信息藏进模板。
- 改口径要三处同步：`problem/task.md`、`problem/judge.md`、`skill-solution/scripts/train.py`，
  然后重算 `expected.json`。

## 实测记录

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
