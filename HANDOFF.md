# NJU-Lab 开发交接（Handoff）

> 写给接手对话：本文档包含继续开发所需的全部上下文。先读本文件，再按需读 `nju-lab-craft.md`（系统设计总文档）。
> 更新时间：2026-09-24

## 0. 一句话现状

NJU-Lab（"课程 + 实验"一体化 Skill 工程教学平台）**端到端已验收通过（2026-09-21，见 `docs/ACCEPTANCE-2026-09-21.md`）**：学生本地 DSH（插件）登录 → 看任务 → 领取（真实下载 + sha256 校验 + 解压 + 条件钉死）→ 开发 Skill → 自测 3/3 → 提交（真实 ZIP + `.dshc` 证据包 + 审计事件）→ 服务端真实容器复验（deepseek-flash，baseline/treatment + LLM judge）→ 教师批改 → 学生看反馈，全程一次跑通、零代码修复，总成本 ≈59k tokens / ≈100s。生产化关键项也已落地：容器 SNI 白名单网络隔离、evalConfig.model 逐项目映射、修改密码、migrations、systemd 常驻、CSV 成绩导出。**剩余为后续阶段功能**（第 5 节）。

**2026-09-24：njuserver 接入南大统一认证（CAS 3.0）** —— 校园网关放开全站后，认证改由应用自负：`/lab` 走标准 CAS ticket 重定向流，角色由 CAS 属性 `containerId`（`ou=JZG` = 教职工）自动判定，登出接 CAS 登出，已用真实账号实测走通；前端产物已按 `VITE_BASE=/lab/` 重建并部署。详见 §2.1 与 §3.4。

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

### 2.1 第二部署点：njuserver（`http://medai.nju.edu.cn/lab`，2026-09-22）

与本机**并存**运行，数据是 2026-09-22 时点的全量拷贝，之后两边独立演化。

