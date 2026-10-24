#!/usr/bin/env node
/**
 * 新实验脚手架 —— 生成一个**能过 `--check`** 的实验包骨架（2026-10-24 口径）。
 *
 * 用法：
 *   node server/fixtures/scripts/scaffold-experiment.mjs \
 *     --name my-exp --title "实验：xxx" --kind classification \
 *     [--metrics accuracy,macro_f1] [--thresholds accuracy=0.9,macro_f1=0.85] \
 *     [--cases case01,case02] [--difficulty easy] [--force]
 *
 * 生成的目录（与既有实验包同构）：
 *   README.md                    项目字段文案 + 判据要点 + 打包/发布命令
 *   problem/manifest.json        outputFile=output.json + 断言（按 kind）
 *   problem/task.md              业务背景 / 任务 / 六步 / 交付格式 / 怎么算完成
 *   problem/judge.md             语义判据骨架
 *   problem/cases/case0N/        data.csv + expected.json（占位，替换成真数据）
 *   problem/reference/           参考实现说明 + 示范 report.md
 *   skill-template/SKILL.md      能力边界**预填**、文档里不留 TODO
 *   skill-template/report.md     六节报告模板（列按 metrics）
 *   skill-template/scripts/      实现骨架（**代码**里留 TODO）
 *
 * 口径依据：docs/EXPERIMENT-CREATION-GUIDE.md §2.5「报告口径」。
 * 生成后必做：填真数据 → 写参考实现 → `--check` → 参考实现复验 2/2 → 打包上传绑定。
 */
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const KINDS = ['classification', 'regression', 'detection', 'delivery']

const DEFAULTS = {
  classification: { metrics: ['accuracy', 'macro_f1'], thresholds: { accuracy: 0.9, macro_f1: 0.85 } },
  regression: { metrics: ['mae', 'r2'], thresholds: { mae_ratio: 0.8 } },
  detection: { metrics: ['recall', 'precision', 'accuracy'], thresholds: { recall: 0.65, precision: 0.4 } },
  delivery: { metrics: [], thresholds: {} },
}

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i]
    if (!key.startsWith('--')) continue
    const name = key.slice(2)
    if (name === 'force') { out.force = true; continue }
    out[name] = argv[i + 1]
    i += 1
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
if (!args.name || !args.title) {
  console.error('用法: --name <包名> --title <实验标题> [--kind classification|regression|detection|delivery] ...')
  process.exit(1)
}
const kind = args.kind ?? 'classification'
if (!KINDS.includes(kind)) {
  console.error(`--kind 只能是 ${KINDS.join(' / ')}`)
  process.exit(1)
}
const preset = DEFAULTS[kind]
const metrics = args.metrics ? args.metrics.split(',').map((s) => s.trim()).filter(Boolean) : preset.metrics
const thresholds = {}
for (const pair of (args.thresholds ?? '').split(',').filter(Boolean)) {
  const [k, v] = pair.split('=').map((s) => s.trim())
  if (k && v) thresholds[k] = Number(v)
}
if (!Object.keys(thresholds).length) Object.assign(thresholds, preset.thresholds)
const cases = (args.cases ?? 'case01,case02').split(',').map((s) => s.trim()).filter(Boolean)
const difficulty = args.difficulty ?? 'medium'

const root = resolve('server/fixtures')
const dir = join(root, args.name)
if (existsSync(dir) && !args.force) {
  console.error(`目录已存在：${dir}（要覆盖加 --force）`)
  process.exit(1)
}

// ---------- 片段 ----------
const metricLabel = { accuracy: 'accuracy', macro_f1: 'macro F1', mae: 'MAE', r2: 'R²', rmse: 'RMSE', recall: 'recall', precision: 'precision' }
const label = (m) => metricLabel[m] ?? m

const acceptText = Object.entries(thresholds)
  .map(([k, v]) =>
    k.endsWith('_ratio') ? `MAE ≤ **${v}×** 基线 MAE` : `**${label(k)} ≥ ${v}**`)
  .join(' 且 ')

