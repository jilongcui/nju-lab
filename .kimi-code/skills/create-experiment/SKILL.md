---
name: create-experiment
description: 按当前口径（report.md 体系 + 学员模式）新建或改造一个 NJU-Lab 实验包：脚手架生成骨架、替换数据与参考实现、跑 --check 与复验、打包上传并绑定平台项目
type: prompt
whenToUse: 当用户要求"新增一个实验/实验包"、"做一个 XX 实验"、"把某个实验改成新的报告口径"，或要检查现有实验包是否符合当前口径时
arguments:
  - name
  - title
  - kind
---

# 新建 / 改造实验包（当前口径）

本 skill 把"从需求到一个能让学生做的实验"压成五步。口径的唯一依据是
`docs/EXPERIMENT-CREATION-GUIDE.md`（尤其 **§2.5 报告口径**）与 `docs/EXPERIMENT-PACKAGE-SPEC.md`；
本文只写**操作**。

## 当前口径的三条硬规则（2026-10-24 起）

1. **学生只填 `report.md`**：`skill-template/report.md` 六节（自测概况 / 各 case 结果 / 基线对照 /
   踩坑记录 / 结论 / 产出图），表格列按该实验的 `metrics` 定制；平台按"自测时间 + 两个 case 有数字 +
   踩坑 ≥1 条"判过程项齐全。
2. **`SKILL.md` 不留文档 TODO**：能力边界预填成可用的默认表述（平台不检查这一节）；
   只有**代码里的 TODO** 才留给学生。
3. **`task.md` 的交付句**写"报告会由工具整理进 `report.md`，不需要改 `SKILL.md`"。

## 第一步：脚手架

```bash
node server/fixtures/scripts/scaffold-experiment.mjs \
  --name <包名 kebab-case> --title "<实验标题>" \
  --kind classification|regression|detection|delivery \
  [--metrics accuracy,macro_f1] [--thresholds accuracy=0.9,macro_f1=0.85] \
  [--cases case01,case02] [--difficulty easy|medium|hard] [--force]
```

生成 `README.md` + `problem/{manifest.json,task.md,judge.md,cases,reference}` +
`skill-template/{SKILL.md,report.md,scripts}`。**产物能直接过 `--check`**（实测三种 kind 都通过）。

## 第二步：换成真东西（占位都在脚手架里标了）

| 要替换 | 位置 |
|---|---|
| 数据 | `problem/cases/case0N/data.csv`（每行一个样本） |
| 参考值 | `problem/cases/case0N/expected.json`（`n_rows` / `baseline` / `accept`） |
| 达标线 | `problem/manifest.json` 的 `assertions`（脚手架已按 `--thresholds` 生成） |
| 参考实现 | `problem/reference/`（示范）+ 模板 `skill-template/scripts/`（**留代码 TODO**） |
| 报告列 | `skill-template/report.md` 的表格（应与 `metrics` 一致） |
| 项目字段 | `README.md` 的「项目字段文案」（title/difficulty/content/objectives/background/description） |

**防退化**：至少写一个"偷懒解"（只报最多类别 / 只用一个特征 / 恒等预测），确认它过不了达标线。

## 第三步：自检与复验

```bash
cd server/fixtures/<name>
rm -f problem.zip skill-template.zip
(cd problem && zip -qr ../problem.zip .) && (cd skill-template && zip -qr ../skill-template.zip .)

# ① 结构自检（不烧 token）
docker run --rm -v "$PWD:/p:ro" nju-lab-verify:0.2.0-rc.2-pkg8 \
  --check --skill /p/skill-template.zip --problem /p/problem.zip

# ② 参考实现复验（应 2/2；需要模型 key）
docker run --rm --env-file ../../../server/.env --memory 2g \
  -v "$PWD:/p:ro" -v "$(mktemp -d):/outputs" nju-lab-verify:0.2.0-rc.2-pkg8 \
  --skill /p/problem/reference --problem /p/problem.zip --out /outputs/result.json
```

判读：`--check` 的 `dependencyCheck.ok` 为真、`package.skill.info.reportSource` 是 `report.md`；
复验 `cases` 全 pass 且 `hardChecks.failed` 为空。

## 第四步：打包上传 + 绑定平台项目

```bash
# 教师账号登录 → 上传两个 zip → PATCH 项目
curl -s -X POST http://<host>/lab/api/auth/login -H 'content-type: application/json' \
  -d '{"username":"teacher","password":"..."}' | jq -r .data.accessToken
```

- `POST /api/files`（multipart，字段 `file`）→ `data.fileId`
- `PATCH /api/projects/<projectId>`，body `{ "skillTemplateFileId": "...", "problemFileId": "..." }`
- 若项目不属于当前教师（403）→ 改用 SQL 只改这两个字段（`experiment_projects`），并核对 fileId 存在。

## 第五步：验收清单

- [ ] `--check` 通过；参考实现复验 2/2
- [ ] `skill-template/report.md` 存在，列与 `metrics` 一致
- [ ] `SKILL.md` 有「能力边界」且**没有文档 TODO**；代码 TODO 保留并配原理/示例
- [ ] `task.md` 交付句指向 `report.md`；六步齐全；`figures` 要求 ≥2 张
- [ ] 防退化：偷懒解过不了
- [ ] `README.md` 的项目字段文案与实测记录已填
- [ ] 平台：两个 zip 已绑定、`content/objectives/background/description` 是新版、已 publish
- [ ] 提交并 push（不要提交他人未跟踪文件）

## 改造既有实验包（反向操作）

对已有的旧口径包，等价于：

1. 删 `SKILL.md` 的「## 实测档案」节（其中的"已知失效情形"并入「能力边界」）；
2. `## 能力边界（TODO：学生补全）` → `## 能力边界`，`平台会扫描这一节` → `平台不检查这一节`；
3. 新增 `skill-template/report.md`（照本项目里任一已改造的包抄结构，列换成该包的 `metrics`）；
4. `task.md` 的"写进 SKILL.md 的实测档案" → "报告会整理进 `report.md`"；
5. `problem/reference/SKILL.md` 的示范实测档案 → `reference/report.md`；
6. 重打包 + 重新绑定项目。

参考做法：本仓库 2026-10-24 那次批量改造（22 个包）就是这么做的。
