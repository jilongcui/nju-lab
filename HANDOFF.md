# NJU-Lab 开发交接（Handoff）

> 写给接手对话：本文档包含继续开发所需的全部上下文。先读本文件，再按需读 `nju-lab-craft.md`（系统设计总文档）。
> 更新时间：2026-09-28（工作台交接）

## 0. 一句话现状

NJU-Lab（"课程 + 实验"一体化 Skill 工程教学平台）**端到端已验收通过（2026-09-21，见 `docs/ACCEPTANCE-2026-09-21.md`）**：学生本地 DSH（插件）登录 → 看任务 → 领取（真实下载 + sha256 校验 + 解压 + 条件钉死）→ 开发 Skill → 自测 3/3 → 提交（真实 ZIP + `.dshc` 证据包 + 审计事件）→ 服务端真实容器复验（deepseek-flash，baseline/treatment + LLM judge）→ 教师批改 → 学生看反馈，全程一次跑通、零代码修复，总成本 ≈59k tokens / ≈100s。生产化关键项也已落地：容器 SNI 白名单网络隔离、evalConfig.model 逐项目映射、修改密码、migrations、systemd 常驻、CSV 成绩导出。**剩余为后续阶段功能**（第 5 节）。

**2026-09-24：njuserver 接入南大统一认证（CAS 3.0）** —— 校园网关放开全站后，认证改由应用自负：`/lab` 走标准 CAS ticket 重定向流，角色由 CAS 属性 `containerId`（`ou=JZG` = 教职工）自动判定，登出接 CAS 登出，已用真实账号实测走通；前端产物已按 `VITE_BASE=/lab/` 重建并部署。详见 §2.1 与 §3.4。

**2026-09-28：教师端「课程报名审批」独立页并入课程详情「学生管理」页签**（纯前端整理，后端接口与数据模型未动）—— 报名申请与选课名单合成**一张统一表格**（每行一名学生，状态区分 待审批/已通过/已驳回/已入册，行内直接批准/驳回/移出），删除独立路由 `/teacher/courses/:courseId/applications` 与页面文件 `web/src/pages/teacher/CourseApplications.tsx`；「公开报名」页签（名额上限/申请开放时间等**课程设置**）保持不变，其「去处理报名申请」按钮改为切到「学生管理」页签。

**2026-09-28：njuserver 存储扩容** —— 根分区 49G→**98G**（可用 9G→**60G**），新增 LVM 数据盘 `/data` = **957G**（1T 的 `sda` 整盘做 PV 加入 `ubuntu-vg`，`-l 95%FREE` + `mkfs.ext4 -m 1`）。此前"根分区仅剩 9G"是该机最高风险项（写满会拖垮同机的生产 MySQL），已解除；为后续「平台侧兜底实验工作台」预留空间。详见 §2.1 与 `docs/OPS-2026-09-28-storage-expansion.md`。

**2026-09-28：平台侧实验工作台 —— 后端与容器已端到端实测，nginx 与浏览器待验** —— 给"本地装不上 DSH"的学生提供浏览器即可用的实验环境。已落地：**工作台镜像**（`server/workspace-image/`）、**工作台后端**（`server/src/workspace/`）、**通用容器运行时**（`server/src/container-runtime/`，与复验共用同一份隔离策略）。~~前端入口页未做、nginx 反代未在真实环境验证、浏览器实测未做~~ —— **均已完成**
（2026-09-28/29：入口页、nginx 片段落地、浏览器中 claim 与对话交互验证通过；剩「提交 → 复验」）。设计与遗留见 **§8**（新接手者必读）与 `docs/DESIGN-2026-09-28-platform-workspace.md`。

## 1. 仓库布局

