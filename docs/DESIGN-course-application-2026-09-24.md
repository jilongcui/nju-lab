# 课程目录、选课申请与工作台 · 方案设计

> 状态：**已实施**（2026-09-24），含当天的一次方向修订 —— **见 §10 修订记录**
> 关联：`nju-lab-craft.md`（系统设计总文档）、`HANDOFF.md`（开发交接）
> 部署点：`njuserver`（`http://medai.nju.edu.cn/lab/`）
>
> ⚠️ 阅读提示：本文档初版把课程目录设计成「无需登录的公开区」，当天下午按产品决策
> **收回为登录后可见**。正文已按最新状态改写，被改写的段落都标了「2026-09-24 修订」；
> 变更原因与前后对照见 §10。

## 1. 背景：要解决的问题

门户（FoxCMS，`medai.nju.edu.cn/`）与实验平台（`/lab`）同域共存，但两边对"课程"的理解不一致，导致三种可见性全都缺失：

| 角色 | 改造前能看到什么 | 问题 |
|---|---|---|
| 未登录访客 | 什么都看不到（`/lab` 全站 `RequireAuth`） | 课程无法对外展示、无法分享 |
| 学生 | **只有**教师把自己加入名单的课程；未入册时返回**空列表** | 不能发现课程、不能自己选课 |
| 教师 | 自己开的课 | 只能"直接加名单"，无法受理报名 |

改造前 `Enrollment` 同时承担三件事（见 §5.1），因此"选课"在结构上无处安放。

### 用户已确认的决策

| # | 决策点 | 结论 |
|---|---|---|
| 1 | 门户与 `/lab` 的关系 | 门户只做**展示 + 入口**，不做登录、不复制课程数据 |
| 2 | 课程目录放哪 | **`/lab` 内**；⚠️ **2026-09-24 修订**：此前定为"无需登录的公开区"，后改为**平台内容一律登录后可见**（未登录访客直接落登录页），见 §10 修订记录 |
| 3 | 课程与申请的耦合 | 公开可见 → 申请 → 教师审批 → 入册 |
| 4 | 容量口径 | **按批准数**（`count(Enrollment)`）满才关闭 |
| 5 | 申请开放时机 | **独立于发布状态**，由时间控制（可定时开放） |
| 6 | 驳回后能否再申请 | **可以重复申请**，**不限频** |
| 7 | 审批粒度 | **逐个批准** |
| 8 | 申请量是否限制 | **不限制**（先跑起来） |
| 9 | 批准后的连带动作 | 补发该课程**全部已发布项目**的 `Assignment` |
| 10 | 登录后落地页 | 各自的工作台（学生工作台含概览 + 待办实验 + 选课入口） |
| 11 | 选课路径 | 登录 → 工作台 →「选课」→ 课程目录 → 课程详情 → 申请 |

## 2. 目标形态

```
门户（FoxCMS，公开）
   · 实验室介绍、活动、新闻
   · 人工精选的几门课程导览（编辑文案 + 配图）
   └─→ 「实验平台」入口（外链栏目）→ /lab/  → 未登录则落登录页

/lab（**需登录**，CAS/本地账号）
   · 工作台（学生/教师各自的落地页）
   · 「选课」：课程目录 + 检索 → 课程详情（标题/简介/教师/章节大纲/名额/申请状态）
       └─→ 申请 → 教师审批 → 入册
   · 学习与实验：章节正文与进度、实验项目、模板与数据集
   · 提交、容器复验、批改、成绩
```

**核心语义**：`Course.status = published` 表示「**别人能看到**」；**能否申请是另一个维度**，由 `applicationOpenAt` / `applicationCloseAt` / `capacity` 共同决定。二者解耦，才能支持"前期只展示，到点才开放申请"的热门课程策略。

## 3. 数据模型

### 3.1 新增表 `course_applications`

