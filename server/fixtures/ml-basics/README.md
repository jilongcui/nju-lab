# 示例实验包（第三个任务类型）：机器学习基础建模

对应平台上那个 draft 项目「机器学习基础模型构建与运行」。用于演示**依赖 ML 库**的实验包
怎么写（与 `csv-cleaner`、`sales-report` 并列，规范见 `docs/EXPERIMENT-PACKAGE-SPEC.md`）。

## 目录结构

```
ml-basics/
├── template/                  # → template.zip（claim 时下发给学生）
│   ├── SKILL.md               # 骨架：能力边界 / 口径 / 实测档案 三节留 TODO
│   ├── scripts/train.py       # 骨架：CLI 约定稳定，建模逻辑留 TODO
│   └── references/checklist.md
├── dataset/                   # → dataset.zip（下发给学生 + 复验只读挂载）
│   ├── manifest.json          # outputFile=output.json；requires.python=[sklearn,pandas,numpy]
│   ├── task.md                # 题干（含切分口径 —— baseline 轮的唯一事实源）
│   ├── judge.md               # 判分细则（键名 + 容差 + 混淆矩阵结构）
│   ├── README.md
│   └── cases/case0N/{input.csv, params.json, expected.json}
├── reference/                 # **教师自用，不打包、不下发**
│   ├── gen_cases.py           # 固定种子生成用例输入（可重跑，逐字节可复现）
│   └── solve.py               # 参考实现；--regen-cases 重算全部 expected.json
├── template.zip / dataset.zip
└── README.md
```

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
# 数据（固定种子，可重跑）：需要镜像里的 numpy
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/w" --entrypoint python3 \
  nju-lab-verify:0.2.0-rc.2-pkg2 /w/reference/gen_cases.py
# 期望值：**必须在 pkg2 镜像里生成**，保证 sklearn 版本与复验环境一致
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/w" --entrypoint python3 \
  nju-lab-verify:0.2.0-rc.2-pkg2 /w/reference/solve.py --regen-cases
```

## 打包、自检、上传

```sh
cd server/fixtures/ml-basics
rm -f template.zip dataset.zip
(cd template && zip -qr ../template.zip .)
(cd dataset  && zip -qr ../dataset.zip .)

# 上传前自检（不烧 token）：结构 + 依赖
docker run --rm -v "$PWD:/p:ro" nju-lab-verify:0.2.0-rc.2-pkg2 \
  --check --skill /p/template.zip --dataset /p/dataset.zip

# 上传拿 fileId → 在「机器学习基础模型构建与运行」项目详情里绑定：
#   Skill 模板 ← template.zip 的 fileId
#   标准测试数据集 ← dataset.zip 的 fileId
TOKEN=$(curl -s http://127.0.0.1:3100/api/auth/login -X POST \
  -H 'Content-Type: application/json' \
  -d '{"username":"teacher","password":"teacher123"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["accessToken"])')
curl -s http://127.0.0.1:3100/api/files -X POST -H "Authorization: Bearer $TOKEN" -F "file=@template.zip"
curl -s http://127.0.0.1:3100/api/files -X POST -H "Authorization: Bearer $TOKEN" -F "file=@dataset.zip"
```

## 实测记录（2026-10-01，pkg2 镜像）

- `--check`：结构合法、`source=manifest`、`outputFile=output.json`、
  `requires.python=[sklearn,pandas,numpy]` 全部命中镜像预装集（依赖自检 ok）
- 端到端复验见 HANDOFF §0 的 2026-10-01 条目

## 出题提醒

- 题面（`task.md`）必须**自包含**：baseline 轮没有 Skill，只有这份题干 + `input.csv`/`params.json`，
  漏写切分口径会导致 baseline 与 treatment 比的不是同一件事。
- 代价是模型裸跑也能做对（lift 可能为 0）—— 这是"可复现"与"有区分度"的固有取舍。
  想提高区分度，可让口径更细（更多 `model_params` 组合、多指标、边界样本），而不是把信息藏进模板。
- 改口径要三处同步：`dataset/task.md`、`dataset/judge.md`、`reference/solve.py`，然后重算 `expected.json`。