const reportCols = (() => {
  if (kind === 'delivery') return ['case', '交付项', '结果', '是否达标（按任务要求）']
  if (kind === 'regression' || metrics.includes('mae')) {
    return ['case', 'MAE', '基线 MAE', 'MAE / 基线', '是否达标（按任务要求）']
  }
  if (kind === 'detection') return ['case', 'recall', 'precision', 'accuracy', '是否达标（按任务要求）']
  return ['case', ...metrics.map(label), '是否达标（按任务要求）']
})()

const reportTable = [
  `| ${reportCols.join(' | ')} |`,
  `|${reportCols.map(() => '---').join('|')}|`,
  ...cases.map((c) => `| ${c} |${'  |'.repeat(reportCols.length - 1)}`),
].join('\n')

const metricsJson = (() => {
  if (kind === 'delivery') return '  "deliverables": { "示例字段": "……" },'
  const body = metrics.map((m) => `    "${m}": 0.0`).join(',\n')
  return `  "metrics": {\n${body}\n  },`
})()

const baselineJson = kind === 'delivery'
  ? '  "baseline": { "name": "对照做法", "note": "……" },'
  : kind === 'regression' || metrics.includes('mae')
    ? '  "baseline": { "name": "不建模基线", "mae": 0.0 },'
    : '  "baseline": { "name": "不建模基线", "accuracy": 0.0 },'

const assertions = (() => {
  const list = []
  const fields = kind === 'delivery' ? "['deliverables','figures','notes']" : "['model','n_train','n_test','metrics','baseline','figures','notes']"
  list.push({ name: '报告字段完整', expr: `${fields}.every((k) => out[k] !== undefined && out[k] !== null && out[k] !== '')` })
  list.push({
    name: '图表说明齐全（至少 2 张图，每张一句话结论）',
    expr: "Array.isArray(out.figures) && out.figures.length >= 2 && out.figures.every((f) => f && typeof f.path === 'string' && f.path.trim() !== '' && typeof f.takeaway === 'string' && f.takeaway.trim().length >= 10)",
  })
  if (kind !== 'delivery') {
    list.push({ name: '切分覆盖全部样本', expr: 'out.n_train + out.n_test === expected.n_rows' })
    list.push({ name: '测试集占比在 20%~40%', expr: 'out.n_test / (out.n_train + out.n_test) >= 0.2 && out.n_test / (out.n_train + out.n_test) <= 0.4' })
    if (kind === 'regression' || metrics.includes('mae')) {
      list.push({
        name: `达标：MAE ≤ ${thresholds.mae_ratio ?? 0.8} × 基线`,
        expr: `out.metrics.mae <= ${thresholds.mae_ratio ?? 0.8} * out.baseline.mae`,
      })
    } else {
      for (const [k, v] of Object.entries(thresholds)) {
        if (k.endsWith('_ratio')) continue
        list.push({ name: `达标：${label(k)} ≥ ${v}`, expr: `out.metrics.${k} >= ${v}` })
      }
    }
  }
  list.push({ name: '说清判断（notes ≥20 字）', expr: "typeof out.notes === 'string' && out.notes.trim().length >= 20" })
  return list
})()

const expectedJson = (() => {
  const accept = {}
  for (const [k, v] of Object.entries(thresholds)) accept[k.endsWith('_ratio') ? 'mae_max_ratio_to_baseline' : `${k}_min`] = v
  return JSON.stringify(
    {
      n_rows: 0,
      baseline: kind === 'regression' || metrics.includes('mae') ? { mae: 0 } : { accuracy: 0 },
      accept,
    },
    null,
    2,
  )
})()

// ---------- 文件内容 ----------
const files = {}

files['problem/manifest.json'] = `${JSON.stringify(
  {
    schemaVersion: 1,
    name: args.name,
    title: args.title,
    outputFile: 'output.json',
    inputs: ['data.csv'],
    judgeMode: 'llm',
    maxCases: 0,
    assertions,
    requires: { python: ['pandas', 'numpy'] },
  },
  null,
  2,
)}\n`