```
/home/ubuntu/nju-lab/
├── nju-lab-craft.md          # 系统设计总文档（含实现现状 §13）
├── HANDOFF.md                # 本文件
├── docs/                     # ACCEPTANCE-2026-09-21 / OPS-2026-09-28（存储扩容）/ DESIGN-2026-09-28（工作台设计）
├── server/                   # NestJS + TypeORM + MySQL 后端（端口 3100）
│   ├── src/container-runtime/  # 通用容器运行时（复验与工作台共用；隔离策略唯一来源）
│   ├── src/workspace/         # 平台侧实验工作台后端（见 §8）
│   ├── verify-image/          # 复验镜像（headless bundle + run-eval.mjs）
│   └── workspace-image/       # 工作台镜像（web-app bundle + entrypoint.mjs）
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
| 静态产物 | `/var/www/lab/`（`index.html`+`assets`+`kit/`）。**前端须用 `VITE_BASE=/lab/ npm run build` 构建**（先在 `web/` 里 `npm install`）；部署走仓库脚本 **`bash deploy/deploy-web-lab.sh`**（构建 → 备份 → **先写 assets 新 chunk、最后换 index.html** → md5 + Content-Type 自检，失败自动回滚）。⚠️ **2026-09-29 起 `index.html`/`assets/` 属主已从 `www-data`(33) 改为 `ubuntu`(1000)**，可直接 `cp`，不再需要 sudo；若属主再次变回非当前用户（会话里 `ls` 显示 `nobody:65534`），按 §2.2 第 5 条「属主修复」处理。历史 docker 绕过（`cp -rf /source/. /target/ && chown -R 33:33 …`）只在需要把属主恢复成 www-data 时用；只动 `index.html`+`assets/`，别碰 `kit/`。纪律见 §2.2 |
| 数据库 | 系统 MySQL 8.0（127.0.0.1:3306），库/用户 `nju_lab`（随机密码在 server/.env） |
| 服务 | `systemctl` 单元 `nju-lab.service`（`~/nju-lab/nju-lab.service` 有副本）。**不要加 PrivateTmp/ProtectSystem**——runner 靠 `/tmp` 给容器 bind-mount，PrivateTmp 会导致挂载为空、复验全挂（2026-09-22 踩过） |
| Docker | ubuntu 在 docker 组；docker.io 直连不通，走 `swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/library/<img>` 拉取后 tag 回原名（`nginx:alpine` 已就位）；**`nju-lab-verify:0.1.5-rc.2` 是生产的 `docker save/load` 拷贝**——异地重建会因 `node:22-slim` 漂浮 tag 拿到老基底导致 sharp 加载失败、复验全挂（Dockerfile 已改钉 `node:22.23.2-slim`，但跨机仍以 save/load 为准） |
| 注意⑦ | **agent 会话（Reasonix）跑在"只读根 + 仅 workspace 可写"的沙箱里**：用受限会话自己的 shell 看 `/proc/mounts`，会看到 `/` 与 `/data` 都是 `ro`（还会多出一条 `udev … /home/ubuntu/.reasonix/.env devtmpfs ro`）——**那是沙箱的视图，不是宿主状态**（宿主一直是 `rw`，见 `mount` 实测）。**要判定宿主文件系统/权限，一律用 docker**（`docker run --rm -v /data:/d …`）或看服务日志。⚠️ 2026-09-29 曾据此误报"根分区被内核降级为只读"，实际是假象，已更正。另外 `/data` 属 `root:root`，后端以 `ubuntu` 跑，所以 **`/data/workspaces` 需要一次性建好并 chown 给 ubuntu**（已用 docker 完成） |
| 存储 | **2026-09-28 扩容**：根分区 49G→**98G**（可用 9G→**60G**）；新增 LVM 数据盘 `/data` = **957G**（1T 的 `sda` 整盘做 PV 加入 `ubuntu-vg`，`lvcreate -l 95%FREE`、`mkfs.ext4 -m 1`、fstab 用 UUID + `nofail`），VG 余量 51.2G。此前"根分区仅剩 9G"是最高风险项，已解除；清单见 `docs/OPS-2026-09-28-storage-expansion.md` |
| 学生安装包 | 变体 kit（serverUrl 指向 `http://medai.nju.edu.cn/lab/api`）：`cd dsh/kit && PLATFORM_URL=http://medai.nju.edu.cn/lab ./build-kit.sh`，产物放 `/var/www/lab/kit/` |
| 注意 | ① 该机 :80 上 dify 的 `/api`、`/agent` 等 502 是**部署前既有状态**（dify 未运行，与本次无关）；② 本机（lab.xiaohe.biz 这台）DNS 解析不到 medai.nju.edu.cn，公网验证须从校园网做；③ **该机 CPU 是 QEMU vCPU（无 SSE4.2/POPCNT，不达 x86-64-v2）**，sharp prebuilt 被拒会让 dsh 启动即崩——复验 profile 已禁用 `attachment-local`（见 verify-image profile 注释），若重装该机 VM 建议 CPU 改 host-passthrough；④ **校园网关 `219.219.115.199`**（medai 与 authservertest 解析到同一 IP、按 Host 分发；正式认证机是另一个 IP `219.219.115.211`）策略为"校内/VPN 直通、校外强制认证"；**`authservertest` 是网关配置里指的测试认证机（对 medai 返回"应用未注册"），不是我们的** —— 我们代码/配置里搜不到它，`.env` 的 `CAS_BASE_URL` 一直是正式机。判定 302 是谁发的：公网响应无 `Server:` 头（网关发的）、直连本机有 `Server: nginx/1.18.0` + `X-Powered-By: Express`（我们的）；⑤ **该机不支持嵌套虚拟化**（无 `/dev/kvm`、无 kvm 模块，2026-09-28 实测）——**不能跑 KVM 虚拟机**，"每人一台 VM"在该机不可行，只能走容器；⑥ dify 遗留容器仍在运行（`docker-sandbox-1`/`db-1`/`redis-1`/`weaviate-1`/`ssrf_proxy-1`，Up 3 months），其中 **`docker-sandbox-1` 占约 8.2G 内存且 `--memory 0`（无限额）+ `restart=always`**，是内存侧唯一会突然挤爆的隐患，`~/dify` 另占磁盘 8.5G —— 处置前须确认学院无人使用 |


常用验证：

```bash
mysql -h 127.0.0.1 -u nju_lab -pnju_lab_dev nju_lab          # 进数据库
curl -s http://127.0.0.1:3100/api/auth/login -X POST \
  -H 'Content-Type: application/json' \
  -d '{"username":"teacher","password":"teacher123"}'        # 登录拿 token
# 经 nginx 测线上：curl -sk --resolve lab.xiaohe.biz:443:127.0.0.1 https://lab.xiaohe.biz/...
```

### 2.2 前端产物部署纪律（2026-09-29 踩坑，别再踩）

同步 `/var/www/lab` 用 `bash deploy/deploy-web-lab.sh`（普通用户即可，不需要 sudo）。脚本固化的就是下面五条，
手工部署时同样必须遵守：

1. **顺序铁律：先写 `assets/` 新 chunk，最后才换 `index.html`。**
   `/lab/` 是 `try_files $uri $uri/ /lab/index.html` 的 SPA 回退 —— 若 index.html 先换、chunk 还没到位，
   浏览器要的 `/lab/assets/x.js` 会拿到 **`200` + `text/html`**（回退成 index.html 正文），ES module 按 MIME 解析即失败
   → **页面白屏，而 curl 看状态码一切正常**。实测：
   `curl -s -o /dev/null -w '%{http_code} %{content_type}\n' -H 'Host: medai.nju.edu.cn' http://127.0.0.1/lab/assets/NONEXISTENT.js` → `200 text/html`。
   2026-09-29 就是这么把线上短暂搞白过一次（发现后先回滚 index.html，再按正确顺序重做）。