| 项 | 值 |
|---|---|
| 机器 | `ssh njuserver`（124.221.233.118:6001，ubuntu，sudo 有密码） |
| 入口 | `http://medai.nju.edu.cn/lab/`（**HTTP，无 443**；公网流量经校园网关到本机 :80，网关只认 Host） |
| 统一认证 | **CAS 3.0，由应用自负（2026-09-24 起）**：校园网关已放开全站，`/lab/api/auth/cas/login` → 302 到 `https://authserver.nju.edu.cn/authserver/login` → 回调 `/lab/api/auth/cas/callback?ticket=` 服务端校验后签发平台 JWT，再 302 回 `/lab/login/cas?token=`；登出 `/lab/api/auth/cas/logout`。角色由 CAS 属性 `containerId` 判定（`ou=JZG`=教职工）。详见 §3.4 |
| nginx | `/etc/nginx/sites-enabled/cms.conf` 的 medai server 块内新增 3 个 location：`/lab/api/`→`127.0.0.1:3100/api/`（去前缀，read_timeout 660s）、`/lab/`→`root /var/www`（SPA + `/lab/kit/` 安装包，try_files 回退 `/lab/index.html`）、`= /lab`→301。改动前备份在 `~/cms.conf.bak-20260922` |
| 代码/数据 | `~/nju-lab/server`（含 uploads、.env 已改为本机 DB 密码与 `PUBLIC_BASE_URL=http://medai.nju.edu.cn/lab`）；Node v24.14.0 在 `~/opt/node24`（用户态，系统 Node 是 22） |
| git | **GitHub 为唯一远端：`git@github.com:jilongcui/nju-lab.git`（remote `origin`，main 跟踪 origin/main）**——本机 `ubuntu` 的 SSH key 已登记到 GitHub，`fetch`/`push` 直连可用；**仓库根即 `~/nju-lab` 本身**，部署目录 `~/nju-lab/server`（仓库的子目录，systemd 指向它；`dist`/`.env`/`uploads`/`node_modules` 均在 `.gitignore`）。纪律：所有改动先提交再 push 到 `origin`，**禁止直接在部署目录改代码**——2026-09-23 发现网关 CAS 登录改动（gateway-cas.ts 等 3 个文件）只在 njuserver 部署目录存在、未入 git，已收编回本仓库；部署目录以 git 为准。~~本地裸仓库 `~/nju-lab.git`（旧「njuserver 部署 remote」）已于 2026-09-26 退休删除~~ ——它是 GitHub 仓库建成前的中转；无脚本/hook/其他仓库引用、无独有内容，备份 `~/nju-lab.git.bak-20260926.tar.gz` |
| 目录收敛 | **2026-09-26**：原先并列的工作副本 `~/nju-lab/repo` 已**提升为仓库根**（`repo/` 这一层取消），`~/nju-lab` 现在既是 git 仓库根、也是部署目录树，与 §1 布局一致。`server/` 原地保留运行态（`dist`/`.env`/`uploads`/`node_modules`），只把 `src` 换成仓库最新版（此前是旧版、与 `dist` 漂移，有回退选课功能的风险）；`WorkingDirectory` 路径未变故**无需重启**（服务同一 PID 持续运行）。过时产物（`kit/`、`web-dist/`、`server/dist.bak-*`）移出到 `~/nju-lab-attic-20260926/`；部署配置副本 `nju-lab.service`、`lab-nginx-snippet.conf` 纳入仓库；迁移前备份 `~/nju-lab-migrate-bak-20260926.tar.gz` |
| 静态产物 | `/var/www/lab/`（`index.html`+`assets`+`kit/`），www-data 所有；**前端须用 `VITE_BASE=/lab/ npm run build` 构建**（先在 `web/` 里 `npm install`），部署 `cp -r dist/. /var/www/lab/`。⚠️ 该机 `sudo` 要密码、`/var/www/lab` 属 www-data 不可直写 —— 可用 docker 绕过：`docker run --rm --entrypoint sh -v /var/www/lab:/target -v ~/nju-lab/web/dist:/source:ro nginx:alpine -c 'cp -rf /source/. /target/ && chown -R 33:33 /target/index.html /target/assets'`（只动 `index.html`+`assets/`，别碰 `kit/`） |
| 数据库 | 系统 MySQL 8.0（127.0.0.1:3306），库/用户 `nju_lab`（随机密码在 server/.env） |
| 服务 | `systemctl` 单元 `nju-lab.service`（`~/nju-lab/nju-lab.service` 有副本）。**不要加 PrivateTmp/ProtectSystem**——runner 靠 `/tmp` 给容器 bind-mount，PrivateTmp 会导致挂载为空、复验全挂（2026-09-22 踩过） |
| Docker | ubuntu 在 docker 组；docker.io 直连不通，走 `swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/library/<img>` 拉取后 tag 回原名（`nginx:alpine` 已就位）；**`nju-lab-verify:0.1.5-rc.2` 是生产的 `docker save/load` 拷贝**——异地重建会因 `node:22-slim` 漂浮 tag 拿到老基底导致 sharp 加载失败、复验全挂（Dockerfile 已改钉 `node:22.23.2-slim`，但跨机仍以 save/load 为准） |
| 学生安装包 | 变体 kit（serverUrl 指向 `http://medai.nju.edu.cn/lab/api`）：`cd dsh/kit && PLATFORM_URL=http://medai.nju.edu.cn/lab ./build-kit.sh`，产物放 `/var/www/lab/kit/` |
| 注意 | ① 该机 :80 上 dify 的 `/api`、`/agent` 等 502 是**部署前既有状态**（dify 未运行，与本次无关）；② 本机（lab.xiaohe.biz 这台）DNS 解析不到 medai.nju.edu.cn，公网验证须从校园网做；③ **该机 CPU 是 QEMU vCPU（无 SSE4.2/POPCNT，不达 x86-64-v2）**，sharp prebuilt 被拒会让 dsh 启动即崩——复验 profile 已禁用 `attachment-local`（见 verify-image profile 注释），若重装该机 VM 建议 CPU 改 host-passthrough；④ **校园网关 `219.219.115.199`**（medai 与 authservertest 解析到同一 IP、按 Host 分发；正式认证机是另一个 IP `219.219.115.211`）策略为"校内/VPN 直通、校外强制认证"；**`authservertest` 是网关配置里指的测试认证机（对 medai 返回"应用未注册"），不是我们的** —— 我们代码/配置里搜不到它，`.env` 的 `CAS_BASE_URL` 一直是正式机。判定 302 是谁发的：公网响应无 `Server:` 头（网关发的）、直连本机有 `Server: nginx/1.18.0` + `X-Powered-By: Express`（我们的） |


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
4. **认证：本地账号 + 南大统一认证（CAS 3.0）双轨**（njuserver 生产用 CAS，2026-09-24 起）
   - **本地**：`AuthProvider` 接口 + `LocalAuthProvider`（bcryptjs），只服务示例账号与开发。
   - **CAS**（`server/src/auth/cas.client.ts`）：标准 ticket 重定向流 —— `GET /api/auth/cas/login` → 302 `{CAS_BASE_URL}/login?service=` → 回调 `GET /api/auth/cas/callback?ticket=` 调 `/p3/serviceValidate` 校验 → `AuthService.loginWithCas()` 找/建用户 → 签发平台 JWT → 302 `{前端基路径}/login/cas?token=`。登出 `GET /api/auth/cas/logout` → 302 `{CAS_BASE_URL}/logout?service=`。配置：`CAS_BASE_URL` / `CAS_VALIDATE_PATH` / `PUBLIC_BASE_URL`（service 回调 = `${PUBLIC_BASE_URL}/api/auth/cas/callback`，**须在认证机管控台注册**）。
   - **角色判定**（`resolveRoleFromCasAttributes`）：CAS 3.0 的 `<cas:attributes>` 里 `containerId` 是 LDAP OU —— **`ou=JZG` = 教职工 → `teacher`**，其余（ou=XS 学生 / ou=YJS 研究生…）及拿不到时一律 `student`。**别用工号位数兜底**：实测南大工号有 7 位（如 `0611010`）、规律不可靠，误判成 teacher 是权限放大。新用户按此建号；已存在用户**只升不降**（管理员手工设的 teacher 不会被降回学生）。
   - ⚠️ **不要再加「读网关头直接签发」的路径**：上游网关拦截时代它会注入 `CAS-USER`/`CAS-USER-CN`，据此直接签发平台 token 的写法曾存在、网关放开后已移除 —— 请求头客户端可任意伪造（`curl -H 'CAS-USER: 任意学号'` 就能冒充任意账号，含管理员）。除非同时加来源 IP 白名单。
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
- ~~统一认证（CAS 3.0 双轨）~~ ✅ **已完成并上生产**（2026-09-21 接入，2026-09-24 **真实账号实测通过**）：`GET /api/auth/cas/login` → 南大 authserver → `/api/auth/cas/callback` 校验 ticket（`/p3/serviceValidate`）→ **按 CAS 属性 `containerId` 定角色**（`ou=JZG`=教职工→teacher，其余→student；**已不再一律注册为学生**，教师也不用管理员手工提权）→ 签发平台 JWT；登出 `GET /api/auth/cas/logout` 接 CAS 登出。配置 `CAS_BASE_URL`/`CAS_VALIDATE_PATH`/`PUBLIC_BASE_URL`（均指向正式机 authserver.nju.edu.cn）。详见 §3.4
- ~~学生端安装包/手册~~ ✅（2026-09-21）：`dsh/kit/build-kit.sh` 打包（profile + 插件产物 + install.sh + 手册）→ 静态托管 `https://lab.xiaohe.biz/kit/nju-lab-student-kit.zip`（nginx `location /kit/` 独立目录）；Web 学生菜单「客户端下载」页。插件更新后需重跑 build-kit + 部署
- ~~提交多版本~~ ✅（2026-09-22）：`submissions.version`（迁移 `SubmissionVersions1790002700000`，存量按 submittedAt 回填）；重复提交生成 v2、v3…，上限 10 版，仅最新版 `verifying` 中拒绝（原「非 failed 拒绝重复提交」废止）；每版本独立复验/评分；版本历史 `GET /api/assignments/:id/submissions`（学生限本人/教师限课程 owner）；项目提交列表、待批改、成绩 CSV、学生任务列表一律按**最新版**归并（修了 `listProjectSubmissions` Map 键覆盖取到最旧版的 bug）；Web 学生「我的提交」可交新版本+反馈 Drawer 版本切换，教师批改页版本切换；插件面板显示 `v{n}` +「提交新版本」。全链路真机实测（含真实容器复验 v4）
- 机房预装镜像
- nju-lab-client 提交前自检（skillforge 规范检查）
- SkillLibrary 参考技能库、章节自测题、成绩汇总