files['problem/task.md'] = `# ${args.title}

## 业务背景

（一句话说清场景：谁、在什么数据上、要解决什么问题。别写"你的任务"以外的指令。）

## 你的任务

用工作目录里的 \`data.csv\` 做出一份结果，产出 \`output.json\` 与图，达到：

1. **达标**：${acceptText || '（按本实验口径填写达标线）'}。
2. **可复现**：固定随机种子；产出里写清 \`n_train\` / \`n_test\`（测试集占比 20%~40%）。
3. **用图讲清楚**：看数据一张图、评估一张图，每张写一句结论（进 \`output.json\` 的 \`figures\`）。

## 实验流程（六步，每一步都要走完）

| 步 | 做什么 | 产出 |
|---|---|---|
| ① 看清需求 | 明确达标线与难点 | 心里有数 |
| ② 看一眼数据 + 画图 | 数据长什么样、哪里会出问题 | \`figures/\` 第 1 张 |
| ③ 定基线 | 不建模能做到多少 | \`baseline\` |
| ④ 建模 / 搭建 | 选一个你能讲清楚的方案 | \`model\` |
| ⑤ 评估 + 画图 | 算指标、看错在哪 | \`figures/\` 第 2 张 |
| ⑥ 写结论 | 结论与踩坑 | \`report.md\` |

## 交付格式

**\`output.json\`**（写在工作目录下）：

\`\`\`json
{
  "model": "你最终选择的方案名称",
  "n_train": 0,
  "n_test": 0,
${metricsJson}
${baselineJson}
  "figures": [
    { "path": "figures/data_overview.png", "takeaway": "……（一句结论）" },
    { "path": "figures/evaluation.png", "takeaway": "……（一句结论）" }
  ],
  "notes": "……（≥20 字：怎么做的、比基线好多少、难点在哪）"
}
\`\`\`

## 怎么算完成

1. 方案能对任意一份同结构 \`data.csv\` 产出 \`output.json\` 与两张图。
2. ${cases.map((c) => `\`cases/${c}\``).join(' 与 ')} 上都达标。
3. 把结论与踩过的坑记下来 —— 报告会由工具整理进 \`report.md\`，**不需要改 \`SKILL.md\`**。

判据全文见 \`judge.md\`；怎么自测见 \`README.md\`。
`

files['problem/judge.md'] = `# 评分细则（语义判据）

> 硬性条件由 \`manifest.json\` 的 \`assertions\` 判定（字段完整、指标门槛、切分、notes 长度）；
> 这里只判**语义**，任一项不成立 → 不通过。

1. **\`figures\` 与 \`notes\` 是否"看图说话"**：看数据那张要说出数据长什么样/哪里会坏；
   评估那张要说出错在哪；\`notes\` 要有整体判断（比基线好多少、难点在哪）。套话或与指标矛盾 → 不通过。
2. **\`model\` 与 \`metrics\` 是否自洽**：模型名与结果对得上，指标与任务相关。
3. **是否可疑地过于好**：明显超出该数据的合理上限且 \`notes\` 解释不清 → 可疑 → 不通过。
4. **基线定义是否正确**：必须是"不建模的朴素做法"，用训练好的另一个模型当基线 → 不通过。
`

for (const c of cases) {
  files[`problem/cases/${c}/data.csv`] = 'feature_a,feature_b,target\n# 替换成真数据：一行一个样本\n'
  files[`problem/cases/${c}/expected.json`] = `${expectedJson}\n`
}

files['problem/reference/SKILL.md'] = `# 参考实现（示范）

> 这份是**出题时的示范**，随题目包下发；学生看它学会"六步怎么走"。
> 平台不检查它的内容，只要求它在题包里。

## 怎么做

1. 读 \`cases/case01/data.csv\`，看一眼分布；
2. 算基线（不建模的朴素做法）；
3. 实现 \`scripts/train.py\`：训练 → 评估 → 写 \`output.json\` → 画两张图；
4. 两个 case 都跑一遍，确认达标。

## 实测记录

见同目录的 \`report.md\`（示范填写）。
`

