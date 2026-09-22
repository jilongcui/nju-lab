# NJU-Lab 开发交接（Handoff）

> 写给接手对话：本文档包含继续开发所需的全部上下文。先读本文件，再按需读 `nju-lab-craft.md`（系统设计总文档）。
> 更新时间：2026-09-21

## 0. 一句话现状

NJU-Lab（"课程 + 实验"一体化 Skill 工程教学平台）**端到端已验收通过（2026-09-21，见 `docs/ACCEPTANCE-2026-09-21.md`）**：学生本地 DSH（插件）登录 → 看任务 → 领取（真实下载 + sha256 校验 + 解压 + 条件钉死）→ 开发 Skill → 自测 3/3 → 提交（真实 ZIP + `.dshc` 证据包 + 审计事件）→ 服务端真实容器复验（deepseek-flash，baseline/treatment + LLM judge）→ 教师批改 → 学生看反馈，全程一次跑通、零代码修复，总成本 ≈59k tokens / ≈100s。生产化关键项也已落地：容器 SNI 白名单网络隔离、evalConfig.model 逐项目映射、修改密码、migrations、systemd 常驻、CSV 成绩导出。**剩余为后续阶段功能**（第 5 节）。

## 1. 仓库布局

```
/home/ubuntu/nju-lab/
├── nju-lab-craft.md          # 系统设计总文档（含实现现状 §13）
├── HANDOFF.md                # 本文件
├── docs/ACCEPTANCE-2026-09-21.md  # 端到端验收记录
├── server/                   # NestJS + TypeORM + MySQL 后端（端口 3100）
├── web/                      # Vite + React 18 + AntD v5 前端
└── dsh/                      # DSH 本地侧构件
    ├── README.md             # dsh 目录总说明 + 快速开始
    ├── nju-lab-client/       # 定制客户端双半插件（host + client），README 有详细实现状态
    ├── profiles/
    │   ├── nju-lab-student/  # 学生本地 profile（web + nju-lab-client）
    │   └── nju-lab-verify/   # 平台复验 profile（headless，approval=never）
    ├── dev/overlay.yml       # 本地调试 overlay（TS 源直载）
    └── scripts/smoke.sh      # 插件加载冒烟
```

## 2. 运行环境与账号

| 项 | 值 |
|---|---|
| 线上入口 | https://lab.xiaohe.biz（nginx → 静态 `/var/www/nju-lab/dist` + `/api/` → `127.0.0.1:3100`） |
| nginx 配置 | `/etc/nginx/sites-enabled/lab.conf`（改后 `sudo nginx -t && sudo service nginx reload`） |
| 数据库 | Docker 容器 `nju-lab-mysql`（MySQL 8.0，127.0.0.1:3306，库 `nju_lab`，用户 `nju_lab`，密码 `nju_lab_dev`，utf8mb4） |
| 账号 | `admin/admin123`（管理员，全权限）、`teacher/teacher123`、`student1/student123`（另有 student2/student3） |
| 后端启动 | **生产常驻：`systemctl start nju-lab`**（unit `/etc/systemd/system/nju-lab.service`，`node dist/main.js`，Restart=always，MemoryMax=800M；改代码后 `npm run build && sudo systemctl restart nju-lab`）；开发调试用 `npm run start:dev` |
| 前端部署 | `cd web && npm run build && sudo rm -rf /var/www/nju-lab/dist && sudo cp -r dist /var/www/nju-lab/ && sudo chown -R www-data:www-data /var/www/nju-lab` |
| 端口注意 | 本机 3000/5173 被其他项目占用，所以后端用 3100；服务器内存紧张（~1.4G 可用）、磁盘紧张（~10G） |
| DSH 版本 | 锁定 `@deepseek-ai/dsh@0.1.5-rc.2`（rc 阶段官方明示破坏性变更，学期内不升级） |

常用验证：

