# NJU-Lab：基于 DSH 的 Skill 工程实验平台 · 系统设计

> 版本说明：本版已根据 dsh-handbook 第 1/3/13 章的事实修订（三元架构），并已同步 **2026-09-21 首期实现**的全部技术决策与变更：技术栈落定 NestJS + TypeORM + MySQL + React/AntD、nginx 生产部署、admin 角色、API 全量清单、当前实现状态与遗留项（见第十三节）。
>
> **2026-09-24 更新**：njuserver 部署点接入**南大统一认证（CAS 3.0）** —— 校园网关放开后认证改由应用自负，走标准 ticket 重定向流（登录 / 登出 / 角色判定均已上生产）；角色由 CAS 属性 `containerId` 判定（`ou=JZG` = 教职工）；前端产物按 `VITE_BASE=/lab/` 重建部署。详见 §6.1 与 HANDOFF.md §2.1 / §3.4。

## 一、平台定位：这是什么？

NJU-Lab 是一个 **"课程 + 实验"一体化的 Skill 工程实验平台**——不是"AI 自动批改作业系统"。它的完整教学闭环是：**上课（课程章节）→ 做实验（开发 Skill）→ 交证据（提交包）→ 看实测（平台复验批改）**。

对标传统实验课，各角色的关系是：

| 传统实验课 | NJU-Lab |
|---|---|
| 课堂讲授与预习 | 平台**课程模块**：章节化教学内容（图文/附件/示例 Skill），学习进度可追踪 |
| 实验指导书 | 教师创建的**实验项目**：完整项目信息（目标、背景、任务要求、Skill 模板、标准测试数据、评估条件、评分要求），挂在章节下按进度解锁 |
| 学生搭实验装置 | 学生在**自己本地的 DSH** 中开发 Skill |
| 跑实验、记录数据 | 学生用标准测试数据**运行 Skill**，DSH 本地采集会话证据 |
| 交实验报告 | 学生提交 **Skill 包 + 证据包（.dshc）+ 审计事件** |
| 老师批改报告 | 教师查看**技能档案（dossier）+ 平台独立重跑的 baseline/treatment 对比**，确认评分 |

核心差异：学生提交的不是一张静态设计图（Dify DSL），而是一个**可安装、可运行、附带实测证据的 Skill 包**。教师批改的对象从"你设计了什么"变成"你的设计实际表现如何"。

平台的四项核心能力：**课程与技能管理 + 会话证据采集 + 质量评估 + 多用户隔离**。前三项复用 DSH 构件与自研平台服务；第四项通过"学生本地运行 + 服务端只收提交"的架构天然消解（见第七节）。

## 二、DSH 认知基础（选型依据）

以下来自 dsh-handbook（第 1/3/13 章），是平台设计的事实前提：

- **DSH = DeepSeek 官方开源的 Agent 运行时**（MIT，TypeScript/Node ≥ 22，Cordis 插件容器，2026-08-13 开源）。"一切皆插件"，60+ 官方包
- **profile 机制**：一种可启动形态 = `~/.dsh/profiles/<name>/` 目录（package.json + cordis.patch.yml）。内置 `web`（Web UI）与 `headless`（一次性 CLI，非零退出码即失败，可进 CI），可自定义 profile。学生端就是一个定制的 "nju-lab-student" profile
- **插件双半结构**：host 半（Node，文件系统/服务）+ client 半（浏览器 UI），cordis 服务桥接。平台可写 client 半插件注入教学 UI
- **关键扩展点**：`agent/request` waterfall（每次模型请求前可锁定 provider/model/reasoningEffort/tools——**这是评估公平性的技术抓手**，实验条件由平台钉死，学生改不了）；`conversationEvents`；`ctx.slots.inject`
- **安全三层**：沙箱（只管文件效果，三档：read-only / workspace-write / danger-full-access）→ 权限预设（默认 workspace-write + ask）→ 审批（fail-closed；headless 用 `never` = 确定性拒绝）
- **硬边界**：DSH Web 刻意只绑 loopback，本地 RPC 无认证（#451，CVSS 8.8）；沙箱不挡网络与进程；审批可被模型自答（#250）；插件无签名校验（装插件 = 装可执行代码）
- **版本风险**：当前为 rc/alpha 阶段（0.1.2-rc.1 / v0.1.3-alpha.1），官方明示将有破坏性变更
- **审计能力**：`approval/asked` + `approval/decided` 成对事件、`permission/preset` 提权日志（纯用户意图，不进模型转录，可事后回溯）——可直接用作教学证据