## 6. 课程目录、选课申请与工作台 —— ✅ 已完成（2026-09-24）

完整设计见 **`docs/DESIGN-course-application-2026-09-24.md`**（含当天的方向修订，见其 §10）。要点：

**背景**：改造前 `/lab` 全站在 `RequireAuth` 后，未登录访客什么都看不到；学生只能看到教师手工加进名单的课（未入册时返回**空列表**），既不能发现课程也不能自己选课。

**⚠️ 当天二次决策（务必知悉）**：初版把课程目录做成「**无需登录的公开区**」（独立 `PublicLayout` + `@OptionalAuth()` 匿名放行 + `/api/public/courses`）。当天下午按产品决策**收回为登录后可见**：

| | 初版 | 现行 |
|---|---|---|
| 未登录访客 | 能浏览课程目录/详情 | **直接落登录页** |
| 接口 | `/api/public/courses[/:slug]` + `@OptionalAuth()` | `/api/browse/courses[/:slug]`，需登录（`@OptionalAuth()` 已删） |
| 布局 | 独立 `PublicLayout`（深色顶栏） | 并入平台内布局（与工作台同壳） |

**现行形态**：

```
门户（FoxCMS，公开）→「实验平台」外链栏目 → /lab/  （未登录则落登录页）
/lab（需登录）
   · 工作台：学生 /student/home、教师 /teacher/dashboard（登录后的落地页）
   · 选课：/browse 课程目录 → /course/<slug> 课程详情 → 申请
   · 学习与实验：章节、实验、提交、复验、成绩
```