```bash
mysql -h 127.0.0.1 -u nju_lab -pnju_lab_dev nju_lab          # 进数据库
curl -s http://127.0.0.1:3100/api/auth/login -X POST \
  -H 'Content-Type: application/json' \
  -d '{"username":"teacher","password":"teacher123"}'        # 登录拿 token
# 经 nginx 测线上：curl -sk --resolve lab.xiaohe.biz:443:127.0.0.1 https://lab.xiaohe.biz/...
```

## 3. 关键架构与纪律（踩坑沉淀，务必遵守）

1. **统一响应格式**：后端所有接口返回 `{code, data, message}`（code=0 成功）；前端 axios 拦截器统一解包。
2. **登录返回字段是 `accessToken`**（不是 token）——这个坑修过一次。
3. **新接口必须先定契约再两端实现，联调以 curl 实测为准**。前后端并行开发曾产生 10 类字段/结构不匹配（详见 craft 文档 §13），不要凭想象写字段名。
4. **认证抽象**：后端 `AuthProvider` 接口（当前 `LocalAuthProvider`），接学校统一认证时新增 Provider。
5. **角色**：`admin`（RolesGuard 放行一切 + 各服务归属校验豁免）、`teacher`、`student`。公开注册只允许 teacher/student。
6. **复验抽象**：`server/src/submissions/evaluation-runner.ts` 的 `EvaluationRunner` 接口，两种实现：`MockEvaluationRunner`（确定性假数据，无 Docker/key 的开发环境用）与 `DockerEvaluationRunner`（真实容器复验），`EVALUATION_RUNNER=mock|docker` 环境变量切换（默认 mock，当前 .env 为 docker）。
7. **部署纪律**：禁止把 Vite dev server 挂 nginx 当生产（HMR WebSocket 必挂）；前端产物放 `/var/www/nju-lab/dist`（不能放 `/home/ubuntu`，750 权限）；`sites-enabled/` 下所有文件都会被 nginx 加载，备份文件必须移出。
8. **TypeORM migrations**：`synchronize: false` + `migrationsRun: true`（启动自动执行）；初始迁移 `src/migrations/1790002605000-InitialSchema.ts`（已在既有库手工登记、在空库实测建表后 schema:log 零 diff）。改实体后：`npm run typeorm migration:generate -- src/migrations/<Name>` 生成迁移并核对 SQL，新环境启动即自动建表。
9. **DSH 侧**：`agent/request` 是 waterfall，只能钉 provider/model/reasoningEffort/maxTokens；**钉工具集要用 `ctx.tools.restrict()`**；client 半由 client-modules 服务按 `package.json` 的 `dsh.client` 自动扫描挂载；slot 组件拿不到 ctx。
10. **复验安全姿态**（verify profile）：一次性容器 + 断网 + `approval=never` + 资源限额。容器是唯一信任边界（DSH 沙箱不挡网络与进程）。
11. **给模型的引导**（system prompt 段、skill）由**插件注册**即可随 profile 生效：`ctx.systemPrompt.section()` + `ctx.skills.register()`（见 `nju-lab-client/src/host/guidance.ts`），不必改 profile 文件。磁盘 `SKILL.md` 路线要额外配 `customSkillDirs` / `bundledSkillDir`，**profile 目录不是默认 skill 发现根**，且 `bundledSkillDir` 按进程 cwd 解析。skill 来源优先级（越小越优先）：project 100/200 · runtime 250 · custom 300 · user 400/500 · bundled 600。
12. **L2 测试要带 `DSH_BIN`**：`npm test` 在 PATH 上找不到 `dsh` 时，L2 用例是 **skip**（TAP `ok … # SKIP`）而不是失败，看起来全绿但什么都没验。另外 L2 启动 `dsh` 必须给临时 `cwd`，否则插件的默认 `workspaceDir`（`process.cwd()`）会把 `nju-lab/` 落盘目录写进仓库。
13. **评估条件必须跨进程持久化**：`evalConfig` 不能只存插件闭包 —— DSH 每次启动都是新进程（headless 每条任务一个），重启后工具面会重新放开，等于"学生自测条件 ≠ 平台复验条件"。插件做法（`nju-lab-client/src/host/eval-state.ts`）：claim 时写 `<workspace>/nju-lab/pinned-eval-config.json`，`apply()` 启动时读回并**优先于配置里的默认值**；平台本次未下发条件时**清掉旧值**，避免上一个实验的限制被继承。文件损坏/形状不对只警告并忽略（不能因为状态文件起不来）。

