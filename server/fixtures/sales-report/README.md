# 示例实验包（第二个任务类型）：销售数据汇总

这是 `csv-cleaner`（内置回落的 CSV 清洗型实验）之外的**第二个任务类型**的完整示例，
用来演示并验证「**任务知识随包走**」的包驱动流程 —— 平台侧零代码改动即可换实验类型。

## 目录结构（新实验按此组织）

```
sales-report/
├── template/                  # Skill 模板源（打包 → template.zip，claim 时下发给学生）
│   ├── SKILL.md               # 必须存在；含「能力边界」「实测档案」小节供平台扫描
│   ├── scripts/report.py      # 骨架：CLI 约定稳定，核心逻辑留 TODO
│   └── references/checklist.md
├── dataset/                   # 标准测试数据集源（打包 → dataset.zip，claim 时下发给学生）
│   ├── manifest.json          # 包声明：输出文件名 / 输入文件 / judgeMode / 依赖
│   ├── task.md                # 题干（复验唯一的事实源；支持 {{input}}/{{output}} 占位符）
│   ├── judge.md               # 评分细则（LLM judge 的判据）
│   ├── README.md              # 给人看
│   └── cases/case0N/{input.csv, expected.json}
├── reference/report.py        # 参考实现（**教师自用，不打包、不下发**）
├── template.zip               # 打包产物（绑定到项目的 skillTemplateFileId）
└── dataset.zip                # 打包产物（绑定到项目的 testDatasetFileId）
```

## 打包与上传

```sh
cd server/fixtures/sales-report
rm -f template.zip dataset.zip
(cd template && zip -qr ../template.zip .)   # zip 根即 SKILL.md
(cd dataset  && zip -qr ../dataset.zip .)    # zip 根即 manifest.json + cases/

# 上传（教师 token）→ 拿 fileId → PATCH /api/projects/:id 绑定
TOKEN=$(curl -s http://127.0.0.1:3100/api/auth/login -X POST \
  -H 'Content-Type: application/json' \
  -d '{"username":"teacher","password":"teacher123"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["accessToken"])')
curl -s http://127.0.0.1:3100/api/files -X POST -H "Authorization: Bearer $TOKEN" -F "file=@template.zip"
curl -s http://127.0.0.1:3100/api/files -X POST -H "Authorization: Bearer $TOKEN" -F "file=@dataset.zip"
```

## 上传前自检（不烧 token）

```sh
docker run --rm -v "$PWD:/p:ro" nju-lab-verify:0.2.0-rc.2-pkg3 \
  --check --skill /p/template.zip --dataset /p/dataset.zip
```

会打印解析结果（输出文件名、题干/细则来源、每个 case 的输入与期望文件、依赖自检），
依赖缺失或结构不合法时以退出码 2 失败 —— **上传前就能发现，不用等学生提交**。

## 改口径时三处一起改

`dataset/task.md`（题干）、`dataset/judge.md`（判分）、`reference/report.py`（参考实现）
是三份独立的事实源，平台不做同步。改完 `python3 reference/report.py --regen-cases`
重算 `expected.json`，再按上面的命令重新打包上传（新 fileId = 新版本）。

## 实测记录（2026-10-01，本机）

```sh
docker run --rm --env-file /tmp/verify.env \
  -v "$PWD/server/fixtures/sales-report:/p:ro" -v "$PWD/.verify-scratch/out:/outputs" \
  nju-lab-verify:0.2.0-rc.2-pkg2 \
  --skill /p/template.zip --dataset /p/dataset.zip --out /outputs/sales.json --max-cases 1
```

- 包解析正确：`source=manifest`、`outputFile=output.json`、题干来自 `dataset/task.md`、细则来自 `dataset/judge.md`
- 依赖自检通过（`requires.python=["pandas"]`，镜像预装集里有）
- baseline 1/1、treatment 1/1 通过，judge 返回的中文 rationale 引用的正是 `judge.md` 的字段级口径

⚠️ **baseline 也通过了**（`lift = 0`）：deepseek-flash 裸跑就能完成"分组求和"这类题。
这不是包的 bug，但说明该 case **区分度不足** —— 正式出题时建议设计"口径依赖 Skill 文档里
的领域知识、题干只能给出目标而给不出细节"的用例（题干仍须自包含，否则 baseline 失去可比性）。

> **2026-10-06 注**：本文以上实测记录按当时口径保留。平台此后**取消了 baseline 轮**，
> `lift` 不再是平台信号 —— 该 case 现在只看"用 Skill 跑一轮"的成功率。