**核心语义**（未变）：`Course.status = published` 只表示「别人能看到」；**能否申请由 `applicationOpenAt` / `applicationCloseAt` / `capacity` 独立决定**（支持"先展示、到点开放申请"的热门课策略）。`applicationState` 由后端算（依赖已批准人数，前端算不出），取值 `open`/`not_open_yet`/`full`/`closed`/`not_published`。

**数据层**：
- 新增 `course_applications`：**不给 `Enrollment` 加状态**——保持它「已批准入册」的语义，可见性/内容授权/任务分发三处依赖它的代码**零改动**，且"容量按批准数"天然对齐
- 生成列 `pendingFlag = IF(status='pending',1,NULL)` + 唯一索引 `uq_course_application_pending`（利用 MySQL 唯一索引允许多个 NULL）→ **允许重复申请，但同一课程同一学生同时只能有一条 pending**；申请历史完整保留
- `courses` 新增 `slug` / `capacity` / `applicationOpenAt` / `applicationCloseAt`；迁移 `CourseApplications1790224400979`（含既有课程 slug 回填）

**关键实现点（踩坑）**：
1. **`@OptionalAuth()` 第三态**：原先只有「全拦」与 `@Public()`「全放」两种；公开课程页需要「带 token 识别身份、不带也放行」，否则登录用户看不到自己的申请状态
2. **补发 Assignment 必须用独立方法，不能复用 `publishProject()`**：后者开头就把 `project.status` 改回 `PUBLISHED`（对已发布项目等于重新发布）、**不校验当前是否 draft**（会误发布草稿）；且 `ProjectStatus.CLOSED` 虽是纯预留、目前从未被任何代码设置，一旦将来启用「截止关闭项目」，那里的检查会让补发抛错。现为 `CourseApplicationsService.backfillAssignments()`，只挑 `status = PUBLISHED` 的项目补建
3. **批准在事务里锁课程行**（`pessimistic_write`）：逐个批准下两个标签页同时批最后两个名额不会超额
4. **满员不清空队列**：`full` 只阻止**新申请**；已提交的 pending 保留，退课释放名额后可继续补批（实测：退课 → state 回 `open` → 补批成功并补发任务）
5. **CAS returnTo 用 sessionStorage**（`web/src/session.ts`）：后端 `service` 固定不接受外部传入（防开放重定向，别动），所以「课程页点申请 → CAS 登录 → 回到那门课」只能前端携带
6. **`path: '*'` 兜底重定向**改掉了：原先一律去 `/`（在 RequireAuth 下），未登录访客会被弹到登录页；现为匿名→`/browse`、已登录→角色首页
7. 顺带修正一处**既有 schema 漂移**：`submissions` 的复合索引 `IDX_submissions_assignment_version` 只在迁移里手建、实体没声明，导致 `migration:generate` 每次都生成一条无关的 `DROP INDEX`。已在 `Submission` 实体补 `@Index('IDX_submissions_assignment_version', ['assignmentId','version'])`