## 三、角色与端到端流程

平台有三种角色：**管理员（admin，超级权限，可见并管理全部课程与提交）**、教师、学生。

### 3.1 教师流程

1. **建课**：创建课程，编写/上传章节教学内容（图文、附件、示例 Skill），排定章节顺序；维护学生名单（从全校学生中选择加入/移出）
2. **创建实验项目**：在对应章节下创建实验项目，填写完整项目信息（见 8.1）；设定解锁规则与截止时间
3. **发布**：发布课程，学生按章节学习，满足解锁规则后开放实验领取
4. **过程监督**：教师工作台查看待批改列表；课程详情查看班级学习进度（章节完成率）与提交进度
5. **批改**：学生提交后，平台复验（当前为 Mock，见第十三节）生成评估结果；教师结合技能档案与评分建议确认成绩
6. **归档**：优秀 Skill 收入"参考技能库"（未实现，第三阶段）

### 3.2 学生流程

1. **环境准备**（首次，未实现，属 DSH 接入阶段）：本地安装 Node ≥ 22 + DSH，一键配置 "nju-lab-student" profile
2. **上课**：在平台 Web 端按章节学习课程内容（阅读自动记"学习中"），标记完成；平台记录学习进度
3. **领取任务**：章节进度满足解锁规则后开放领取；模板与测试数据经平台 API 下发
4. **开发 Skill**：基于模板编写 SKILL.md（+ references/ + scripts/）
5. **运行验证与自测**：用标准测试数据本地运行，对比"用 Skill vs 不用 Skill"
6. **提交**：打包完整 Skill 目录（ZIP 引用）+ .dshc 证据包（引用）+ 会话审计事件 + 各文件 SHA-256，上传到平台
7. **查看反馈**：任务列表内嵌最新提交状态，直接查看平台复验结果 + 教师评语

### 3.3 关键原则

- **先学后做**：实验项目挂在课程章节下，默认需完成前置章节学习才可领取（unlock_rule 可按项目配置）
- **评估条件统一且不可篡改**：标准测试数据集版本化；模型/推理档位/工具集由 `agent/request` waterfall 钉死；学生自测与平台复验用同一套条件
- **以平台复验为准**：学生自报结果仅作参考，评分依据是服务端独立重跑的结果；.dshc 完整性哈希 + 审计事件用于印证过程真实性
- **提交物完整**：完整 Skill 目录（SKILL.md + references/ + scripts/），非单个文件
- **最小权限**：学生端永不用 `danger-full-access`（#461 有删光家目录的真实事故）；重要工作纳入版本控制（#149：workspace-write 下可递归删整个工作区，零确认）

## 四、核心实体与数据模型（已实现，MySQL）

平台服务持久化以下实体（MySQL 8.0，TypeORM；schema 由 migrations 管理，`synchronize: false` + `migrationsRun: true`）：

