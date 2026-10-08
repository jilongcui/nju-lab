# 示例实验项目（fixtures）

平台上三个**示例实验项目**的源文件。每个项目都是同一套结构（见下），
差别只在任务类型与依赖：

| 实验项目 | 任务 | 类型 | `problem/` 里有题面与判据吗 |
|---|---|---|---|
| [`csv-cleaner/`](csv-cleaner/) | CSV 数据清洗 | 内置回落型（最简样板 + 历史回归基线） | ❌ 走驱动内置语义（`source=builtin`） |
| [`sales-report/`](sales-report/) | 销售明细汇总 | 包驱动型 | ✅ `manifest.json` + `task.md` + `judge.md` |
| [`ml-basics/`](ml-basics/) | 机器学习基础建模 | 包驱动 + ML 依赖 | ✅ 同上（另有 `tools/` 造题工具） |

> **做新实验**：先读 `docs/EXPERIMENT-DESIGN-FRAMEWORK.md`（目标/题干/判分/成绩怎么设计），
> 再按 `docs/EXPERIMENT-PACKAGE-SPEC.md` 组织材料 —— 最省事的做法是
> `cp -r sales-report <你的实验名>` 然后替换内容（它是四块结构里最典型的一个）。

## 统一结构：题目包 + Skill 两态（+ 教师工具）

```
<实验名>/
├── problem/            → problem.zip        题目包：题面 + 判据 + IO 契约 + 用例（标准，不可改）
├── skill-template/     → skill-template.zip 学生起点：Skill 骨架（关键处留 TODO）
├── skill-solution/                          满配 Skill = 标准答案（不打包、不下发）
├── tools/                                   教师工具，如造题脚本（不打包、不下发；可选）
└── README.md                                打包 / 自检 / 上传 / 自检闭环命令
```

两条形态契约（`--check` 会查）：

- `skill-template.zip` 的**根**必须是含 `SKILL.md` 的那一层（`no unique SKILL.md layer` 就会失败）；
- `problem.zip` 的**根**必须有 `cases/`，每个 case 有输入文件与 `expected.*`。

**Skill 三态**（骨架 / 满配 / 学生提交）只有完成度与可见性不同：`skill-template/` 与
`skill-solution/` **形态相同**，前者下发、后者永不下发。满配版还有个额外用途 ——
**它可以被复验直接当 Skill 装入，跑通即"题目可解性"的机器证明**（各项目 README 有命令）。

`reference/` 这个旧目录名已不再使用：参考实现就是满配 Skill（`skill-solution/`），
造题脚本等非 Skill 工具放 `tools/`。两者都**不打包、不下发**。

## 各项目细节

- **csv-cleaner**：见 [`csv-cleaner/README.md`](csv-cleaner/README.md)（含"骨架也通过了"这一区分度实测结论）
- **sales-report**：见 [`sales-report/README.md`](sales-report/README.md)
- **ml-basics**：见 [`ml-basics/README.md`](ml-basics/README.md)（含 `tools/gen_cases.py` 的用法）

## 打包 / 自检 / 上传（通用）

```sh
cd server/fixtures/<实验名>
rm -f skill-template.zip problem.zip
(cd skill-template && zip -qr ../skill-template.zip .)   # zip 根即 SKILL.md
(cd problem        && zip -qr ../problem.zip .)          # zip 根即 cases/ 与 manifest.json

# 上传前自检（不烧 token）：结构 + 依赖
docker run --rm -v "$PWD:/p:ro" nju-lab-verify:0.2.0-rc.2-pkg4 \
  --check --skill /p/skill-template.zip --problem /p/problem.zip
```

上传拿 fileId 后在项目详情里绑定（`Skill 模板` ← `skill-template.zip`、
`题目包` ← `problem.zip`）；**平台上绑定的是 fileId，与 zip 文件名无关**，
但文件名会成为学生下载到的原始名。完整命令见各项目 README。

注意：`problem/cases/*/expected.*` 是评分基准，改任一 case 即视为新版本 ——
**不要在有学生做的时候换**。

## 平台绑定现状（2026-10-08 更新）

三个示例项目已按新结构重新上传并绑定：

| 项目 | Skill 模板 | 题目包 |
|---|---|---|
| 机器学习基础模型构建与运行 | `ml-basics/skill-template.zip` | `ml-basics/problem.zip` |
| 实验：数据清洗 | `csv-cleaner/skill-template.zip` | `csv-cleaner/problem.zip` |
| 实验一：CSV 数据清洗 Skill | `csv-cleaner/skill-template.zip` | `csv-cleaner/problem.zip` |

（`sales-report` 未绑定到任何线上项目，仅作示例。）

历史制品：2026-10-01 上传的 `template.zip` / `dataset.zip` 仍在文件库里（sha256 `10486f5e…` / `3f055d84…`），
已不再被任何项目引用 —— 需要时可作为回滚点重新绑定。