files['problem/reference/report.md'] = `# 实测档案（示范填写）

> 出题时把参考实现的真实数字填在这里；学生看它就知道报告该写成什么样。

- 自测时间：（出题当天）
- 两个 case 的结果：${cases.map((c) => `${c} ？`).join(' / ')}
- 踩坑记录（pitfalls）：
  1. （写一条真实踩过的：什么现象、怎么发现、怎么修）
`

files['skill-template/SKILL.md'] = `# ${args.title}（学生起点）

> 这个目录是**你的方案**：\`SKILL.md\` 写"这个技能什么时候该用、不该用"，
> \`report.md\` 记录你的自测与踩坑。**代码里的 \`TODO\` 才是你要改的地方**（文档不用改）。

## 实验材料（都在题目包 \`problem/\` 里）

- \`problem/task.md\` —— 需求 + 六步流程 + 交付格式
- \`problem/cases/\` —— ${cases.join(' / ')} 两份数据（各带 \`expected.json\` 参考值）
- \`problem/judge.md\` —— 语义判据
- \`problem/reference/\` —— 一份走完六步的示范

## 能力边界

> 这一节是技能说明书的一部分；**平台不检查这一节**，按实际情况补两句即可。

- 能处理：与 \`data.csv\` 同结构的数据
- 不处理：（缺测值？量纲差异？类别极不均衡？）
- 写死的假设：（列名、类别集合、随机种子）

## 六步流程

① 看清需求 → ② 看一眼数据并画图 → ③ 定基线 → ④ 建模/搭建 → ⑤ 评估并画图 → ⑥ 写结论

材料配合：读 \`problem/task.md\` → 读 \`problem/reference/\` → 改 \`scripts/\` 里的 TODO → 两个 case 都跑 →
补能力边界（平台不检查）→ 提交；**实测记录写进 \`report.md\`**（平台按它评过程分）。

## 自测

\`\`\`sh
python3 scripts/train.py ../problem/cases/case01 ../case01/output.json --fig-dir figures/case01
python3 scripts/train.py ../problem/cases/case02 ../case02/output.json --fig-dir figures/case02
\`\`\`

> 实测记录（结果、错误分布、踩过的坑）写进同级的 \`report.md\`；这里只保留能力边界。
`

files['skill-template/report.md'] = `# 实验报告：${args.title}

> 只填**数字与短句**，不要删小节、不要改表格列。平台按第 4 节的条数计过程分。

## 1. 自测概况

- 学生姓名：
- 学号：
- 实验名称：${args.title}
- 自测时间：
- 自测方式：（本地 DSH / 平台工作台）

## 2. 各 case 的结果

${reportTable}

## 3. 基线对照

- 基线做法：（不建模的朴素做法）
- 基线指标：
- 我的结果 / 基线：

## 4. 踩坑记录（每条一行，平台按行计数）

1. 

## 5. 结论（≥20 字：与基线比提升多少、难点在哪）

## 6. 产出图（文件名 + 一句结论）

- 
`

files['skill-template/scripts/train.py'] = `"""实现骨架：读 case 目录 → 产出 output.json + 两张图。

代码里的 TODO 才是你要改的地方（文档不用改）。
用法：python3 scripts/train.py <case目录> <output.json> [--fig-dir figures]
"""
import argparse
import json
from pathlib import Path

import pandas as pd


def load(case_dir: Path) -> pd.DataFrame:
    return pd.read_csv(case_dir / "data.csv")


def baseline(df: pd.DataFrame) -> dict:
    """③ 基线：不建模的朴素做法（例如一律报最多的类别 / 一律报平均值）。"""
    # TODO: 按题目口径实现基线
    return {"name": "不建模基线"}


def train(df: pd.DataFrame) -> dict:
    """④ 训练 / 搭建：选一个你能讲清楚的方案。"""
    # TODO: 固定随机种子、切分（测试集 20%~40%）、训练
    return {"model": "未命名方案", "n_train": 0, "n_test": 0, "metrics": {}}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("case_dir")
    ap.add_argument("out")
    ap.add_argument("--fig-dir", default="figures")
    a = ap.parse_args()

    df = load(Path(a.case_dir))
    result = {
        **train(df),
        "baseline": baseline(df),
        "figures": [
            # TODO: 画两张图，path 与实际落点一致（相对当前工作目录）
        ],
        "notes": "",
    }
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
`