```
User            用户
  - id, username(唯一), passwordHash(bcrypt), nickname
  - role: admin | teacher | student        ← admin 为首期实现中新增

Course          课程
  - id, title, teacherId, term, description
  - status (draft/published/archived)

Chapter         课程章节（隶属 Course，有序；onDelete CASCADE）
  - id, courseId, order, title, content(Markdown), exampleSkills(JSON)
  - status (draft/published)

ExperimentProject  实验项目（= 数字化实验指导书）
  - id, courseId, chapterId     挂在章节下
  - title, objectives, background, description
  - skillTemplateFileId  技能模板（ZIP）存储文件 id（files 模块，本地磁盘存储）
  - testDatasetFileId    标准测试数据集存储文件 id
  - evalConfig(JSON)     { model, reasoningEffort, tools[], timeoutSeconds }
  - rubric(JSON)         [{ name, weight }]
  - references, faq
  - unlockRule(JSON)     { type: default | none | chapters, chapterIds? }
  - deadline, status (draft/published/closed)

Enrollment      学生-课程关系（courseId+studentId 唯一）
ChapterProgress 章节学习进度（not_started/in_progress/completed + completedAt）
Assignment      任务分发记录（pending/claimed/submitted + claimedAt）

Submission      提交记录
  - id, assignmentId, studentId, submittedAt
  - skillZipRef + skillZipSha256、capsuleRef + capsuleSha256
  - auditEvents(JSON)、fileHashes(JSON)
  - status (submitted/verifying/verified/failed/graded)

Evaluation      评估结果（复验产生；由 EvaluationRunner 生成，mock/docker 可切换）
  - baselineResult/treatmentResult(JSON: runs/successRate/avgTokensPerRun)
  - successRate(0~1), tokenCost, dossierSnapshot(JSON)
  - integrityCheck(JSON: selfReportVsRerun/capsuleHashVerified/deviation/note)
  - autoScoreSuggestion, teacherScore, teacherComment

SkillLibrary    参考技能库（未实现，第三阶段）
```

## 五、系统架构（三元结构）与生产部署

### 5.1 逻辑架构

```
┌───────────────────────┐        ┌───────────────────────────────┐
│   学生本地（每生一套）  │        │        服务端（平台）           │
│  DSH web profile:      │ 提交/  │  ┌─────────────────────────┐  │
│  "nju-lab-student"     │ 领取   │  │ 平台服务（NestJS，自研）  │  │
│  (loopback only)       │◄──────►│  │ · 课程/项目/分发/提交/评估│  │
│  【DSH 接入阶段实现】    │ HTTPS  │  │ · 用户认证与权限          │  │
│                        │ +JWT   │  │ · 学习进度与班级视图聚合   │  │
│                        │        │  └───────────┬─────────────┘  │
│                        │        │  ┌───────────▼─────────────┐  │
│                        │        │  │ 验证执行器               │  │
│                        │        │  │ 【当前为 Mock 实现】      │  │
│                        │        │  │ 目标形态 = 一次性容器：   │  │
│                        │        │  │ · dsh headless          │  │
│                        │        │  │ · approval = never      │  │
│                        │        │  │ · 网络关闭 + 资源限额    │  │
└───────────────────────┘        │  └─────────────────────────┘  │
                                 └───────────────────────────────┘
                                              ▲
┌───────────────────────┐                     │
│   教师端（平台 Web UI） │─────────────────────┘
└───────────────────────┘
```

**架构原则**：

1. **DSH 只在两处出现**：学生本地（开发/自测）和服务端一次性容器（复验）。平台服务本身不运行 DSH 常驻实例
2. **平台服务不依赖 DSH 在线**：与学生端只通过 HTTPS API 交换 ZIP/JSON；与验证容器只通过"触发任务 + 收集结果"交互。DSH 升级或更换时，平台主体不受影响
3. **不在服务端跑 DSH Web 多租户**：DSH Web 无认证、只绑 loopback，绝不暴露到网络（#381 点击劫持、#451 无认证 RPC 是实锤风险）

### 5.2 生产部署形态（已实现）

```
浏览器
  │ https://lab.xiaohe.biz
  ▼
nginx（443 ssl，80→443 301）
  ├── 静态托管前端产物 /var/www/nju-lab/dist（vite build）
  │     · /assets/ 30 天缓存 + immutable；index.html no-cache
  │     · SPA 回退 try_files $uri $uri/ /index.html
  └── location /api/ → http://127.0.0.1:3100（NestJS，proxy_pass 不带 URI）
                                    │
                                    ▼
                          MySQL 8.0（Docker 容器 nju-lab-mysql，
                          127.0.0.1:3306，库 nju_lab，utf8mb4）
```

部署纪律（踩过的坑）：

