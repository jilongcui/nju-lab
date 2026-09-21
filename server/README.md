# NJU-Lab Server

「课程 + 实验」一体化教学平台后端：学生课程学习 → 解锁实验 → 提交 Skill 包 → 平台复验评分。
技术栈：NestJS 11 + TypeORM + MySQL（mysql2）+ JWT（passport-jwt）+ bcryptjs + class-validator。

## 启动步骤

```bash
cd server
cp .env.example .env        # 按需修改 DB 连接、JWT_SECRET、PORT
npm install
npm run seed                # 初始化数据库表结构 + 写入种子数据
npm run start:dev           # 开发模式（ts-node）
# 或
npm run build && npm start  # 编译后以 node dist/main.js 运行
```

所有 API 挂在 `/api` 前缀下，默认端口 `PORT`（.env.example 为 3000；若被占用可在 .env 改端口，如 3100）。

数据库：MySQL 8（Docker），默认连接 `127.0.0.1:3306`，库 `nju_lab`，用户 `nju_lab` / `nju_lab_dev`。
开发阶段 TypeORM `synchronize: true` 自动建表，生产环境应切换为 migrations。

## 种子账号（npm run seed 创建）

| 账号 | 密码 | 角色 |
|---|---|---|
| teacher | teacher123 | 教师 |
| student1 | student123 | 学生 |

另含一门已发布示例课程「Skill 工程导论（示例课程）」：2 个已发布章节 + 1 个挂在第 2 章的已发布实验项目（student1 已选课并生成 Assignment）。

## 统一约定

- 成功响应：`{ "code": 0, "data": ..., "message": "ok" }`
- 错误响应：`{ "code": <httpStatus>, "data": null, "message": "..." }`
- 认证：请求头 `Authorization: Bearer <token>`；登录/注册外的接口全部需要 token
- 角色：`teacher` / `student`，学生只能访问自己的课程、任务与复验结果

## API 一览

### 认证 / 用户

| 方法 | 路径 | 说明 | 角色 |
|---|---|---|---|
| POST | /api/auth/register | 注册（username/password/nickname/role） | 公开 |
| POST | /api/auth/login | 登录，返回 `{ user, accessToken }` | 公开 |
| GET | /api/me | 当前用户 | 登录 |
| POST | /api/me/tokens | 生成长期 API token（365 天，payload 带 `ver`；供本地 DSH 插件） | 登录 |
| POST | /api/me/tokens/revoke | 吊销：tokenVersion+1，本人全部 token（含 Web 登录态）失效 | 登录 |

### 课程（教师侧）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /api/courses | 创建课程（draft） |
| GET | /api/courses | 课程列表（教师：自己开的；学生：被选入的） |
| GET | /api/courses/:id | 课程详情（含章节） |
| PATCH | /api/courses/:id | 更新课程 |
| POST | /api/courses/:id/publish | 发布课程 |
| POST | /api/courses/:id/chapters | 创建章节（body 带 `id` 则更新该章节） |
| GET | /api/courses/:id/chapters | 章节列表（学生仅见已发布） |
| POST | /api/courses/:id/enrollments | 把学生加入课程 `{ studentIds: [] }` |
| GET | /api/courses/:id/progress | 班级学习进度（逐学生逐章节） |
| GET | /api/courses/:id/dashboard | 课程班级视图（章节完成率） |

### 实验项目（教师侧）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /api/projects | 创建实验项目（挂在章节下；含 objectives/background/description/skillTemplateFileId/testDatasetFileId/evalConfig/rubric/references/faq/unlockRule/deadline） |
| GET | /api/projects | 教师侧实验项目总列表（跨课程，附课程/章节名与提交进度；admin 见全部） |
| GET | /api/projects/:id | 项目详情（学生侧附带 unlocked 标记） |
| PATCH | /api/projects/:id | 更新项目 |
| POST | /api/projects/:id/publish | 发布并为本课程全部学生生成 Assignment |
| GET | /api/projects/:id/submissions | 该项目全部提交（按学生列出） |
| GET | /api/projects/:id/dashboard | 班级视图（提交进度、成功率分布、token 成本分布） |
| POST | /api/submissions/:id/verify | 触发复验（当前为模拟 EvaluationRunner） |
| GET | /api/submissions/:id/evaluation | 复验结果（教师或提交者本人） |
| POST | /api/submissions/:id/grade | 确认评分与评语 `{ teacherScore, teacherComment }` |

### 文件

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /api/files | 上传（multipart 字段 `file`，≤100MB；返回 fileId/url/sha256，sha256 为服务端权威值） |
| GET | /api/files/:id | 下载（登录即可；id 为不可猜测 UUID，充当能力凭证；文件流不走统一响应包装） |