2. **验证铁律：不能只看状态码。** 按**线上 index.html 实际引用的资源**逐个探测，要求 `Content-Type: application/javascript`，
   并与本地 `web/dist` 核对 md5。脚本第 4、6 步做的正是这两件事，自检失败会把 index.html 自动回滚成备份。
3. **旧 chunk 不删。** `assets/` 里同时保留几代 hash，缓存着旧 index.html 的浏览器才不会 404。
4. **会话里看到的 `nobody:65534` 就是宿主上的 `www-data`，别当成陌生属主。** Reasonix 会话跑在 user namespace 里，
   `cat /proc/self/uid_map` = `1000 0 1`（只有这一个映射）：除 uid 1000 外的属主一律显示为 overflow id `65534`，
   而且 **ns 内的权限检查会拒绝写入 —— 宿主上是 root 身份也没用**，`danger-full-access` 也无效（它只放开沙箱路径白名单，
   不改 inode 属主）。判定宿主真实属主用 docker：
   `docker run --rm -v /var/www/lab:/d nginx:alpine stat -c '%A %U:%G %n' /d /d/assets`（本机 docker.io 不通，用已就位的 `nginx:alpine`）。
   同理**沙箱内的报错不一定等于宿主结果**：2026-09-29 一次 `mv` 在会话里报了 6 条 `Permission denied`，宿主上其实已移动完成
   —— 结论一律以 docker / HTTP 实测为准（同 §2.1 注意⑦）。
5. **属主修复**（仅当 `assets/` 再次不属于当前用户、脚本提示不可写时）：
   `mv /var/www/lab/assets /var/www/lab/assets.pre-deploy-<ts>`（rename 只需父目录写权限）→
   `mkdir -m 755 /var/www/lab/assets` → 从旧目录补回历史 chunk → 再跑部署脚本（顺序仍是 chunk 先、index.html 后）。

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
7. **部署纪律**：禁止把 Vite dev server 挂 nginx 当生产（HMR WebSocket 必挂）；前端产物放 `/var/www/nju-lab/dist`（不能放 `/home/ubuntu`，750 权限）；`sites-enabled/` 下所有文件都会被 nginx 加载，备份文件必须移出。**线上 `/lab` 前端静态产物同步的顺序与校验见 §2.2**（先 chunk 后 index.html；缺 chunk 会被 SPA 回退伪装成 `200 text/html`）。
8. **TypeORM migrations**：`synchronize: false` + `migrationsRun: true`（启动自动执行）；初始迁移 `src/migrations/1790002605000-InitialSchema.ts`（已在既有库手工登记、在空库实测建表后 schema:log 零 diff）。改实体后：`npm run typeorm migration:generate -- src/migrations/<Name>` 生成迁移并核对 SQL，新环境启动即自动建表。
9. **DSH 侧**：`agent/request` 是 waterfall，只能钉 provider/model/reasoningEffort/maxTokens；**钉工具集要用 `ctx.tools.restrict()`**；client 半由 client-modules 服务按 `package.json` 的 `dsh.client` 自动扫描挂载；slot 组件拿不到 ctx。
10. **复验安全姿态**（verify profile）：一次性容器 + 断网 + `approval=never` + 资源限额。容器是唯一信任边界（DSH 沙箱不挡网络与进程）。
11. **给模型的引导**（system prompt 段、skill）由**插件注册**即可随 profile 生效：`ctx.systemPrompt.section()` + `ctx.skills.register()`（见 `nju-lab-client/src/host/guidance.ts`），不必改 profile 文件。磁盘 `SKILL.md` 路线要额外配 `customSkillDirs` / `bundledSkillDir`，**profile 目录不是默认 skill 发现根**，且 `bundledSkillDir` 按进程 cwd 解析。skill 来源优先级（越小越优先）：project 100/200 · runtime 250 · custom 300 · user 400/500 · bundled 600。
12. **L2 测试要带 `DSH_BIN`**：`npm test` 在 PATH 上找不到 `dsh` 时，L2 用例是 **skip**（TAP `ok … # SKIP`）而不是失败，看起来全绿但什么都没验。另外 L2 启动 `dsh` 必须给临时 `cwd`，否则插件的默认 `workspaceDir`（`process.cwd()`）会把 `nju-lab/` 落盘目录写进仓库。
13. **容器隔离策略只有一份实现**：复验与工作台共用 `server/src/container-runtime/`（限额 / internal 网络 / SNI 白名单 / 挂载顺序都在 `buildRunArgs` 里定义一次）。**不要在业务模块里另写一套 docker 参数**——两处漂移就是安全配置漂移。
14. **评估条件必须跨进程持久化**：`evalConfig` 不能只存插件闭包 —— DSH 每次启动都是新进程（headless 每条任务一个），重启后工具面会重新放开，等于"学生自测条件 ≠ 平台复验条件"。插件做法（`nju-lab-client/src/host/eval-state.ts`）：claim 时写 `<workspace>/nju-lab/pinned-eval-config.json`，`apply()` 启动时读回并**优先于配置里的默认值**；平台本次未下发条件时**清掉旧值**，避免上一个实验的限制被继承。文件损坏/形状不对只警告并忽略（不能因为状态文件起不来）。

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
- 学生菜单新增「选课」「我的申请」；教师报名审批（逐个批准/驳回、显示待审批/已批准/剩余名额）——**2026-09-28 并入课程详情「学生管理」页签**（报名申请与选课名单合为一张统一表格），原独立页 `/teacher/courses/:courseId/applications` 已取消
- 被驳回后可重新申请（列表提示 + 可再次提交）
- 深链被 `RequireAuth` 拦下 → 登录（含 CAS）后回到原页面（`web/src/session.ts` 的 returnTo）