- **禁止把 Vite dev server 挂在 nginx 后当生产**（HMR WebSocket 必挂）；必须 `npm run build` 后静态托管
- 前端产物不放 `/home/ubuntu`（750 权限 www-data 不可读），统一放 `/var/www/nju-lab/dist`
- nginx `sites-enabled/` 下所有文件（包括 `.bak`）都会被加载，备份必须移出该目录
- 前端重新部署：`npm run build` → 替换 `/var/www/nju-lab/dist` → `chown -R www-data:www-data`
- 后端已 systemd 常驻（`/etc/systemd/system/nju-lab.service`，`node dist/main.js`，Restart=always）

## 六、平台服务（自研后端）实现

**技术栈（已定）**：NestJS + TypeORM + mysql2 + JWT（passport-jwt）+ bcryptjs + class-validator。选择 NestJS 的理由：模块化结构与第六节子模块一一对应；与 DSH 同为 TypeScript 生态。

**全局约定**：`/api` 前缀；统一响应 `{code, data, message}`（code=0 成功）；全局 ValidationPipe；全局 JwtAuthGuard + `@Public()` 放行登录注册；RolesGuard + `@Roles()` 区分角色（**admin 在 RolesGuard 中放行一切角色受限接口**）。

### 6.1 模块清单（已实现）

| 模块 | 职责 |
|---|---|
| auth | 注册/登录、JWT 签发。**认证双轨**：本地 `LocalAuthProvider`（bcryptjs，示例账号与开发）+ **南大统一认证 CAS 3.0**（`cas.client.ts`：ticket 重定向流 → `/p3/serviceValidate` 校验 → `loginWithCas()` 找/建用户；角色由 CAS 属性 `containerId` 判定，`ou=JZG`=教职工 → teacher，**只升不降**）。`AuthProvider` 接口保留给纯本地体系 |
| users | `GET /me`；`GET /users/students` 学生名单（教师选课用） |
| courses | 课程/章节 CRUD 与发布、删除（级联）、选课名单（增/查/移出）、学习进度、课程 dashboard |
| projects | 实验项目 CRUD/发布/删除、Assignment 生成、claim（unlockRule 校验）、`/me/assignments`（内嵌最新 submission） |
| submissions | 提交（结构/哈希校验）、状态机、verify（**Mock 复验**，`EvaluationRunner` 接口，真实容器复验替换绑定即可）、grade、`GET /submissions/:id` |
| dashboard | 项目维度 dashboard（提交进度/成功率/token 分布）、`GET /dashboard/teacher-summary`（课程数/学生总数/待批改列表） |

### 6.2 API 全量清单（已实现）

```
公开：
POST   /api/auth/register               注册（仅 teacher/student，admin 不可公开注册）
POST   /api/auth/login                  登录 → { user, accessToken }

通用：
GET    /api/me                          当前用户

课程（教师/管理员）：
POST   /api/courses                     创建课程
GET    /api/courses                     课程列表（admin 全部/教师自己/学生已选）
GET    /api/courses/:id                 课程详情（chapters 内嵌 projects 摘要）
PATCH  /api/courses/:id                 编辑课程（部分更新）
POST   /api/courses/:id/publish         发布
DELETE /api/courses/:id                 删除（级联）
POST   /api/courses/:id/chapters        章节 upsert（带 id 为更新，可切发布状态）
GET    /api/courses/:id/chapters        章节列表
POST   /api/courses/:id/enrollments     添加学生 { studentIds[] }
GET    /api/courses/:id/enrollments     已选学生名单
DELETE /api/courses/:id/enrollments/:studentId  移出学生（清进度）
GET    /api/courses/:id/progress        班级学习进度
GET    /api/courses/:id/dashboard       课程 dashboard（章节完成率）
GET    /api/users/students              全校学生名单

章节：
GET    /api/chapters/:id                阅读（学生自动记"学习中"）
POST   /api/chapters/:id/complete       学生标记完成
DELETE /api/chapters/:id                删除（级联删除其下实验）

实验（教师/管理员）：
POST   /api/projects                    创建实验项目（挂章节下）
GET    /api/projects/:id                项目详情
PATCH  /api/projects/:id                编辑（整体替换语义，与课程 PATCH 不一致，待统一）
POST   /api/projects/:id/publish        发布（生成 Assignment）
DELETE /api/projects/:id                删除（级联）
GET    /api/projects/:id/submissions    全部提交（按 Assignment 分组含 student）
GET    /api/projects/:id/dashboard      项目维度班级视图

提交与批改：
POST   /api/submissions/:id/verify      触发复验（当前 Mock）
GET    /api/submissions/:id             提交详情（教师或本人）
GET    /api/submissions/:id/evaluation  复验结果（教师或本人）
POST   /api/submissions/:id/grade       确认评分与评语

工作台：
GET    /api/dashboard/teacher-summary   课程数/学生总数/待批改列表（≤10 条）

学生侧：
GET    /api/me/courses                  我的课程与章节进度
GET    /api/me/assignments              任务列表（含 unlocked 与内嵌最新 submission）
POST   /api/assignments/:id/claim       领取（校验 unlockRule，下发模板/数据集/evalConfig）
POST   /api/assignments/:id/submit      提交（引用 + 两个 SHA-256 必填 + 审计事件）
GET    /api/me/evaluations/:id          查看自己的复验结果与反馈
```