### 学生侧

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /api/me/courses | 我的课程与逐章进度 |
| GET | /api/chapters/:id | 阅读章节（自动记录"学习中"，不回退"已完成"） |
| POST | /api/chapters/:id/complete | 标记章节完成 |
| GET | /api/me/assignments | 任务列表（含 unlocked 解锁状态） |
| POST | /api/assignments/:id/claim | 领取（校验 unlockRule；返回模板/数据集文件信息（url+sha256）+ evalConfig） |
| POST | /api/assignments/:id/submit | 提交（推荐 skillZipFileId/capsuleFileId，先 POST /api/files 上传；兼容 ref+sha256 直填；附审计事件/各文件 sha256） |
| GET | /api/me/evaluations/:id | 查看自己的复验结果与教师反馈 |

## 关键设计

- **AuthProvider 抽象**（`src/auth/providers/auth-provider.interface.ts`）：认证逻辑集中在 Provider 中，当前实现 `LocalAuthProvider`（bcryptjs）。后期接学校统一认证时新增 Provider 并在 `AuthModule` 替换 `AUTH_PROVIDER` 绑定即可。
- **EvaluationRunner 抽象**（`src/submissions/evaluation-runner.ts`）：两种实现，环境变量 `EVALUATION_RUNNER` 切换（`SubmissionsModule` 的 useFactory，默认 `mock`）：
  - `mock` → `MockEvaluationRunner`：基于提交哈希生成确定性的模拟复验数据，用于无 Docker/无模型 key 的开发环境。
  - `docker` → `DockerEvaluationRunner`（`src/submissions/docker-evaluation-runner.ts`）：真实复验。解析 `skillZipRef` 的 `file:<id>` 与项目数据集文件 → 起一次性容器（输入只读挂载、`--memory 1g --cpus 1`、超时强杀，`MOONSHOT_API_KEY` 由服务端环境透传）→ 容器内跑 dsh headless（`nju-lab-verify` profile：approval=never + workspace-write 沙箱）baseline/treatment 两轮 → LLM judge 逐 case 评分（`{pass, score, rationale}`，rationale 进结果供教师批改页；`evalConfig.judgeMode: 'exact'` 可切回逐字节比对）→ 映射 EvaluationRunResult（successRate=treatment 通过率、tokenCost=两轮+ judge 实测 token 总和、integrityCheck=自报 fileHashes vs 容器实测哈希对照 + capsule 哈希校验、autoScoreSuggestion 沿用 Mock 权重公式但全部输入为实测值）。
  - 镜像构建：`cd verify-image && docker build -t nju-lab-verify:0.1.5-rc.2 .`（node:22-slim + 锁定 `@deepseek-ai/dsh@0.1.5-rc.2` + zstd/unzip/python3 + 驱动 `run-eval.mjs` + `nju-lab-verify` profile，约 512MB）。
  - 可选 env：`VERIFY_IMAGE` / `VERIFY_TIMEOUT_MS`（默认 600000，evalConfig.timeoutSeconds 优先）/ `VERIFY_MAX_CASES`（默认 0=全部，成本控制用）/ `VERIFY_JUDGE_MODE`（默认 llm）/ `VERIFY_DOCKER_MEMORY` / `VERIFY_DOCKER_CPUS`。
  - 出栈隔离（已实现）：复验容器挂 `--internal` 网络 `nju-verify-egress`（无外网路由：非白名单域名 DNS 黑洞 + 直连 IP 无路由），白名单域名（`api.deepseek.com`、`api.moonshot.cn`）经 `--add-host` 钉到双宿主 SNI 代理容器 `nju-verify-egress-proxy`（nginx stream + ssl_preread，配置 `verify-image/egress-proxy/nginx.conf`）；网络与代理由 runner 每次复验前幂等确保，代理不可用则 fail-closed 报错。架构与运维详见 `verify-image/README.md`。
- **unlockRule**：默认规则 = 完成该实验所属章节之前的全部已发布章节；也支持 `{ type: 'none' }`（无前置）与 `{ type: 'chapters', chapterIds }`（指定章节）。不满足时 claim 返回 403。
- **提交状态机**：`submitted → verifying → verified/failed → graded`；仅复验失败（failed）后允许重新提交。
- **复用第八节评分体系**：rubric 为 JSON 维度权重（默认：规范完整度 15 / 边界质量 25 / 实测有效性 40 / 证据完整性 10 / 工程效率 10），模拟评分建议以实测有效性为主导。

## 遗留说明（后续阶段）

- 文件已落地本地磁盘存储（`server/uploads/`，files 模块）；对象存储（S3/OSS）与文件细粒度鉴权留待生产化
- 复验已接一次性容器（docker 模式）+ SNI 出栈白名单隔离（见 `verify-image/README.md`）；剩余边界：白名单按域名不按路径（学生代码可用自己的 key 调同一域名，MITM 级加固留待更后期）；提交后不会自动触发复验（需教师手动 POST verify）
- 无 CSV 成绩导出、参考技能库（SkillLibrary）、掉队预警
- 无单元测试；无 migrations（依赖 synchronize）