files['README.md'] = `# ${args.name} —— ${args.title}

> 用 \`server/fixtures/scripts/scaffold-experiment.mjs\` 生成（2026-10-24 报告口径）。
> 下面这些占位都要替换：数据、参考实现、阈值、README 的项目字段文案。

## 场景与数据

- 应用：（一句话）
- 对应章节：（第几章）
- 数据：\`problem/cases/${cases.join(' / ')}\`

## 判据设计要点

1. 达标线：${acceptText || '（填写）'}；
2. 防退化：写出"偷懒解"并确认它过不了（例如只报最多的类别 / 只用一个特征）；
3. 基线可信：断言核对 \`baseline\` 与参考值（见 \`problem/cases/*/expected.json\`）。

## 项目字段文案（建项目时用）

- **title**：${args.title}
- **difficulty**：\`${difficulty}\`
- **content**（学生详情页首屏 = task.md 的业务背景；**不写"你的任务"**）：
  （一句话场景 + 数据 + 要做成什么）
- **objectives**（陈述句，容易档不夹问句）：
  1. （核心概念一）
  2. （核心概念二）
- **background**（每条 = 概念 + 一句人话解释；出现术语当场解释）：
  - **（概念）**：（一句解释）
- **description**（导学步骤，≤8 步；不提 \`task.md\`，最后一步是生成报告）：
  1. 读实验内容与本节的达标要求；
  2. …；
  8. 生成实验报告 \`report.md\`：数字由平台从各 case 的 \`output.json\` 自动填入，你只补结论与踩坑，确认后提交。
- **references** / **faq**：（按需）

## 打包 / 自检 / 发布

\`\`\`sh
cd server/fixtures/${args.name}
rm -f problem.zip skill-template.zip
(cd problem && zip -qr ../problem.zip .) && (cd skill-template && zip -qr ../skill-template.zip .)

# ① 结构自检（不烧 token）
docker run --rm -v "$PWD:/p:ro" nju-lab-verify:0.2.0-rc.2-pkg8 \\
  --check --skill /p/skill-template.zip --problem /p/problem.zip

# ② 参考实现复验（应 2/2；需要模型 key）
docker run --rm --env-file ../../../server/.env --memory 2g \\
  -v "$PWD:/p:ro" -v "$(mktemp -d):/outputs" nju-lab-verify:0.2.0-rc.2-pkg8 \\
  --skill /p/problem/reference --problem /p/problem.zip --out /outputs/result.json
\`\`\`

发布：上传两个 zip → PATCH 项目绑定（\`skillTemplateFileId\` / \`problemFileId\`）→ publish。

## 实测记录

（参考实现的真实数字，出题当天填；与 \`problem/reference/report.md\` 保持一致）
`

// ---------- 写入 ----------
for (const [rel, content] of Object.entries(files)) {
  const target = join(dir, rel)
  await mkdir(join(target, '..'), { recursive: true })
  await writeFile(target, content, 'utf8')
}

const count = (await readdir(dir, { recursive: true })).length
console.log(`✅ 已生成 ${dir}（${count} 个条目，kind=${kind}，cases=${cases.length}）`)
console.log('')
console.log('下一步：')
console.log('  1. 把真数据换进 problem/cases/*/data.csv，并填 expected.json（参考值）')
console.log('  2. 写 problem/reference/ 与 scripts/ 里的 TODO（代码 TODO 保留，文档不留）')
console.log('  3. 跑 --check（见 README 的命令），再跑参考实现复验 2/2')
console.log('  4. 打包两个 zip → 上传 → PATCH 项目绑定 → publish')
console.log('  5. 平台项目字段（content/objectives/background/description）按 README 里那份填')