## 七、隔离与安全模型

**本方案的核心简化：在线多租户问题被架构消除了。** DSH 是单用户本地工具，本方案让它始终在单用户场景下工作（学生本地 / 一次性容器），服务端只有无状态的 Web 服务和批处理。

### 各边界的安全措施

| 边界 | 威胁 | 措施 |
|---|---|---|
| 学生本地 | Skill 自毁工作区、误提权 | 默认 `workspace-write` + ask；禁用 `danger-full-access`；引导 git 管理 Skill 目录 |
| 学生 → 服务端 | 越权访问他人数据 | 平台 API 全量 JWT 认证；角色 Guard；越权访问他人提交/课程返回 403（已实测） |
| 服务端验证容器 | 学生 Skill 恶意代码 | 一次性容器 + 断网 + `approval=never` + 资源限额；容器是唯一信任边界（待实现） |
| 供应链 | 插件/Skill 来源 | 学生端 profile 预装插件走白名单；提交的 Skill 按 DSH 13.5 清单做静态检查（待实现） |
| 证据链 | 证据伪造 | .dshc 完整性哈希 + 提交时哈希登记 + 平台独立复验 + 审计事件交叉印证（复验当前 Mock） |
| Web 入口 | 传输与前端安全 | HTTPS（TLS1.2/1.3）+ HSTS；X-Content-Type-Options / X-Frame-Options / Referrer-Policy 响应头；bcrypt 密码哈希 |

### 来自 DSH 安全章节的直接继承

- 验证环境 = DSH 企业基线中的"CI/无人值守"场景：headless + `never` + 前置 review 闸
- 审计事件（`approval/asked`/`decided` 成对、`permission/preset`）纳入提交物，可回答"这次运行有没有人工干预、有没有提权"
- DSH 13.5 插件审计清单 → 转化为学生 Skill 提交检查表与批改 rubric 的一部分

## 八、页面设计（已实现）

**整体布局（三段式，AppLayout 统一封装）**：

- **菜单区**：左侧 Sider（可折叠），Logo + 按角色过滤的菜单 + 折叠按钮
- **功能区**：中间主内容区，顶部 Header 含页标题与全局操作
- **辅助区**：右侧 280px 可收起辅助面板（AuxiliaryPanel + zustand），各页面注入上下文说明/快捷操作，收起状态持久化
- **主题**：明亮/暗黑切换 + 预设主题色板（antd v5 ConfigProvider + cssVar），选择持久化 localStorage

### 8.1 教师端页面（管理员同）

1. **工作台**：统计卡（课程数/学生总数/待批改数，待批改红色突出）+ 待批改列表（直达批改页）+ 各课程章节完成率
2. **课程列表**：新建/编辑/发布/删除（二次确认）
3. **课程详情**：章节大纲（章节下挂实验卡片、章节发布/下线/删除、新建章节/实验）+ 学生管理（名单/多选添加/移出）+ 班级学习进度
4. **章节编辑**：Markdown 编辑 + 预览
5. **实验项目详情**：完整项目信息编辑（目标/背景/任务/模板与数据集引用/evalConfig/rubric 权重/参考资料/FAQ/解锁规则/截止时间）、发布、删除、学生提交表格
6. **批改页**：提交详情（引用/哈希/审计事件）+ 复验对比（baseline/treatment、成功率、token 成本、一致性检查、评分建议）+ 打分评语