**端到端实测（2026-09-24，curl）**：浏览课程目录 → 教师配置名额与开放时间 → 学生申请 → 重复申请被拒 → 教师批准（补发 1 个任务，学生任务列表出现）→ 驳回（带理由，学生可见）→ 重新申请成功 → 收名额至满（`full`）→ 满员批准被拒「名额已满」→ 满员新申请被拒 → 退课释放名额 → 队列中的申请补批成功。

**收回归档后的接口验证**：未登录 `GET /lab/api/browse/courses` → **401**；旧路径 `/api/public/courses` → **404**；登录后正常返回目录。

**门户接入**：FoxCMS 新增栏目「实验平台」（`fox_column` id=128，`column_attr=1` 外链，`out_link=/lab/browse`），`templates/foxui01/nav.html` 的 `typeid` 加入 128；顺带删掉导航里指向不存在栏目的死项 `typeid='3,4'`。栏目记录在 `foxcms/sql/column-lab-entry.sql`（便于他处复用）。未登录点它会被 `/lab` 的登录页接住。

## 7. 协作方式备忘

**仓库与远端（2026-09-26 收敛后）**
- **仓库根就是 `~/nju-lab` 本身**（原先并列的 `repo/` 工作副本已取消，见 §2.1「目录收敛」）；**单一远端 `origin` = GitHub**（`git@github.com:jilongcui/nju-lab.git`），SSH key 已登记、`fetch`/`push` 直连可用
- git 提交身份已配好（local + global 均为 `jilongcui <jilongcui@163.com>`），`git commit` 无需再带 `-c`
- 部署目录 `~/nju-lab/server` 是仓库子目录，`dist`/`.env`/`uploads`/`node_modules` 均在 `.gitignore`；**禁止直接在部署目录改代码**

**改代码 → 编译 → 同步 → 提交**
- 后端：`cd ~/nju-lab/server && npm run build && sudo systemctl restart nju-lab`（`restart` 已配免密 sudo，见 `/etc/sudoers.d/nju-lab`）。开发期用 `npm run start:dev`（ts-node 直跑 `src/`，手动前台、不走 systemd，**需先停 systemd 服务**以免抢 3100 端口）
- 前端：`cd ~/nju-lab/web && VITE_BASE=/lab/ npm run build`（**必须带 `VITE_BASE=/lab/`**，否则 base 不对、子目录部署白屏）→ 把 `web/dist` 同步到 `/var/www/lab`（属 www-data）：有 sudo 时 `sudo cp -rf web/dist/. /var/www/lab/ && sudo chown -R www-data:www-data /var/www/lab`，无 sudo 时按 §2.1 的 docker 绕法。**只动 `index.html`+`assets/`，别碰 `kit/`**
- 提交：`cd ~/nju-lab && git add -A && git commit -m "…" && git push origin main`
- 改了实体（entity）→ `npm run typeorm migration:generate -- src/migrations/<Name>`；服务启动时 `migrationsRun: true` 自动执行

**环境注意**
- ⚠️ 线上跑的是**正式版**（systemd → `node dist/main.js`，`NODE_ENV=production`）：改 `src` 不生效，必须 build + restart；开发版是 `start:dev`
- ⚠️ 受限会话（含 agent）带 `no_new_privs`，`sudo` 无法提权，跑不了 `systemctl restart` 等需 root 的操作；这类步骤一律在持有 sudo 的终端执行
- 前后端联调纪律见第 3.3 条；每完成一块同步更新 `nju-lab-craft.md` §13 与本 HANDOFF，代码提交进 git（main 分支）

## 8. 平台侧实验工作台 —— 🚧 反代形态定案（单 Host + cookie 分流）并实测；浏览器 / 真实部署待办（2026-09-28）

### 8.1 一句话

给「本地装不上 DSH」的学生提供浏览器即可用的实验环境（一人一容器，单用户单会话）。
**设计文档必读**：`docs/DESIGN-2026-09-28-platform-workspace.md`（含两条并行路径与全部取舍）。

**当前状态（2026-09-29）**：兜底环境**已在浏览器中可用** —— 领取任务与对话交互由使用方验证通过
（见 §8.5 第 3 条）；剩「提交 → 平台复验」未跑。以下 09-28 的记录保留作背景。

**2026-09-28 三次更新**：后端 + 容器 + **nginx 反代**已端到端实测通过
（`enter` 种 cookie → 页面 200 / 静态资源 / 10.9MB 插件包 / RPC / **WebSocket 101** / SSE /
伪造 cookie-key 被拒 / 无会话流量原样回落 FoxCMS）。

**反代形态定案（关键）**：原设计的朴素子路径 `/lab/ws/<key>/` **已证伪**（dsh 的运行时路径
锚定 origin 根，§8.3 第 4 条）；而「独立域名/端口」在 medai 上**不可得**（学生只能走 80 端口、
Host 只能是 `medai.nju.edu.cn`）→ 采用等价形态：

> **页面认路径**（`/lab/ws/<wsKey>/…`）+ **dsh 写死的根路径认 cookie**
> （`/api/**`、`/plugins/**`、`/open-in-app/**` 由会话 cookie `nju_ws` 认领容器，
> **没有会话的流量原样回落 FoxCMS**）。cookie 由后端 `GET /lab/api/workspace/enter?k=<wsKey>` 种下。