```ts
CourseApplication
  id          uuid PK
  courseId    varchar(36)  FK → courses (CASCADE)
  studentId   varchar(36)  FK → users   (CASCADE)
  status      enum('pending','approved','rejected')  default 'pending'
  decisionNote text NULL          // 驳回理由（可选）
  decidedBy   varchar(36) NULL    // 审批人 userId
  decidedAt   datetime NULL
  createdAt   datetime
```

**关键约束**：允许重复申请，但保证**同一课程 + 同一学生同时只有一条 `pending`**。用生成列 + 唯一索引实现（利用 MySQL 唯一索引允许多个 NULL）：

```sql
pendingFlag TINYINT GENERATED ALWAYS AS (IF(`status` = 'pending', 1, NULL)) STORED,
UNIQUE KEY uq_course_application_pending (courseId, studentId, pendingFlag)
```

| 场景 | `pendingFlag` | 结果 |
|---|---|---|
| 两条 `pending` | 1, 1 | 冲突，拒绝 ✓ |
| `pending` + `rejected` | 1, NULL | 放行 ✓ |
| 两条 `rejected` | NULL, NULL | 放行 ✓ |

好处：**申请历史完整保留**（教师能看到"该生申请过 3 次、驳回 2 次"），且因为容量按批准数算，多余的 `rejected` 记录不影响名额。

### 3.2 `courses` 表新增字段

| 字段 | 类型 | 含义 |
|---|---|---|
| `slug` | `varchar(128)` NULL, UNIQUE | 公开链接标识，**发布后不变**（标题改了也不改） |
| `capacity` | `int` NULL | 名额上限，`NULL` = 不限 |
| `applicationOpenAt` | `datetime` NULL | `NULL`=不开放；未来=待开放；过去=开放中 |
| `applicationCloseAt` | `datetime` NULL | 可选截止时间 |

> 用**单一可空时间字段**表达三态，而不是 `boolean 开关 + 时间`两个字段——后者会互相矛盾（`open=false` 但 `openAt` 是过去时间）。

### 3.3 为什么不给 `Enrollment` 加状态

`Enrollment` 现有语义是「**已批准入册**」，三处代码依赖它且都假设"在表里 = 已入册"：

| 依赖点 | 作用 |
|---|---|
| `CoursesService.listCourses()` 学生分支 | 可见哪些课 |
| `CoursesService.getCourse()` → `assertEnrolled()` | 能否打开课程 |
| `ProjectsService.publishProject()` | 给谁生成 `Assignment` |

新增独立表 = **这三处零改动**。同时"容量按批准数"天然对齐：`count(Enrollment where courseId)` 就是已批准人数。

## 4. 后端接口

### 4.1 认证：不再有「匿名放行」这一层

**2026-09-24 修订**：初版为了让公开课程页匿名可读，曾新增 `@OptionalAuth()`（带 token 识别、不带也放行）。随「平台内容一律登录后可见」的决策，该装饰器与守卫分支**已移除**，仅保留 `@Public()` 用于登录/注册/CAS 回调等认证入口。

### 4.2 课程目录接口（需登录）

```
GET /api/browse/courses                 课程目录 + 检索（关键词/学期）
GET /api/browse/courses/:slug           课程详情
```

> 路径初版为 `/api/public/courses`；既然需登录，已改名以免误导。
> 迁移注意：旧路径**不再存在**（返回 404），前端两处调用已同步。

`GET /api/browse/courses/:slug` 返回：

```ts
{
  ...课程字段（title/description/term/teacher 昵称/章节大纲/容量）,
  applicationState: 'open' | 'not_open_yet' | 'full' | 'closed' | 'not_published',
  applicationOpenAt, applicationCloseAt,
  seatsLeft: number | null,          // capacity - 已批准数
  approvedCount: number,
  myApplication: { status, createdAt } | null,   // 当前用户最近一次申请
  myEnrollment: boolean,                          // 当前用户是否已入册
}
```

