# 示例实验项目（fixtures）

平台上三个**示例实验项目**的源文件。每个项目都是同一套结构（见下），
差别只在任务类型与依赖：

| 实验项目 | 任务 | 类型 | 参考实现位置（学生可见） |
|---|---|---|---|
| [`csv-cleaner/`](csv-cleaner/) | CSV 数据清洗 | 内置回落型（最简 + 历史回归基线） | 顶层 `skill-solution/`（**待按新规范跟进**） |
| [`sales-report/`](sales-report/) | 销售明细汇总 | 包驱动型 | 顶层 `skill-solution/`（**待按新规范跟进**） |
| [`ml-basics/`](ml-basics/) | 机器学习基础建模 | 包驱动 + ML 依赖 | ✅ `problem/reference/`（**教学向样板**，随包下发） |

> **做新实验**：先读 `docs/EXPERIMENT-DESIGN-FRAMEWORK.md`（**§3.5 教学向设计清单（七件事）**），
> 再按 `docs/EXPERIMENT-PACKAGE-SPEC.md` 组织材料 —— 最省事的做法是
> `cp -r ml-basics <你的实验名>` 然后替换内容（它是当前的教学向样板）。

> ⚠️ **一致性状态（2026-10-08）**：只有 `ml-basics` 落实了"参考实现随题目包下发"的新规范；
> `csv-cleaner` 与 `sales-report` 仍把参考实现放在顶层 `skill-solution/`（不下发）。
> 照 `ml-basics` 改即可（`git mv skill-solution problem/reference` + 重打 zip + 重新绑定）。

## 统一结构：题目包（含参考实现）+ 学生起点 + 教师工具

```
<实验名>/
├── problem/            → problem.zip        题目包（**随包下发给学生**）
│   ├── task.md  judge.md  manifest.json
│   ├── README.md                             导学：学什么 / 怎么走 / 包内有什么
│   ├── cases/case0N/{input.*, expected.*}
│   └── reference/                            **参考实现（学习示范）** —— 学生先读后仿
├── skill-template/     → skill-template.zip 学生起点：原理 + 最小示例 + TODO
├── tools/                                   造题工具（不下发；可选）
└── README.md                                打包 / 自检 / 上传 / 自检闭环命令
```

> `ml-basics` 是**教学向样板**（2026-10-08 起）：参考实现放进题目包随包下发，项目字段
> （`objectives` / `background` / `description` / `references` / `faq`）写实，骨架留解释层。
> 设计原则与七件事清单见 `docs/EXPERIMENT-DESIGN-FRAMEWORK.md` §3.5。

两条形态契约（`--check` 会查）：

- `skill-template.zip` 的**根**必须是含 `SKILL.md` 的那一层（`no unique SKILL.md layer` 就会失败）；
- `problem.zip` 的**根**必须有 `cases/`，每个 case 有输入文件与 `expected.*`
  （多出别的目录不影响 —— 参考实现就是这么放进去的）。

**三个 Skill 形态**（起点骨架 / 参考实现 / 学生提交）只有完成度与可见性不同：起点与参考实现
**形态完全相同**（同样的函数划分），前者留 `TODO` + 解释层、**随 `skill-template.zip` 下发**，
后者写满、**随 `problem.zip` 下发**（先读后仿）；学生提交的那份被复验装入。
参考实现还有第二个用途：**拿它跑一遍复验 = "题目可解性"的机器证明**（各项目 README 有命令）。

`tools/` 是唯一**不下发**的目录（造题脚本：怎么造题不是学习材料）。

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