### 8.2 学生端页面

1. **我的课程**：课程卡片 + 章节进度
2. **课程详情**：章节列表（进度状态）+ 实验卡片解锁状态（未解锁显示条件提示）
3. **章节阅读**：内容阅读 + 标记完成
4. **实验详情**：完整项目信息只读 + 领取（未解锁禁用并提示）
5. **我的提交**：任务列表（含提交状态）+ 提交表单（引用 + SHA-256 校验 + 审计事件 JSON）+ 复验结果与教师评语

## 九、评估与评分体系

评分建议由平台基于客观数据自动生成，教师最终确认：

| 维度 | 数据来源 | 权重（建议） |
|---|---|---|
| 规范完整度 | skillforge 规范检查、目录结构校验 | 15% |
| 能力边界填写质量 | dossier（边界、pitfalls 真实踩坑记录） | 25% |
| 实测有效性 | 平台复验的 baseline/treatment 提升幅度、成功率 | 40% |
| 证据完整性 | .dshc 校验 + 审计事件 + 自报复验一致性 | 10% |
| 工程效率 | token 成本（相对班级分布） | 10% |

课程总评可由教师配置：章节学习完成情况（过程性）+ 各实验项目成绩（按权重汇总）。（成绩汇总未实现，第三阶段）

## 十、实施路线图与实际进度

### 第〇阶段：DSH 技术实证 —— ✅ 已执行（2026-09-21，与 DSH 接入阶段合并）

原计划动工前先实证：DSH 安装与版本锁定、四个社区插件能力（skillforge/session-lab/skill-dossier/group-manager）、`agent/request` 条件锁定、容器内 headless 复验。

**执行结果**：DSH 锁定 `@deepseek-ai/dsh@0.1.5-rc.2`；`agent/request` 条件锁定与工具面 `ctx.tools.restrict()` 收窄已在 `nju-lab-client` 实现并实测；容器内 headless 复验由 `server/verify-image/` + `DockerEvaluationRunner` 落地（详见 HANDOFF 第 3 步）。原计划依赖的 `dsh-teach` **在 npm 上不存在（404）**，改为自写零依赖驱动脚本 `dsh/verify-poc/run-eval.mjs`；四个社区插件未采用，相关能力自研。

### 第一阶段：最小可行平台 —— ✅ 已完成（2026-09-21）

- NestJS 平台服务：课程/章节/项目/领取/提交/复验（Mock）/评分 + JWT 账号体系（含 admin 角色）
- React 前端：三段式布局 + 主题切换 + 教师 6 页 + 学生 5 页
- MySQL（Docker）+ nginx 生产部署（lab.xiaohe.biz）
- 全链路已验证：建课 → 章节 → 项目 → 选课 → 学习进度 → 解锁领取 → 提交 → 复验 → 批改 → 反馈

### 第二阶段：教学功能增强 —— 🔶 部分完成

已完成：学生管理（名单/添加/移出）、课程/章节/项目删除、待批改工作台、提交状态内嵌、章节发布/下线
已完成（DSH 侧，2026-09-21）：`nju-lab-client` 定制客户端插件全链路 —— 右侧栏任务面板（领取 / 提交 / 钉定条件展示 + 错误提示）、`agent/request` 条件锁定 + `ctx.tools.restrict()` 工具面收窄、**评估条件跨进程持久化**（claim 写盘 + 启动恢复，重启或分次 headless 运行都不丢钉定）、真实模板与数据集下载校验（含 Skill 根探测）、提交（ZIP + `.dshc` 证据包 + 审计事件）、模型引导（system prompt 段 + `nju-lab-experiment` skill）；真实容器复验（`DockerEvaluationRunner`）
未完成：审计事件展示深化；~~CSV 导出~~（2026-09-21 已有：项目级成绩 CSV）

### 第三阶段：平台化与扩展（🔶 部分完成）