**仍缺**：① 浏览器里跑通完整实验流程；② ~~宿主机 nginx 真实部署~~ ✅ **2026-09-29 核对：宿主机 nginx 片段已部署完毕**
（`/etc/nginx/snippets/` 两份与仓库 `deploy/nginx/` 逐字节一致，`nginx.conf`/`cms.conf` 均已 include，见 §8.5 第 1 条；
前端入口页已完成）→ 工作台侧遗留只剩 §8.5 第 1.5 条的**校园网关 WebSocket 透传**。
⏳ **网关不接受 WebSocket 的绕行方案（B）已就位**：容器内 WS→HTTPS 桥 + 页面适配，端到端实测通过，
靠 `WORKSPACE_WS_BRIDGE` 一个开关即可切回原生 WS —— 见 §8.5 第 1.5 条与设计文档 §4.6.1。

✅ **2026-09-28 另：路径 B 已落地** —— VM CPU 改为 host-passthrough（Xeon Gold 6530，SSE4.2/POPCNT/AVX2），
sharp 恢复、路径 A 禁用段退役、工作台镜像已重建为**完整功能**（文件上传/附件/交付物面板/会话控制器）。
详见 §8.4 与设计文档 §2.3。

### 8.2 已完成

| 组件 | 位置 | 验证程度 |
|---|---|---|
| 通用容器运行时 | `server/src/container-runtime/` | ✅ 复验行为**逐字节等价**（假 docker 对比 HEAD 与现状） |
| 工作台镜像 | `server/workspace-image/` | ✅ 端到端（起容器 → dsh web → 200 + UI 主干加载）；✅ **2026-09-28 已重建为完整功能版**（路径 A 退役，见 §8.4） |
| 工作台后端 | `server/src/workspace/` | ✅ 端到端（start → 16s 就绪 → 200 → stop）+ per-session authority + `enter` 入口（§8.3 第 5 条） |
| 重启后的容器接管 | `workspace.service.ts` 的 `adoptOrReclaim()` | ✅ 实测：重启后端后容器仍在、`status=running`（`wsKey` 重生成），环境可继续用（设计文档 §4.7.1） |
| 工作区持久卷 | `studentMounts()` | ✅ 实测：`<根>/<userId>` → `/work`、`…/dsh-sessions` → `$DSH_HOME/sessions`；删容器重建后文件仍在（设计文档 §4.8）。⚠️ 依赖 `<根>` 可写（默认 `/data/workspaces`） |
| nginx 反代 | `deploy/nginx/medai-workspace-{http,server}.conf`（带取舍说明版 `lab-nginx-snippet.conf`） | ✅ **配置形态已实测**（真实后端+镜像：enter 种 cookie → 页面/RPC/**WebSocket 101**/SSE/10.9MB 插件包/伪造凭据被拒/无会话回落 FoxCMS）；✅ **2026-09-29 已在宿主机部署并核对**（`/etc/nginx/snippets/` 两份与仓库逐字节一致，`nginx.conf`/`cms.conf` 均已 include） |

> 反代实测方式（可复现）：临时后端实例（`PORT=3000 npx ts-node -T src/main.ts`，
> 带 `WORKSPACE_PUBLIC_BASE='http://{key}.ws-test.local:18080'`）+ 容器内 nginx
> （`--resolve` 模拟子域）+ `curl`。测完的临时 nginx 与容器均已回收。

### 8.3 六条实测结论（踩过，别再踩）

1. **`--internal` 网络的容器不会建立端口发布** —— `docker run -p` **静默失效**（`docker port` 为空）。
   对外访问**只能走容器 IP**（宿主对 `br-xxxx` 的 `172.18.0.1/16` 有直连路由）。
   设计文档 §4.5 早期写的是"端口映射"方案，**已被实测推翻并更正**。
2. **dsh web 硬禁 `--host 0.0.0.0`**（理由："会把远程代码执行暴露到网络"）→ 容器内必须有一层 TCP 转发，
   已实现在 `server/workspace-image/entrypoint.mjs`（纯 TCP 层，不解析 HTTP）。
3. **dsh 的 browser-trust fence 只信任显式声明的 authority** —— 连它自己绑的 `127.0.0.1:<port>` 都不默认信任。
   必须传 `--trusted-host`，否则**一律 401**。entrypoint 会自动把自己网卡的 `IP:PROXY_PORT` 加进信任列表。
4. **反代不能走子路径**（**2026-09-28 反代实测，推翻了原设计**）：浏览器里的 dsh 把运行时路径
   全锚定在 **origin 根** —— RPC `new URL("/api/…", location.origin)`、
   WebSocket `wss://<origin>/api/remote.mux`、SSE `/plugins/events`、插件包 `/plugins/??…`。
   子路径 `/lab/ws/<key>/` 下页面**能开**（`sub_filter` 改写 HTML 生效），但这些绝对路径会打到
   宿主根 `/api`（njuserver 上是 dify → **502**）/404 → **功能全废**。
   → 「每会话独占一个 authority」（子域/独立端口）是最干净的通用解，但 medai 上不可得
   （见第 6 条）；配置形态见 `lab-nginx-snippet.conf` 注释（形态 A / 形态 B 都写在里面）。
5. **`Host` 必须传外部 authority，`wsKey` 必须大小写安全**（同上实测）：
   - nginx `proxy_set_header Host $http_host`（**不能传容器 IP**）：dsh 的 WebSocket 会校验
     `Origin` 与它看到的 `Host` 是否受信任 —— 传容器 IP 时 HTTP 全通、**WebSocket 一律 403**；
     同时后端要按 `WORKSPACE_PUBLIC_BASE` 的 `{key}` 把该 authority 传进容器的 `--trusted-host`。
   - `wsKey` 作为**子域**出现，而 URL 规范/浏览器/`new URL().host` 都会把 hostname 小写化：
     用 base64url 时 key 被改写 → `auth_request` 查不到会话 → **403**。现用 16 字节 hex。