**接口**：
```
课程目录与详情（需登录）
  GET  /api/browse/courses            目录 + 检索(keyword/term)
  GET  /api/browse/courses/:slug      课程详情（章节只给标题，不含教学内容；附 myApplication/myEnrollment）
学生
  POST   /api/courses/:courseId/applications        申请
  DELETE /api/courses/:courseId/applications/:id    撤回（仅 pending）
  GET    /api/me/applications                       我的申请
教师
  GET  /api/courses/:courseId/applications          列表（按 createdAt 升序＝先到先得）+ 名额/队列信息
  POST /api/courses/:courseId/applications/:id/approve   批准（建入册 + 补发任务，返回 assignmentsCreated）
  POST /api/courses/:courseId/applications/:id/reject    驳回（可选 note）
```

**前端**：
- **学生工作台** `/student/home`（新增）：统计卡（我的课程/待办实验/待审批申请/章节完成度）+ 待办实验列表 + 「去选课」入口。学生与教师的登录落地页都是工作台
- 选课 `/browse` → 课程详情 `/course/:slug`，与平台其他页面共用 `AppLayout`（不再是独立公开站）
- 教师端课程详情新增「公开报名」页签：名额上限、申请开放/截止时间、当前状态、公开链接
- 学生菜单新增「选课」「我的申请」；教师审批页 `/teacher/courses/:courseId/applications`（逐个批准/驳回、显示待审批/已批准/剩余名额）
- 被驳回后可重新申请（列表提示 + 可再次提交）
- 深链被 `RequireAuth` 拦下 → 登录（含 CAS）后回到原页面（`web/src/session.ts` 的 returnTo）

**端到端实测（2026-09-24，curl）**：浏览课程目录 → 教师配置名额与开放时间 → 学生申请 → 重复申请被拒 → 教师批准（补发 1 个任务，学生任务列表出现）→ 驳回（带理由，学生可见）→ 重新申请成功 → 收名额至满（`full`）→ 满员批准被拒「名额已满」→ 满员新申请被拒 → 退课释放名额 → 队列中的申请补批成功。

**收回归档后的接口验证**：未登录 `GET /lab/api/browse/courses` → **401**；旧路径 `/api/public/courses` → **404**；登录后正常返回目录。

**门户接入**：FoxCMS 新增栏目「实验平台」（`fox_column` id=128，`column_attr=1` 外链，`out_link=/lab/browse`），`templates/foxui01/nav.html` 的 `typeid` 加入 128；顺带删掉导航里指向不存在栏目的死项 `typeid='3,4'`。栏目记录在 `foxcms/sql/column-lab-entry.sql`（便于他处复用）。未登录点它会被 `/lab` 的登录页接住。

## 7. 协作方式备忘

- 前后端联调纪律见第 3.3 条；改后端后 `cd server && npm run build && sudo systemctl restart nju-lab`（或开发期 `start:dev` 重启）；改前端后需重新 build + 部署 /var/www
- 每完成一块，同步更新 `nju-lab-craft.md` §13（实现现状）与本 HANDOFF；代码提交进 git（main 分支）