## 4. 距端到端的缺口清单（按建议实施顺序）

端到端定义：学生本地 DSH **登录 → 看任务 → 领取（真实模板+数据集、条件钉死）→ 开发 Skill → 自测 → 提交（真实 ZIP + .dshc + 审计事件）→ 服务端真实容器复验 → 教师批改 → 学生看反馈**。

### 第 1 步：平台文件上传/下载 —— ✅ 已完成（2026-09-21，curl 全链路实测）

- 后端 files 模块（`server/src/files/`）：`POST /api/files`（multipart，≤100MB，服务端算 sha256 为权威值）、`GET /api/files/:id`（登录即可，UUID 能力凭证；细粒度鉴权留待生产化）。存储在 `server/uploads/`（`UPLOAD_DIR` 可配），按 sha256 前缀分目录
- 项目实体：`skillTemplateRef`/`testDatasetRef` 字符串引用已删除，改为 `skillTemplateFileId`/`testDatasetFileId`；创建/编辑项目校验文件存在
- claim 接口返回 `skillTemplate`/`testDataset` 文件信息对象（`{fileId,url,originalName,size,sha256}`）+ evalConfig；学生端 `GET /api/projects/:id` 仅领取后带文件信息
- submit 接口支持 fileId 模式（`skillZipFileId`/`capsuleFileId`，须本人上传否则 403；服务端 sha256 为准，自报不符 400；ref 记为 `file:<id>`），兼容旧 ref+sha256 直填
- Web：教师编辑项目弹窗改为上传控件；项目详情/学生实验页（领取后）可真实下载（axios blob 带 JWT）
- 踩坑：文件流必须经 `StreamableFile` 返回，`TransformInterceptor` 对 `StreamableFile` 原样放行（直接 `stream.pipe(res)` 会被统一响应包装覆盖）
- 示例材料（真实 ZIP）已上传并绑定两个示例项目；源文件收在 `server/fixtures/`（模板 `csv-cleaner/` + 数据集 3 case，已验证自洽，改版方法见其 README）

### 第 2 步：插件 token 获取 + 提交工具 —— ✅ 已完成（2026-09-21）

**完整需求与契约见 `dsh/nju-lab-client/REQ-2026-09-21-submit-pipeline.md`**（claim 新响应结构、files API、submit fileId 模式、端到端验收标准）。要点：

- token（平台侧 ✅，D-lite+ 方案）：`POST /api/me/tokens` 签发 365 天 token（payload 带 `ver`）；`POST /api/me/tokens/revoke` 吊销（`User.tokenVersion`+1，全部 token 含 Web 登录态失效，JWT validate 逐请求比对）；Web 右上角头像菜单「API Token」弹窗可生成/复制/吊销。**插件侧已完成**：DSH 设置页的 `nju-lab` 节（`ctx.settings.installSection`，改动即时生效）+ `NJU_LAB_TOKEN` 双来源；缺失/被拒给可读指引，不裸 401
- `nju_lab_submit` 工具 ✅：自检（经 `resolveSkillRoot` 探测真正的 Skill 根）→ 逐文件 sha256（`fileHashes`）→ 纯 JS 打包 ZIP → 生成 `.dshc` → 分别 POST /api/files 上传 → 以 fileId 模式提交；真实平台联调后库里是 `skillZipRef=file:<id>`
- ClaimPanel ✅：从占位变真实面板（拉任务列表、领取/提交按钮、钉定条件展示），并做过交互与错误提示打磨
- claim 工具 ✅：真实下载模板/数据集 + sha256 校验 + 纯 JS 解压 + Skill 根探测；`evalConfig.tools` 经 `ctx.tools.restrict()` 钉白名单（claim 后对**已存在**的 agent 补一刀，保证同一会话内立即受限）
- **评估条件跨进程持久化 ✅**（2026-09-21 补）：`evalConfig` 不再只存闭包 —— claim 时写 `<workspace>/nju-lab/pinned-eval-config.json`，`apply()` 启动时读回并优先于配置默认值；平台本次未下发条件时清掉旧值。否则学生重启 DSH（headless 每条任务一个进程）后工具面会重新放开，等于"自测条件 ≠ 复验条件"。见 `src/host/eval-state.ts`；L2 用**两趟独立进程**验证第二趟一启动就被收窄