8. **校园网关还会掐掉任何"流式响应"（约 20 秒）**（2026-09-29 实测）：
   即使把 WS 换成 SSE 长连接也一样 —— **宿主直连**的 SSE 能活满 50 秒（心跳正常），
   而**经网关**的同一个流每 16–24 秒就被 `client aborted`，且把心跳从"注释行"改成"真实事件"
   也拦不住（说明不是空闲超时，而是网关对流式响应的硬性时限）。
   ⇒ 工作台的下行**改用 1 秒短轮询**（`GET /wsbridge/poll?id=&since=`，对长连接零假设），
   上行仍是 POST；SSE 端点保留在代码里，将来网关放开长连接可切回（`_openStream`）。
   代价：流式回复有 ~1 秒颗粒感。

7. **校园网关不透传 WebSocket 升级**（2026-09-28 实测）：
   浏览器侧 `wss://medai.nju.edu.cn/api/remote.mux` 一直失败（dsh 前端报 `connection lost, retry #N`），
   access.log 里对应的是 **404 / 45 字节**——既不是 dsh 的 404（9 字节 `not found`），也不是本机 nginx 的
   403/502，说明**升级请求没有以"升级"形态到达本机**。
   对照实验（绕开网关，直连本机 nginx，带完整升级头）→ **101 Switching Protocols**；
   同一 URL 若剥掉 `Upgrade`/`Connection` → dsh 回 404 `not found`（9 字节）。
   ⇒ 本机 nginx / cookie 分流 / 容器全部正常；需要**网关侧开启 WebSocket 透传**
   （或改走不带 TLS 终止的入口）。注意 WS 是 dsh 会话事件流的唯一通道（`/api/remote.mux`），
   SSE `/plugins/events` 只是插件热重载，**没有 WS 时 UI 只能打开、不能真正交互**。

6. **单 Host（medai）下的定案形态：页面认路径 + 根路径认 cookie**（2026-09-28 实测）：
   独立域名/端口不可得（学生只能走 80 端口、Host 只能是 medai），于是把会话标识**拆成两半** ——
   页面 `/lab/ws/<wsKey>/…` 用**路径**里的 key；dsh 写死的 `/api/**`、`/plugins/**`、
   `/open-in-app/**` 用**会话 cookie**（`nju_ws`，由后端 `GET /lab/api/workspace/enter?k=<wsKey>` 种下）
   认领容器；**没有会话的流量回落原系统**（204 无 header → FoxCMS，dify/FoxCMS 完全不受影响）。
   三个 nginx 坑（都实测踩过）：① `auth_request` 的 URI **不支持变量**（→ 让 auth 子请求
   自己读 `$cookie_…`）；② **不能用 `if` 判断 auth 结果**（`if` 在 rewrite 阶段、
   `auth_request_set` 在 access 阶段 → 恒为空，必须用 `map` 惰性求值）；③ `rewrite … break`
   会**终止同一 location 里后续的 `set`**。
   边界：会话 cookie 只有一个 ⇒ **同一浏览器同时只能进一个工作台会话**。

### 8.4 两条并行路径 —— ✅ 均已收敛（路径 B 落地，2026-09-28）

njuserver 原先的 QEMU vCPU 无 SSE4.2 → `sharp` 崩 → `dsh web` 起不来。当时的对策：

- **路径 A（已退役）**：profile 里禁 5 个消费者插件
  （`server/workspace-image/profile/nju-lab-workspace/cordis.patch.yml`）。
  代价是**无 UI 文件上传 / 附件显示 / 交付物面板 / 会话控制器**。
  ⚠️ 该禁用段现已**删除**；文件里保留了注释形式的"恢复方法"——
  **只在目标机器无 SSE4.2/POPCNT 时才需要它**。
- **路径 B（✅ 已完成）**：VM 的 CPU 模型改为 `host-passthrough` 并重启
  （`/proc/cpuinfo` = `INTEL(R) XEON(R) GOLD 6530`，含 sse4_2/popcnt/avx/avx2；
  `require('sharp')` OK，libvips 8.18.6）→ 禁用段删除、**镜像已重建**，恢复完整功能。

**验证口径（可复现）**：删段后 dsh web 于是就绪、无 pending；index 26279 → **28110** 字节，
4 个 client 插件回到 UI 清单；`--dump-config` 的 `disabled: true` 从 **31 → 26**（全为 dsh 默认）；
WebSocket 101、SSE 200 正常。

### 8.5 遗留清单（接手者按序看）

1. ~~**宿主机 nginx 未部署（最高优先，配置形态已实测）**~~ ✅ **2026-09-29 核对：已部署完毕，本项关闭** ——
   `/etc/nginx/snippets/` 下的 `medai-workspace-http.conf` / `medai-workspace-server.conf` 与仓库
   `deploy/nginx/` 版本**逐字节一致**，且 `/etc/nginx/nginx.conf:12` 的 `http{}` 与
   `/etc/nginx/sites-enabled/cms.conf:51` 均已 include。工作台侧唯一遗留即下面的第 1.5 条。
   重做参考（只在换机器/重装时用）：`sudo cp deploy/nginx/*.conf /etc/nginx/snippets/` →
   在 `nginx.conf` 的 `http{}` 加 `include /etc/nginx/snippets/medai-workspace-http.conf;` →
   在 `sites-enabled/cms.conf` 的 server 里加 `include /etc/nginx/snippets/medai-workspace-server.conf;` →
   `sudo nginx -t && sudo systemctl reload nginx`。
   （这两个片段已在容器里按**现网 cms.conf 的真实结构**拼装做过 `nginx -t` 校验，syntax ok。）
   完整取舍说明见 `lab-nginx-snippet.conf` 与设计文档 §4.5.2。
