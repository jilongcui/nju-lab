# 示例实验材料（fixtures）

平台上的示例实验包源文件。仓库里有**三个任务类型**：`csv-cleaner`（内置回落型）、
`sales-report`（包驱动 + 表格汇总）、`ml-basics`（包驱动 + ML 依赖）。
后两个演示并验证「任务知识随包走」的包驱动流程。

> **做新实验**：先读 `docs/EXPERIMENT-DESIGN-FRAMEWORK.md`（目标/题干/判分/成绩怎么设计），
> 再按 `docs/EXPERIMENT-PACKAGE-SPEC.md` 组织材料 —— 最省事的做法是
> `cp -r ml-basics <你的实验名>` 然后替换内容。

## 1. csv-cleaner + dataset —— CSV 数据清洗（内置回落型）

「CSV 数据清洗」示例实验的模板与标准测试数据集。当前已上传到平台并绑定到两个示例项目：

- template.zip → sha256 `10486f5e…b8f6c1`（fileId `6c645480-9774-4db9-ac28-841bd4b3d666`）
- dataset.zip → sha256 `3f055d84…3befe1`（fileId `e2bd7953-9928-4370-a8df-2e5623c844d3`）

- `csv-cleaner/` — Skill 模板源文件（SKILL.md 骨架 + scripts/clean.py + references/checklist.md），关键处留 TODO 引导学生
- `dataset/` — 3 个测试用例（input.csv 脏数据 + expected.csv 期望输出），`dataset/README.md` 写明参考清洗规则；数据集已用参考实现验证自洽（3/3）
- 该数据集**没有** `manifest.json` / `task.md` / `judge.md`，因此复验走驱动内置的 CSV 清洗语义
  （`source=builtin`）—— 它同时是历史行为的回归基线：驱动改成包驱动后，这套包必须仍然 3/3 通过。
- `template.zip` / `dataset.zip` — 上述目录的打包产物（修改源文件后需重新打包）

## 2. sales-report —— 销售数据汇总（包驱动型，第二个任务类型）

```
sales-report/
├── template/     → template.zip   （SKILL.md 骨架 + scripts/report.py + references/checklist.md）
├── dataset/      → dataset.zip    （manifest.json + task.md + judge.md + README + cases/*）
├── reference/report.py            （参考实现：**教师自用，不打包、不下发**）
└── README.md                      （实验包说明 + 打包上传 + 上传前自检命令）
```

- 任务：`input.csv`（销售明细）→ `output.json`（总额 / 分地区 / 冠军产品 / 行数）
- 三个 case 分别覆盖：基础汇总、`top_product` 并列、`units=0` 与小额金额
- `manifest.requires.python = ["pandas"]`：用来验证「镜像预装集 + 包内声明自检」这条链路
- 期望值由 `reference/report.py --regen-cases` 生成，并用 Decimal 独立实现交叉复核（MATCH）

## 3. ml-basics —— 机器学习基础建模（包驱动 + ML 依赖，第三个任务类型）

对应平台上那个 draft 项目「机器学习基础模型构建与运行」。

```
ml-basics/
├── template/     → template.zip   （SKILL.md 骨架 + scripts/train.py + references/checklist.md）
├── dataset/      → dataset.zip    （manifest.json + task.md + judge.md + README + cases/*）
├── reference/                     （**教师自用，不打包、不下发**）
│   ├── gen_cases.py               （固定种子生成 cases 输入，可重跑）
│   └── solve.py                   （参考实现；--regen-cases 重算 expected.json）
└── README.md
```

- 任务：`input.csv` + `params.json` → `output.json`（按 params 口径训练评估，输出 `model`/`n_train`/`n_test`/`metrics`）
- 三个 case：`LinearRegression`（r2=0.9861/mae=0.4626）、`LogisticRegression`（accuracy=0.90）、
  `LogisticRegression(class_weight="balanced")` 类别不平衡（accuracy=0.92）
- `manifest.requires.python = ["sklearn", "pandas", "numpy"]` —— 依赖基于 pkg2 镜像的 ML 预装集
- ⚠️ 期望值**必须在 pkg2 镜像里生成**（sklearn 版本决定指标）：
  `docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/w" --entrypoint python3 nju-lab-verify:0.2.0-rc.2-pkg2 /w/reference/solve.py --regen-cases`

## 修改后重新发布

```sh
# 方式一：zip 根即 SKILL.md / manifest.json（推荐，无需额外顶层目录）
cd server/fixtures/sales-report
rm -f template.zip dataset.zip
(cd template && zip -qr ../template.zip .)
(cd dataset  && zip -qr ../dataset.zip .)

# 方式二：csv-cleaner 沿用「带一层顶层目录」的打包方式（两种都被 resolveSkillRoot 支持）
cd server/fixtures
zip -qr template.zip csv-cleaner && zip -qr dataset.zip dataset

# 上传（教师 token）
TOKEN=$(curl -s http://127.0.0.1:3100/api/auth/login -X POST \
  -H 'Content-Type: application/json' \
  -d '{"username":"teacher","password":"teacher123"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["accessToken"])')
curl -s http://127.0.0.1:3100/api/files -X POST -H "Authorization: Bearer $TOKEN" -F "file=@template.zip"
curl -s http://127.0.0.1:3100/api/files -X POST -H "Authorization: Bearer $TOKEN" -F "file=@dataset.zip"
# 拿到新的 fileId 后，PATCH /api/projects/:id 绑定（见 HANDOFF 第 2 节）
```

上传前先自检（不烧 token）：

```sh
docker run --rm -v "$PWD/server/fixtures/sales-report:/p:ro" \
  nju-lab-verify:0.2.0-rc.2-pkg2 --check --skill /p/template.zip --dataset /p/dataset.zip
```

注意：数据集 `expected.*` 是评分基准，修改任一 case 即视为新版本，注意已在进行中的实验不要中途换数据。