### 第 3 步：复验实证 + 真实执行器 —— ✅ 已完成（2026-09-21）

**实证已完成（2026-09-21，dsh/verify-poc/）**，核心结论：

- **dsh-teach 不存在（npm 404）→ 自写驱动脚本路线，已跑通**：`dsh/verify-poc/run-eval.mjs`（零依赖 Node 脚本）输入 skill 目录 + dataset 目录，每 case 跑 baseline（无 Skill）/treatment（有 Skill）两轮，与 expected.csv 比对，汇总结构化 JSON。真实模型运行（case01）：baseline ✅ / treatment ✅，单 case 两轮 ~25k input tokens、~90s
- **设计文档 §7 有两处错误**（已实测纠正）：headless **没有** `--json` NDJSON 模式、**不支持** stdin 传 task；结构化数据要从 session 持久化日志采集（`$DSH_HOME/sessions/**/session.v3.jsonl.zstd`，多帧 zstd 用 `zstd -dc` 解）
- **模型 provider**：`llm-deepseek` 的 `apiKeyEnv` + `baseURL` 可指任意 OpenAI 兼容端点；当前用 `MOONSHOT_API_KEY`（kimi-k2.6）跑通；将来换 DeepSeek 官方 key 只需改回默认 baseURL + DEEPSEEK_API_KEY（cordis.patch.yml 注释已写明）
- **profile patch 坑（已修）**：`workspace-write + approval=never` 不匹配任何内置权限预设，必须在 `permission` 行显式声明 `verify` 预设并钉 `defaultPreset: verify`；且 patch config 是整段替换非深合并
- **approval=never 实测生效**：工作区外写入被确定性拒绝，session 日志首三条事件为 `permission/preset: verify` / `sandbox/mode: workspace-write` / `approval/policy: never`
- 容器镜像注意：需带 `zstd` CLI、设 `DSH_TELEMETRY_DISABLED=1`（默认遥测外发 deepseeksvc.com）；轮数/成本无内建上限，靠容器 timeout + maxTokens 双重限制
- ⚠️ 评分标准决策点：Python csv.writer 默认 CRLF，逐字节 diff 会判负——PoC 同时报 `pass`（归一换行）与 `passStrict`（逐字节），平台需明确用哪个（见下）

**真实 EvaluationRunner 已实现并端到端实测通过（2026-09-21）**：