- DSH 接入：第〇阶段实证 + 真实容器复验（headless + 断网 + approval=never）+ 学生端 profile 配置脚本
- 对象存储（S3/OSS；当前 files 模块为本地磁盘存储，生产化时替换）
- 学科工具包、自动评分辅助、参考技能库（SkillLibrary）
- ~~学校统一认证~~（**2026-09-24 已完成**：南大 CAS 3.0 接入，登录 / 登出 / 角色判定均已上生产，见 §6.1）、成绩系统对接；~~数据库 migrations、后端常驻化~~（2026-09-21 已完成）

## 十一、风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| DSH 处于 rc/alpha，官方明示破坏性变更 | 学期中平台崩坏 | **学期内锁定版本线不升级**；暑假跟进；平台服务与 DSH 解耦（已做到：复验走 EvaluationRunner 接口） |
| 四个社区插件能力不足或不存在 | 核心链路断裂 | DSH 接入阶段实证先行；缺失能力列为自研项 |
| 学生 Skill 含恶意代码 | 服务端安全 | 一次性断网容器复验；容器是唯一信任边界；静态检查（DSH 13.5 清单） |
| 评估不公平 | 成绩争议 | 版本化数据集 + eval_config 统一锁定（agent/request）；以平台复验为准 |
| 证据伪造 | 成绩争议 | .dshc 哈希 + 审计事件 + 独立复验交叉印证 |
| 学生本地环境安装失败/不一致 | 开课受阻 | 一键配置脚本；实证阶段产出安装手册；机房预装镜像兜底 |
| 学生只刷进度不上课 | 学习流于形式 | 章节完成可加自测题；实验解锁只是必要条件，成绩以实验复验为主 |
| 教师技术门槛高 | 推广困难 | 培训材料 + 批改指南；批改页以客观数据为主 |
| LLM 调用成本 | 预算 | DeepSeek 模型成本约为 Claude 系 1/10~1/30；每生 token 配额；班级成本监控 |
| DSH Web 相关的已知漏洞（#381/#451 等） | 学生本地安全 | DSH Web 只绑 loopback（默认即如此）；提醒学生不要用未知补丁绕过 |
| 弱口令账号 | 平台安全 | 种子账号仅用于开发；上线前用修改密码功能（已实现）逐个更换 |

## 十二、总结

基于 DSH 生态构建"课程 + 实验"一体化学生平台的技术可行性明确，且边界清晰：

- **DSH 的角色**：学生本地的 Skill 开发/自测环境（web profile）+ 服务端的复验引擎（headless profile）。它的独特价值——可运行 Skill、baseline/treatment 对比、证据包、质量档案——是平台教学价值的核心
- **DSH 不承担的角色**：课程内容、在线多租户、认证、成绩数据——全部由独立的平台服务负责。DSH Web 只绑 loopback 且无认证的事实，决定了"服务端集中式 DSH"不可行，三元结构是必然选择
- **工程纪律**：版本锁定（rc 阶段）、插件实证先行、复验容器是唯一信任边界

相比 Dify 方案的核心优势不变：学生提交的不是静态 DSL 图，而是可安装、可运行、附带实测证据与审计记录的 Skill 包。教师批改的对象从"你设计了什么"变成"你的设计实际表现如何"——这更接近实验课的本质：完成一次可复现、可验证的实验过程，并诚实地记录结果。

## 十三、实现现状（2026-09-21）

### 代码与部署

| 项 | 位置/值 |
|---|---|
| 仓库 | `/home/ubuntu/nju-lab/`（`server/` NestJS 后端、`web/` React 前端、`nju-lab-craft.md` 本文档） |
| 线上入口 | https://lab.xiaohe.biz（nginx → 静态 `/var/www/nju-lab/dist` + `/api/` → `127.0.0.1:3100`） |
| 数据库 | Docker 容器 `nju-lab-mysql`（MySQL 8.0，127.0.0.1:3306，库 `nju_lab`） |
| 种子账号 | `admin/admin123`（管理员）、`teacher/teacher123`（教师）、`student1/student123`（学生） |
| 启动 | 后端生产常驻：`systemctl start nju-lab`（unit `/etc/systemd/system/nju-lab.service`，`node dist/main.js`，Restart=always；发布 = `npm run build && sudo systemctl restart nju-lab`）；开发调试 `npm run start:dev`。前端改动需 `npm run build` 并替换 `/var/www/nju-lab/dist` |
| DSH 客户端插件（agent 侧） | `dsh/nju-lab-client/`（host + client 双半）：安装步骤与当前实现状态见 `dsh/nju-lab-client/README.md`，入口约定见 `dsh/README.md`；测试 `DSH_BIN=/path/to/dsh npm test`（61 条 = 55 L1 + 6 L2） |

