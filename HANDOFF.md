# NJU-Lab 开发交接（Handoff）

> 写给接手对话：本文档包含继续开发所需的全部上下文。先读本文件，再按需读 `nju-lab-craft.md`（系统设计总文档）。
> 更新时间：2026-09-21

## 0. 一句话现状

NJU-Lab（"课程 + 实验"一体化 Skill 工程教学平台）的 **Web 平台已上线可用**，**平台文件上传/下载已落地**（files 模块），**真实容器复验已上线**（`DockerEvaluationRunner`：一次性容器 + baseline/treatment + LLM judge，deepseek-flash 实测通过，可切回 Mock），**DSH 客户端插件骨架已搭好**；距离真正端到端（学生本地 DSH 完成实验全流程）还差插件侧收尾 + 联调，缺口清单与实施顺序见第 4 节。

## 1. 仓库布局

```
/home/ubuntu/nju-lab/
├── nju-lab-craft.md          # 系统设计总文档（含实现现状 §13）
├── HANDOFF.md                # 本文件
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
| 后端启动 | `cd server && npm run start:dev`（当前以后台任务运行；生产常驻化未做） |
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
8. **TypeORM `synchronize: true`**（开发模式），改实体即改表；生产前需 migrations。
9. **DSH 侧**：`agent/request` 是 waterfall，只能钉 provider/model/reasoningEffort/maxTokens；**钉工具集要用 `ctx.tools.restrict()`**；client 半由 client-modules 服务按 `package.json` 的 `dsh.client` 自动扫描挂载；slot 组件拿不到 ctx。
10. **复验安全姿态**（verify profile）：一次性容器 + 断网 + `approval=never` + 资源限额。容器是唯一信任边界（DSH 沙箱不挡网络与进程）。

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

### 第 2 步：插件 token 获取 + 提交工具（平台侧 token 已完成，插件侧实现中）

**完整需求与契约见 `dsh/nju-lab-client/REQ-2026-09-21-submit-pipeline.md`**（claim 新响应结构、files API、submit fileId 模式、端到端验收标准；含联调测试环境说明——示例项目已绑定真实模板/数据集，student1 任务已重置为 pending）。要点：

- token（平台侧 ✅ 2026-09-21，D-lite+ 方案）：`POST /api/me/tokens` 签发 365 天 token（payload 带 `ver`）；`POST /api/me/tokens/revoke` 吊销（`User.tokenVersion`+1，全部 token 含 Web 登录态失效，JWT validate 逐请求比对）；Web 右上角头像菜单「API Token」弹窗可生成/复制/吊销。插件侧只剩 settings 配置项（serverUrl+token）
- `nju_lab_submit` 工具：打包学生 Skill 目录为 ZIP、逐文件 sha256（fileHashes）、分别 POST /api/files 上传、以 fileId 模式提交
- ClaimPanel 从占位变真实面板（拉任务列表、领取/提交按钮）
- claim 工具需真实下载模板/数据集并校验 sha256；`evalConfig.tools` 用 `ctx.tools.restrict()` 钉白名单

### 第 3 步：复验实证 + 真实执行器（平台侧最重）

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
- **已知遗留**：① 容器未断网（决策：白名单代理留生产化）② evalConfig.model 暂未逐项目映射进容器（实际模型由镜像 profile 钉死 deepseek-flash/low；逐项目映射留生产化）③ judge 请求不能传 temperature:0（kimi 拒绝）④ exact 模式实现未 e2e ⑤ 学生 scripts 任意代码——生产前必须落实网络隔离
- **模型事实源（2026-09-21 官方 API 实测）**：可用模型 `deepseek-flash` / `deepseek-v4-pro`；`reasoning_effort` 合法值 `none|minimal|low|medium|high|xhigh|max`。DeepSeek key 已存 `server/.env`（DEEPSEEK_API_KEY，管理员侧）；容器路由已切官方（Moonshot 回退方法见 profile patch 注释）；`agent/request` 钉 reasoningEffort 会被 dsh-llm-deepseek 拒绝（UNSUPPORTED_REASONING_EFFORT），effort 只能 profile config 层生效
- deepseek-flash e2e 实测：verify 34.9s / 24.4k tokens，judge rationale 与 integrityCheck 全部真实

### 第 4 步：证据包与审计真实化

- `evidence.ts` 的 `buildCapsule()` 从 sha256 骨架变为真实实现：接 dsh-session-persistence 导出会话事件 → 清单 + 脱敏 + sha256 → .dshc
- 审计事件（approval/asked、decided、permission/preset）从会话事件自动提取，替代学生手填 JSON
- 工具集钉死：`ctx.tools.restrict()` 实现 evalConfig.tools 白名单

### 第 5 步：体验打磨

- profile 内加 skill / system prompt，引导模型在合适时机调用 nju_lab_* 工具
- ClaimPanel 完整交互、错误提示

### 工作量估计

插件侧 3-5 天 + 平台侧 2-3 天（第 1 步已完成）+ 联调 1-2 天 ≈ **一人 1-1.5 周**。最大不确定点是第 3 步的 dsh-teach 实证，建议平台侧优先做。

## 5. 后续阶段（端到端之后，见 craft 文档 §10）

- 学生端 profile 一键安装脚本/安装手册、机房镜像
- nju-lab-client 提交前自检（skillforge 规范检查）
- 学校统一认证（新 AuthProvider）、修改密码接口、数据库 migrations、后端常驻化（pm2/systemd）
- SkillLibrary 参考技能库、CSV 成绩导出、章节自测题、成绩汇总

## 6. 协作方式备忘

- 前后端联调纪律见第 3.3 条；改后端后需重启后台任务（或让主对话重启）；改前端后需重新 build + 部署 /var/www
- 每完成一块，同步更新 `nju-lab-craft.md` §13（实现现状）与本 HANDOFF