- 镜像 `nju-lab-verify:0.1.5-rc.2`（512MB，`server/verify-image/`：node:22-slim + dsh 锁定版 + zstd/unzip/python3 + 驱动脚本 run-eval.mjs + nju-lab-verify profile）
- `server/src/submissions/docker-evaluation-runner.ts`：file 引用 → uploads 真实路径 → `docker run --rm --memory 1g --cpus 1` 只读挂载 → LLM judge（{pass, score, rationale} 落库）→ 写 Evaluation；`EVALUATION_RUNNER=mock|docker` 环境切换（默认 mock，当前 .env 为 docker）
- 端到端实测：student1 提交真实 skill.zip → teacher verify → 107.6s / 22.7k tokens → Evaluation 写入真实数据（successRate=1、judge rationale、integrityCheck 自报哈希逐条对照、dossier 正确识别能力边界未填）
- 成本量级：1 case ≈ 23k tokens / ~108s；3 cases ≈ 68k / ~5min
- **已知遗留**：① ~~容器未断网~~ 已解决（2026-09-21）：SNI 白名单代理——`nju-verify-egress` internal 网络（无外网路由）+ 双宿主 nginx stream 代理（ssl_preread，白名单 api.deepseek.com / api.moonshot.cn），runner 每次复验前幂等确保；非白名单 DNS 黑洞、直连 IP 无路由均已负向实测；边界：按域名不按路径，学生代码可用自己的 key 调 DeepSeek（README 已标注）② judge 请求不能传 temperature:0（kimi 拒绝）③ exact 模式实现未 e2e ④ verify() 失败状态语义已修（runner 抛错 → submission 置 FAILED，可重新提交/复验）
- **模型事实源（2026-09-21 官方 API 实测）**：可用模型 `deepseek-flash` / `deepseek-v4-pro`；`reasoning_effort` 合法值 `none|minimal|low|medium|high|xhigh|max`。DeepSeek key 已存 `server/.env`（DEEPSEEK_API_KEY，管理员侧）；容器路由已切官方（Moonshot 回退方法见 profile patch 注释）；`agent/request` 钉 reasoningEffort 会被 dsh-llm-deepseek 拒绝（UNSUPPORTED_REASONING_EFFORT），effort 只能 profile config 层生效
- deepseek-flash e2e 实测：verify 34.9s / 24.4k tokens，judge rationale 与 integrityCheck 全部真实

### 第 4 步：证据包与审计真实化 —— ✅ 已完成（2026-09-21）

- `evidence.ts` 的 `buildCapsule()` 已是真实实现：经 `ctx.sessionPersistence` 取**本工作目录下各会话**（按 `header.cwd` 归属，跨多次 DSH 启动）→ 按 `approval/`、`permission/` 前缀筛审计事件 → 递归脱敏（字符串 200 / 数组 50 / 深度 6）→ 产出 `nju-lab.capsule/v1`（`sessions` + `auditEvents` + sha256 `integrity`，`note` 不入哈希）落盘 `evidence.dshc`
- 审计事件（`approval/*`、`permission/*`）从会话事件**自动提取**，随提交一并交给平台，替代学生手填 JSON
- 上传与提交：`evidence.dshc` 与 `skill.zip` 分别 `POST /api/files`，再以 fileId 模式提交（`capsuleFileId` + `auditEvents` + `fileHashes`）
- 工具集钉死：`ctx.tools.restrict()` 实现 evalConfig.tools 白名单（claim 后对已存在的 agent 补一刀）
- 实测（真 `dsh --profile headless` + fake LLM，L2）：17 个会话事件 → `permission/preset`、`approval/policy` 两条审计事件，无降级；`test/dsh-e2e.test.mjs` 的 `.dshc` 用例通过
- 客户端侧实现见 `dsh/nju-lab-client/src/host/evidence.ts`；平台侧消费（`capsuleSha256` 对照 + `auditEventsReceived` 计数）在 `server/src/submissions/`

### 第 5 步：体验打磨 —— ✅ 已完成（2026-09-21）

- ~~profile 内加 skill / system prompt~~ 实现为**插件注册、随 profile 生效**（`dsh/nju-lab-client/src/host/guidance.ts`）：常驻 system prompt 段（`nju-lab:workflow`，order 1800）+ 通过 `ctx.skills.register()` 注册的 `nju-lab-experiment` skill（模型目录 + 按需加载全文 + 学生可 `/nju-lab-experiment` 调用）。选它而非磁盘 `SKILL.md` 的理由与实测见 `dsh/nju-lab-client/README.md` §4（skill 来源优先级 project 100/200 · **runtime 250** · custom 300 · user 400/500 · bundled 600，越小越优先）
- ClaimPanel：列表 / 领取 / 提交 / 钉定条件展示，并做过交互与错误提示打磨（未解锁 / 无 token / 未领取时按钮禁用并给出原因；已领取后领取按钮变「已领取」、提交才可用；动作结果渲染成可关闭的成功/失败横幅，摊开落盘目录、下载物名称/大小/路径、Skill 根、submission id、两个 sha256 前缀）
- 验证：L2「引导与 skill 到达模型」在真 `dsh --profile headless` 下通过 —— 引导文字出现在请求的 `system` 消息里，skill 出现在模型目录里，`skill` 工具返回 `<skill_content name="nju-lab-experiment">` 正文