### 课程公开目录与申请审批（2026-09-24 新增）

`/lab` 从「全站需登录」拆出**公开区**（无需登录的课程目录与课程公开页），并补上**课程申请 → 教师审批 → 入册**链路。核心设计：`published` 只表示「别人能看到」，能否申请由 `applicationOpenAt`/`capacity` 独立决定；`Enrollment` 语义不变（= 已批准入册），申请用独立表 `course_applications`，因此可见性/内容授权/任务分发三处代码零改动。批准时在事务里建入册并**补发该课程全部已发布项目的 Assignment**（项目发布只发给"当时在册"的学生，后来入册的必须补）。

完整设计、接口清单、踩坑与端到端实测结论见 **`docs/DESIGN-course-application-2026-09-24.md`** 与 `HANDOFF.md` §6。门户侧在 FoxCMS 新增「实验平台」外链栏目（`out_link=/lab/browse`）接入。

### 并行开发遗留问题的教训（已修复，供后续参考）

前后端曾并行开发，产生过一批契约不匹配，全部通过 curl 实测对齐修复：登录返回 `accessToken`（非 token）、进度接口是对象非数组、项目字段名（`skillTemplateRef`/`evalConfig.timeoutSeconds`/`rubric[{name,weight}]`）、提交哈希为 `skillZipSha256`/`capsuleSha256`（64 位 hex 必填）、评估 `successRate` 为 0~1 小数、项目 PATCH 为整体替换语义。**纪律：新接口必须先定契约再两端实现，联调以 curl 实测为准。**

### 已知遗留（按优先级）

1. ~~复验为 Mock~~ 已解决（2026-09-21）：`DockerEvaluationRunner` 上线——一次性容器（dsh headless + approval=never + 资源限额 + SNI 白名单网络隔离）跑 baseline/treatment + LLM judge，`EVALUATION_RUNNER=mock|docker` 可切换。`evalConfig.model`/`reasoningEffort` 逐项目映射已实现。网络隔离：`nju-verify-egress` internal 网络 + nginx stream ssl_preread 白名单代理（api.deepseek.com / api.moonshot.cn），负向实测通过
2. ~~提交物/模板/数据集只存字符串引用~~ 已解决（2026-09-21）：files 模块落地本地磁盘存储（`server/uploads/`），`POST /api/files` 上传（服务端算 sha256）、`GET /api/files/:id` 下载；项目改挂 `skillTemplateFileId`/`testDatasetFileId`；claim 下发真实下载地址；submit 支持 fileId 模式（归属与哈希服务端校验）。遗留：文件下载仅 UUID 能力凭证 + 登录，无细粒度鉴权；对象存储未接
3. 项目 PATCH（整体替换）与课程 PATCH（部分更新）语义不一致，待统一
4. ~~TypeORM synchronize + 常驻化~~ 已解决（2026-09-21）：migrations 上线（`synchronize: false` + `migrationsRun: true`，初始迁移 `server/src/migrations/1790002605000-InitialSchema.ts`，空库实测零 diff）；后端 systemd 常驻（`/etc/systemd/system/nju-lab.service`）
5. ~~无修改密码接口~~ 已解决（2026-09-21：`POST /api/me/password`，改后 tokenVersion+1 全端失效；Web 弹窗）。仍遗留：无单元测试；种子账号为弱口令（可用修改密码功能逐个更换）
6. SkillLibrary、章节自测题、成绩汇总未实现（第三阶段范围）；~~CSV 导出~~ 已有（`GET /api/projects/:id/grades.csv`）