1.5 **（2026-09-28 新增，最高优先）网关 WebSocket 透传**：见 §8.3 第 7 条 ——
   📄 **可直接转发给网络中心的说明与配置：`docs/OPS-2026-09-29-gateway-websocket.md`**（2026-09-29 整理，
   含现象/证据、网关 nginx 四步改法、验证方法，以及网关开好后我方关桥的步骤与顺序要求）。
   本机链路已实测 101，需网络中心在**校园网关**上开启 WS 升级透传
   （若网关是 nginx，**手工 4 步**：
   ① `http{}` 里加 `map $http_upgrade $connection_upgrade { default upgrade; '' close; }`；
   ② 承载 medai 的**每个** server 块（80 与 443 各一个）里加 `proxy_http_version 1.1;` +
      `proxy_set_header Upgrade $http_upgrade;` + `proxy_set_header Connection $connection_upgrade;`；
   ③ ⚠️ 若该 server/location 里**已有** `proxy_set_header Connection close;`（或 `""`），
      它会覆盖②新增的那行 —— 必须删掉或改成 `$connection_upgrade`，这是最常见的漏改点；
   ④ `nginx -t && nginx -s reload`。若是其他反代/负载设备，开"WebSocket 支持"开关）。
   **当前处置（2026-09-28）**：已实现**方案 B** —— 容器内 `bridge.mjs` 把 dsh 的 WS
   拆成「下行 SSE + 上行 POST」（都是网关放行的普通 HTTPS），页面注入 `/wsbridge/client.js`
   做适配，**全体仍是 https**。端到端实测通过（详见设计文档 §4.6.1）。
   · 切回原生 WS（网关开好之后）：注入 `WORKSPACE_WS_BRIDGE=0` 即可，不用改前端/nginx
   · 涉及改动：镜像新增 `bridge.mjs`/`ws-bridge-client.js` + entrypoint 起桥；
     后端 `WORKSPACE_WS_BRIDGE`（默认开）与 `X-Workspace-Bridge-Upstream`；
     nginx 片段新增 `location ^~ /wsbridge/` + 页面注入一行 script
   · 已知边界：桥让**上行**帧变成"一帧一个 POST"（下行一条 SSE）；若网关连 SSE 长连接也掐，
     桥侧会话 linger 60s，客户端重连即可（会有短暂空窗）
   **实测进展（2026-09-29，抓包）**：内网方向的链路只有一跳 ——
   `客户端 → 219.219.122.131（反解 paper.nju.edu.cn）→ 10.28.128.56:80`；
   校外那台 CAS 网关 **`219.219.115.199` 不在这条路上**（它对校外源一律 302 到
   `authservertest`，从本机测也是 302）。抓包结果：`Upgrade: websocket` 与
   `Connection: upgrade` **已透传成功** ✅，但 **`Host` 被写成 `10.28.128.56`** ❌
   —— 上游 nginx 未显式设 `proxy_set_header Host`，用了默认的 `$proxy_host`。
   按 §8.3 第 5 条，`Host` 不在 dsh 的 `--trusted-host` 里会让 **WebSocket 一律 403**
   （HTTP 全通 = "页面能开、一直 connection lost"）。**上游已修复（2026-09-29 抓包复验：
   上游传进来的 Host 已由 `10.28.128.56` 变为 `medai.nju.edu.cn`）**。复现命令与判读见
   `docs/OPS-2026-09-29-gateway-websocket.md`「当前实测状态」。
   **本机侧兜底已实现并部署（2026-09-29 10:27）**：新增 `map $http_host $ws_out_host`
   （`deploy/nginx/medai-workspace-http.conf:21`），转发到容器的 5 处 `proxy_set_header Host`
   从 `$http_host` 改为 `$ws_out_host` —— 非 `medai.nju.edu.cn` 的 Host 一律纠正回对外
   authority。已用 `nginx -t` + 真实请求验证（上游传 `10.28.128.56` 时容器收到
   `medai.nju.edu.cn`）。**部署**：`sudo cp deploy/nginx/*.conf /etc/nginx/snippets/ &&
   sudo nginx -t && sudo systemctl reload nginx`（已执行，线上与仓库逐字节一致）。
   **线上抓包复验通过**：同一请求经 122.131（`Host: 10.28.128.56`）→ 本机转发给容器时
   已是 `Host: medai.nju.edu.cn` ✓。上游改对后此兜底退化为恒等映射。
   ⚠️ 兜底只救工作台这条链路；上游把 Host 改写成内网 IP 是全局行为（生成链接/重定向/日志/
   将来的子系统都受影响），所以**上游那行仍要补**。
   ⏳ **截至 2026-09-29 10:28，端到端 101 仍未被实测**（`access.log` 里 `101` 计数 = 0，
   且当时无活跃工作台容器）—— 需有人在内网真正进一次实验环境才算确认。
   **判定方法（等实际使用时跑一次即可）**：
   `grep -a "remote.mux" /var/log/nginx/access.log | tail -5` +
   `grep -a -c " 101 " /var/log/nginx/access.log`。判读：
   `101` → ✅ 原生 WebSocket 通了；
   `404` + 9 字节 → 到了容器但没升级（升级头又在某一跳被剥掉）；
   `200`/85 或 `403`/21 → 会话 cookie 失效（重新走一次「进入实验环境」；注意**后端重启会让
   wsKey 重生成、浏览器里的旧 cookie 全部失效**，2026-09-29 07:08 那次重启后 07:29–09:43
   的全部失败都是这个原因，不是网关）。
2. **独立域名/端口形态（形态 A）已确认不可得**（学生只能走 80 端口、Host 只能是 medai，
   2026-09-28 使用方确认）→ 现用 §8.3 第 5 条的 cookie 分流形态；将来若拿到域名/端口可切回形态 A。