**为什么 `applicationState` 必须由后端算**：它依赖 `count(Enrollment)`，前端拿不到别人的入册数，无法自行判断。

### 4.3 学生

```
POST   /api/courses/:courseId/applications      提交申请
DELETE /api/courses/:courseId/applications/:id  撤销自己的 pending 申请
GET    /api/me/applications                     我的申请列表
```

### 4.4 教师（含 admin）

```
GET  /api/courses/:courseId/applications               申请列表（按 createdAt 升序＝先到先得）
POST /api/courses/:courseId/applications/:id/approve   批准
POST /api/courses/:courseId/applications/:id/reject    驳回
```

现有 `PATCH /api/courses/:id` 扩展 `slug` / `capacity` / `applicationOpenAt` / `applicationCloseAt`。

## 5. 关键实现要点

### 5.1 批准动作 = 建 `Enrollment` + 补发 `Assignment`

```
批准(applicationId)
  ├─ 事务：锁课程行 → 校验容量 → 建 Enrollment
  ├─ application.status = approved
  └─ backfillAssignmentsForStudent(courseId, studentId)
```

**`publishProject()` 是发布那一刻一次性**给"当时在册学生"建 `Assignment` 的。项目发布**之后**才入册的学生不会有任何 `Assignment`——他在私域区会看到空的实验列表。所以审批通过必须补发。

**必须用独立方法，不能复用 `publishProject()`**：

| 原因 | 说明 |
|---|---|
| 语义错乱 | `publishProject()` 开头就是 `project.status = PUBLISHED; save()`，对已发布项目等于"重新发布" |
| 误发布风险 | 它**不检查当前是否 draft**，误传草稿项目会把它直接发布出去 |
| 脆弱 | `ProjectStatus.CLOSED` 目前从未被任何代码设置（纯预留），一旦将来启用"截止后关闭项目"，`publishProject()` 里的检查会让补发抛错 |

```ts
/** 为指定学生补发本课程全部「已发布」项目的任务 */
async backfillAssignmentsForStudent(courseId: string, studentId: string)
  // find projects where { courseId, status: PUBLISHED }   ← 只挑已发布
  // 逐个 exists 检查后补建 Assignment（沿用既有幂等写法）
```

### 5.2 容量与并发

- 判定：`count(Enrollment where courseId) >= capacity` → 拒绝，报「名额已满」
- 逐个批准下，两个标签页同时批准最后两个名额可能超额 → **事务内 `SELECT ... FOR UPDATE` 锁课程行**再 count + insert

### 5.3 已满不清空队列

「满」只阻止**新申请**，不清空已有 `pending`。教学场景里"有人退课 → 名额空出 → 从队列补批"是常态（退课走现有 `DELETE /courses/:id/enrollments/:studentId`，会释放名额）。

### 5.4 `slug` 生成与稳定性

- 建课时自动生成（标题转拼音/短哈希），教师可改
- **发布后锁定**：`publishCourse()` 之后不允许再改 `slug`，保证已分享的链接不失效
- 冲突时自动加后缀

## 6. 前端

### 6.1 路由分区

**2026-09-24 修订**：初版把课程目录/课程页放在 `RequireAuth` **之外**（"公开区"）。现全部收进 `RequireAuth`：

```
平台内（RequireAuth，未登录一律落 /login）
  /lab/                       → 各自工作台（学生 /student/home，教师 /teacher/dashboard）
  /lab/browse                选课：课程目录 + 检索
  /lab/course/:slug          课程详情 + 申请
  /lab/student/*  /lab/teacher/*
```

`{ path: '*' }` fallback：未登录 → `/login`，已登录 → 角色工作台。

### 6.2 CAS returnTo（仍然必要）

改造前：`/api/auth/cas/login` → 学校 authserver → `/api/auth/cas/callback` → 固定 302 到 `{前端基路径}/login/cas?token=` → `CasCallback` 直接跳角色首页。**原目标页丢失**。

