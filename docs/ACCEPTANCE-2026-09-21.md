# NJU-Lab 端到端验收记录（2026-09-21）

**结论：端到端验收通过。** 学生本地 DSH（headless + 插件）→ 平台 → 真实容器复验 → 教师批改 → 学生看反馈，全程一次跑通，无断点，未改任何平台/插件代码。

## 0. 环境

- 平台 `http://127.0.0.1:3100/api`（NestJS 运行中），DB `nju-lab-mysql`（docker），复验 `EVALUATION_RUNNER=docker`，镜像 `nju-lab-verify:0.1.5-rc.2`
- DSH `@deepseek-ai/dsh@0.1.5-rc.2`（用 `dsh/verify-poc/node_modules/.bin/dsh`），内置 `headless` profile
- 模型全程 `deepseek-flash`（官方 DEEPSEEK_API_KEY，`reasoningEffort: low`）
- 工作区 `/home/ubuntu/acceptance/ws`（跨 4 次 headless 运行持久），overlay `/home/ubuntu/acceptance/overlay.yml`
- 关键 id：assignment `440be845-…`；submission `bffd5268-099c-4681-8e4b-e9a82b5e6813`；evaluation `93d8d09a-3609-487f-b02d-ed9fe36bcb18`

## 1. 准备

- DB 重置：`assignments.status='pending', claimedAt=NULL`；`submissions`/`evaluations` 清空（0 行）
- 插件 `npm run build`：lib/host/index.js 38.95 kB，构建成功
- student1 登录 + `POST /api/me/tokens` 签 365 天 token（`ver:2`），存 `/home/ubuntu/acceptance/student1.token`（600）

## 2. 学生 DSH 旅程（4 次 headless 运行，overlay 装插件，NJU_LAB_TOKEN 环境变量供 token）

统一命令形态：
`DSH_HOME=默认 NJU_LAB_TOKEN=… DEEPSEEK_API_KEY=… dsh --profile headless --patch overlay.yml '<自然语言任务>'`（cwd=/home/ubuntu/acceptance/ws）

| 步骤 | 模型行为（自主决策） | 结果 | 墙钟 | tokens(in/out/rea) |
|---|---|---|---|---|
| ① 列任务 | 先加载 `nju-lab-experiment` skill，再调 `nju_lab_list_assignments` | 返回 2 个任务（1 解锁 1 未解锁），状态/截止时间正确 | 6.8s | 8877/388/42 |
| ② 领取 | 调 `nju_lab_claim` | 模板(2934B)/数据集(3139B)真实下载、sha256 校验通过、解压、Skill 根探测=`skill/csv-cleaner/`；evalConfig 钉定（model=deepseek-flash, tools=[shell], timeout=600）；DB status→`claimed` | 10.0s | 6136/740/119 |
| ③ 开发 | 解压数据集→读 README/cases→实现 clean.py→逐 case diff 自测→填 SKILL.md（能力边界+实测档案+4 条真实踩坑） | 3/3 PASS（我事后手工复跑 diff 复核一致，SKILL.md 无 TODO 残留） | 41.8s | 7088/7444/1919 |
| ④ 提交 | 先自复跑 3 case 确认，再调 `nju_lab_submit` | skill.zip（3 文件，sha256 ca94e8cb…）+ evidence.dshc（sha256 5132a477…）分别上传，fileId 模式提交；DB submission=`submitted`、assignment=`submitted`、auditEvents=8 条 | 13.8s | 6547/1494/243 |

- 学生侧合计：≈38.7k tokens（in 28648 + out 10066），墙钟 ≈73s
- `.dshc` 证据包抽检：`nju-lab.capsule/v1`，4 个会话、8 条审计事件（`approval/policy`、`permission/preset`）、integrity 哈希齐全、无降级 note

## 3. 平台侧（teacher）

- `POST /api/submissions/bffd5268…/verify`（teacher token）→ 26.3s，真实容器双轮：
  - baseline case01 pass=1（in 7485/out 823）；treatment case01 pass=1（in 10759/out 1294）；两轮 judge rationale 均为真实中文判词
  - `successRate=1`、`tokenCost=20361`、`autoScoreSuggestion=80`
  - `integrityCheck`：capsuleHashVerified=true、自报 vs 实测 consistent、3 文件全 match、8 审计事件
  - `dossierSnapshot`：boundariesDocumented=true，lift=0
- `POST /api/submissions/bffd5268…/grade` `{teacherScore:88, teacherComment:…}` → evaluation 写入 88 分+评语，submission status→`graded`

## 4. 学生看反馈

- student1 `GET /api/me/evaluations/93d8d09a-…` → 200，拿到 teacherScore=88、teacherComment 全文、successRate、tokenCost
- 越权抽查：student1 调 teacher 的 verify 端点 → 403（RolesGuard 生效）

## 5. 修复的问题

**无。全程未改任何代码/配置（平台、插件、.env 均未动），无需重启。**

## 6. 发现的小问题（未修，建议后续）

1. **`pitfallsRecorded: 0` 误报**：学生实际写了 4 条踩坑，但 `run-eval.mjs` 的 `scanSkillMd` 只认 `## 踩坑记录` 二级标题，而平台模板自身把踩坑放在 `## 实测档案` 下的 `- 踩坑记录（pitfalls）：` 列表项里 → 模板引导学生写出的格式扫描器数不到。建议：改模板把踩坑提成 `##` 节，或放宽 scanSkillMd 的 section 匹配。改动需重建 verify 镜像。
2. **evalConfig 工具收窄不跨进程持久**：claim 把 evalConfig 存闭包，同一会话立即生效（L2 已验）；但学生分多次 headless 运行时，新进程的③④步工具面是完整的。非本次验收断点，属已知设计边界，建议插件把已领取 assignment 的 evalConfig 落盘（如 `<workspace>/nju-lab/<id>/eval-config.json`）启动时恢复。
3. **baseline 也通过了 case01**（lift=0）：deepseek-flash 裸跑就能清洗 case01，该 case 区分度不足；建议数据集增加更依赖 Skill 文档知识的 case（已有 case02/03，VERIFY_MAX_CASES=1 没跑到）。
4. `submissions.controller.ts` verify 端点注释仍写"当前为模拟复验"，与 docker runner 现状不符（注释漂移，无功能影响）。

## 7. 成本汇总

| 环节 | tokens | 时长 |
|---|---|---|
| 学生 DSH 全程（4 次 headless，deepseek-flash low） | ≈38.7k（in 28.6k / out 10.1k） | ≈73s |
| 容器复验（1 case × 双轮 + judge） | 20,361 | 26.3s |
| 登录/签 token/批改/查反馈 | 0（纯 API） | <1s |
| **合计** | **≈59k tokens** | **≈100s** |

## 8. 剩余风险与建议

- 复验容器仍未断网（生产前必须落实网络隔离/白名单代理）；学生 scripts 可执行任意代码。
- `evalConfig.model` 逐项目映射未进容器（镜像 profile 钉死 deepseek-flash/low）。
- 评分口径 `pass`（归一换行）vs `passStrict`（逐字节）未最终决策；exact 模式未 e2e。
- 学生 DSH 端目前是 headless 验收，web profile（右侧面板）未纳入本次旅程，建议补一次 `dsh --profile nju-lab-student` 人工冒烟。