3. **浏览器实测** —— 🟢 **2026-09-29：兜底环境在浏览器中已真正可用**：
   **领取任务（claim）与对话交互由使用方验证通过** ✅（路径 B + 容器内 WS 网桥之后，
   原先缺的会话控制器/文件上传等插件都回来了，不再有"路径 A 缺功能"的问题）。
   **已完成**：`开发 → 自测 → **提交**` ✅ —— 2026-09-28 23:15~23:18 由使用方提交三次
   （v3/v4/v5），`POST /lab/api/files` ×2 + `POST /lab/api/assignments/<id>/submit` 全部 **201**，
   DB 三条 `submitted` 记录齐全（skillZipRef/capsuleRef 均为真实上传文件）。
   **仍待**：「教师触发复验 → 平台跑真实容器评估」这一段**尚未跑**
   （入口 `POST /api/submissions/:id/verify`，须课程 owner 教师或 admin 触发；
   `.env` 的 `DEEPSEEK_API_KEY`/`MOONSHOT_API_KEY` 与 runner 的透传已核对就绪，随时可跑）。
4. ~~前端入口页~~ ✅ 已完成（2026-09-28）：`web/src/pages/student/Workspace.tsx`，
   学生/教师菜单「实验环境」；`start` → 轮询 `status` → 就绪后导航到 `enterUrl`
   （`apiUrl(info.enterUrl)`，后端种 cookie + 302 到工作台首页）→ `stop`。
   ⚠️ **不要直接打开容器地址或 `publicBase`** —— cookie 分流形态必须经 enter 这一步。
   **待浏览器实测**（与第 3 条一起做）。
5. **容器未加固**：目前以 **root** 跑。生产前应加非 root、cap-drop、只读根。
6. ~~平台 API 可达性未在真实链路验证~~ ✅ **2026-09-29 已实测**：
   · 容器里**自动**注入 `NJU_LAB_TOKEN`（24 小时短时效 JWT，`AuthService.issueWorkspaceToken`）
     与 `NJU_LAB_SERVER_URL` —— 兜底环境不该让学生手填 token；
   · 平台域名经 `--add-host` 指到宿主在**隔离网络**里的地址（`172.18.0.1`），**不是**
     docker 的 `host-gateway`（那会解析成默认 bridge 的 172.17.0.1，隔离容器没有那条路由 → ENETUNREACH）；
   · 实测：容器内 `GET /me`、`/me/assignments`、`/me/courses` 全部 200。
7. **兜底环境的模型额度由平台统一提供**（2026-09-29 加）：后端起容器时透传
   `DEEPSEEK_API_KEY` / `MOONSHOT_API_KEY`（`docker run -e <NAME>`，**只写变量名不写值**，
   所以密钥不进宿主 `ps`；容器内学生可见，属预期）。学生本地 DSH 仍用自己的 key。
   实测：容器内 `GET https://api.deepseek.com/models` → 200（同时验证了容器经 SNI 白名单代理能出网）。
   ⚠️ 建议给这个 key 设额度 —— 兜底环境人数少，但可控性要留着。

### 8.6 部署注意

- **本机 docker.io 直连不通**，且华为云源只有 `node:22-slim` = **v22.18.0**（`HANDOFF` §2.1 记录过它会崩），
  所以工作台镜像 **`FROM nju-lab-verify`**（本机唯一带正确 node v22.23.2 的镜像）。
  若在有 docker.io 的机器上从零构建，见 `server/workspace-image/Dockerfile` 注释里的替代路径。
- 构建 context **必须是仓库根**（要 copy `dsh/nju-lab-client`）；已加仓库根 `.dockerignore` 防止把 node_modules 发给 daemon。
- **工作台镜像与复验镜像不要合并**：bundle / profile / 驱动三者全不同（见 `server/workspace-image/README.md` 对照表）。
- **路径 B（2026-09-28）之后的镜像状态**：`nju-lab-workspace:0.1.5-rc.2` = **完整功能版**
  （CPU 修复后重建，含文件上传/附件/交付物面板/会话控制器）；
  回滚点 `nju-lab-workspace:0.1.5-rc.2-no-sse42` = 旧的"路径 A"版（禁 5 个插件）——
  只在**目标机器无 SSE4.2/POPCNT** 时才用它，并配合恢复 `profile/.../cordis.patch.yml` 的禁用段。
- **已完成的环境就位（2026-09-28）**：后端 `.env` 已加 `WORKSPACE_PUBLIC_BASE=http://medai.nju.edu.cn`；
  前端产物已同步到 `/var/www/lab`（含「实验环境」入口页）。~~**只剩宿主机 nginx 未合并**~~ ✅ **2026-09-29 已合并并核对**（§8.5 第 1 条）。
- 工作台配置项见 `server/.env.example` 末段（大部分有默认值，可先不配）。
- 工作台的**持久卷根目录**由 `WORKSPACE_DATA_DIR` 配置（默认 `/data/workspaces`；留空 = 关闭持久化）。
  2026-09-29 已建好 `/data/workspaces`（属 `ubuntu`）并用 docker 验证：ubuntu 可建 `<userId>` 子目录、
  学生容器挂 `/work` 读写正常、宿主可见同一文件 ✔ → 持久化已生效（不可写时后端只告警、不阻塞）。
- ⚠️ **反代上线必须配 `WORKSPACE_PUBLIC_BASE=https://{key}.<工作台域>`（`{key}` 必填）**：
  后端据此算出**每会话**的对外 authority 并注入容器的 `--trusted-host`；
  不配则 nginx 传外部 Host 时 WebSocket 会 403（§8.3 第 5 条）。
  本机/无域名时可用固定域（如 `http://ws-test.local:18080`，不含 `{key}`）——但此时**所有会话共享
  同一个 authority、cookie 会互串**，只适合单会话调试。