`service` 参数固定不接受外部传入（防开放重定向，**保持不动**）。修法：**前端 `sessionStorage` 存 returnTo**，`CasCallback` 登录成功后读回并跳转。零后端改动、不放宽任何安全校验。

> 取用户说的是"从某个页面被弹去登录，回来还要在那个页面"。既包括课程页申请，也包括任何深链被 `RequireAuth` 拦下的场景。

### 6.3 页面

| 页面 | 说明 |
|---|---|
| **学生工作台**（`/student/home`，新增） | 统计卡（我的课程/待办实验/待审批申请/章节完成度）+ 待办实验列表 + 「去选课」入口 |
| 选课（`/browse`） | 卡片列表 + 关键词检索；显示申请状态徽标（开放中/未开放/已满） |
| 课程详情（`/course/:slug`） | 完整介绍 + 章节大纲 + 名额 + 申请按钮；未开放显示开放时间 |
| 我的申请 | 学生查看自己的申请状态 |
| 申请审批 | 教师：按申请时间升序，逐个批准/驳回，显示名额与剩余队列 |

## 7. 门户（FoxCMS）接入

- 顶部导航加「实验平台」项，用**后台"外部链接"栏目**（`fox_column.out_link`）配置，**不硬编码模板**（SQL 固化在 `foxcms/sql/column-lab-entry.sql`）
- 入口指向 `/lab/browse`；未登录会被 `/lab` 的登录页接住
- 门户**不复制课程数据**，只做导览

## 8. 非目标（明确不做）

- ❌ 门户与 `/lab` 之间做 token 传递 / 自定义 SSO（有泄漏风险；CAS 已提供单点）
- ❌ FoxCMS 会员体系与 lab `User` 表双向同步
- ❌ 门户镜像 lab 的成绩/进度数据
- ❌ 批量批准（决定逐个；前端可用"逐行批准 + 自动定位下一个"优化操作）
- ❌ 申请量上限 / 驳回限频（先跑起来）
- ❌ 真多租户
- ❌ 匿名可浏览的课程页（2026-09-24 修订后收回）

## 9. 验收标准

1. **未登录访问 `/lab/*` 与课程目录接口一律落到登录页 / 401**
2. 登录后落到各自工作台；学生工作台的「去选课」能进课程目录
3. 未开放申请的课程显示开放时间，不能申请
4. 学生可提交申请；重复提交（已有 pending）被拒
5. 被驳回后可再次申请
6. 教师批准到 `capacity` 后，新申请被拒且提示「名额已满」
7. 批准后学生出现在名单中，**且能领到该课程全部已发布项目的实验任务**（补发生效）
8. 深链被拦去登录后，登录完成能回到原页面
9. 退课后名额释放，可为排队申请补批

## 10. 修订记录

### 2026-09-24：课程目录收回登录后可见

**初版与修订后**：

| | 初版（当天早些时候） | 修订后 |
|---|---|---|
| 未登录访客 | 能浏览课程目录与课程详情 | **直接落登录页** |
| 接口 | `GET /api/public/courses[/:slug]`，用 `@OptionalAuth()` 匿名放行 | `GET /api/browse/courses[/:slug]`，需登录（`@OptionalAuth()` 已删除） |
| 布局 | 独立的公开布局（`PublicLayout`，深色顶栏） | 并入平台内布局（与工作台同一套外壳） |
| 门户入口 | 未登录可直达课程目录 | 落到登录页 |

**原因**：门户侧定位是"展示 + 入口"，而实验室平台的内容（含课程目录本身）不是对外宣传物料；且免登录的独立站点在视觉上与平台割裂。

**同步改动**：学生/教师各自的落地页改为工作台；学生菜单新增「选课」；`{ path: '*' }` 兜底由"匿名→/browse"改为"匿名→/login"。

**保留不变**：`published` 只表示"别人能看到"、申请开放时间与名额独立控制、容量按批准数、可重复申请不限频、逐个审批、批准后补发 `Assignment`。