### 工作量估计

第 1-5 步均已完成（2026-09-21）：插件侧由 `nju-lab-client` 承担（61 条测试 = 55 L1 + 6 L2，`DSH_BIN=… npm test` 在真 DSH 下全绿），平台侧第 1、3 步已上线，端到端验收通过（`docs/ACCEPTANCE-2026-09-21.md`）。生产化补齐：容器 SNI 白名单网络隔离（负向实测）、`evalConfig.model` 逐项目映射（v4-pro 实测）、verify 失败置 FAILED。剩余小项：评分口径（`pass` vs `passStrict`，当前 LLM judge 已覆盖主路径）、`exact` 模式 e2e。

## 5. 后续阶段（端到端之后，见 craft 文档 §10）

- ~~修改密码接口~~ ✅（2026-09-21：`POST /api/me/password`，成功后 tokenVersion+1 全端失效；Web 头像菜单弹窗）、~~数据库 migrations~~ ✅（见第 3.8 条）、~~后端常驻化~~ ✅（systemd，见第 2 节）、~~CSV 成绩导出~~ ✅（`GET /api/projects/:id/grades.csv`，项目详情页"导出成绩 CSV"按钮）
- ~~学校统一认证~~ ✅（2026-09-21，CAS 3.0 双轨）：`GET /api/auth/cas/login` → 南大 authserver → `/api/auth/cas/callback` 校验 ticket → 按学号/工号自动注册为学生（教师由管理员提权）；本地账号保留。配置 `CAS_BASE_URL`/`PUBLIC_BASE_URL`（已指向 authserver.nju.edu.cn，模拟 CAS 全流程实测通过；真实账号未实测）
- ~~学生端安装包/手册~~ ✅（2026-09-21）：`dsh/kit/build-kit.sh` 打包（profile + 插件产物 + install.sh + 手册）→ 静态托管 `https://lab.xiaohe.biz/kit/nju-lab-student-kit.zip`（nginx `location /kit/` 独立目录）；Web 学生菜单「客户端下载」页。插件更新后需重跑 build-kit + 部署
- ~~提交多版本~~ ✅（2026-09-22）：`submissions.version`（迁移 `SubmissionVersions1790002700000`，存量按 submittedAt 回填）；重复提交生成 v2、v3…，上限 10 版，仅最新版 `verifying` 中拒绝（原「非 failed 拒绝重复提交」废止）；每版本独立复验/评分；版本历史 `GET /api/assignments/:id/submissions`（学生限本人/教师限课程 owner）；项目提交列表、待批改、成绩 CSV、学生任务列表一律按**最新版**归并（修了 `listProjectSubmissions` Map 键覆盖取到最旧版的 bug）；Web 学生「我的提交」可交新版本+反馈 Drawer 版本切换，教师批改页版本切换；插件面板显示 `v{n}` +「提交新版本」。全链路真机实测（含真实容器复验 v4）
- 机房预装镜像
- nju-lab-client 提交前自检（skillforge 规范检查）
- SkillLibrary 参考技能库、章节自测题、成绩汇总

## 6. 协作方式备忘

- 前后端联调纪律见第 3.3 条；改后端后 `cd server && npm run build && sudo systemctl restart nju-lab`（或开发期 `start:dev` 重启）；改前端后需重新 build + 部署 /var/www
- 每完成一块，同步更新 `nju-lab-craft.md` §13（实现现状）与本 HANDOFF；代码提交进 git（main 分支）
