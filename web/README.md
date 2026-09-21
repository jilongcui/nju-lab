# NJU-Lab Web 前端

「课程 + 实验」一体化教学平台前端。教师建课/建实验/批改，学生上课/做实验/提交。

## 技术栈

- Vite 5 + React 18 + TypeScript（strict）
- Ant Design v5（ConfigProvider + cssVar 主题体系）
- react-router-dom v6 / axios / zustand（持久化到 localStorage）
- marked（轻量 Markdown 预览，无重型编辑器依赖）

## 启动步骤

```bash
cd web
npm install
npm run dev      # 开发服务器，默认 http://localhost:5173
npm run build    # 类型检查 + 生产构建（tsc --noEmit && vite build）
npm run preview  # 预览生产构建
```

- 后端约定运行在 `http://localhost:3000`，vite 已将 `/api` 代理到该地址（见 `vite.config.ts`）。
- 种子账号（后端种子）：教师 `teacher / teacher123`，学生 `student1 / student123`。
- 接口统一返回 `{ code, data, message }`（`code = 0` 成功），axios 响应拦截器统一解包并在失败时 `message.error` 提示；请求拦截器自动携带 `Authorization: Bearer <token>`，401 自动登出并跳转登录页。

## 页面与路由清单

登录/注册为独立全屏页，其余页面统一复用 `AppLayout` 三段式布局（左侧菜单区 / 中间功能区 / 右侧辅助区）。

| 路径 | 页面 | 角色 |
|---|---|---|
| `/login` | 登录 | 公开 |
| `/register` | 注册（username/password/nickname/role） | 公开 |
| `/teacher/dashboard` | 工作台（课程数/进行中实验/待批改提交等统计卡片） | 教师 |
| `/teacher/courses` | 课程列表（新建/发布课程） | 教师 |
| `/teacher/courses/:courseId` | 课程详情：章节大纲（可新建章节）、章节下实验卡片、班级学习进度 | 教师 |
| `/teacher/chapters/:chapterId/edit` | 章节编辑（Markdown 编辑 + 预览） | 教师 |
| `/teacher/projects/:projectId` | 实验项目详情：完整项目信息展示与编辑（目标/背景/任务/evalConfig/rubric/截止时间/解锁规则）、发布、学生提交表格 | 教师 |
| `/teacher/submissions/:submissionId/grade` | 批改页：提交详情（引用/哈希/审计事件）+ 复验结果（baseline/treatment 对比、成功率、token 成本、评分建议）+ 打分评语 | 教师 |
| `/student/courses` | 我的课程（含章节进度） | 学生 |
| `/student/courses/:courseId` | 课程学习页：章节列表 + 实验卡片解锁状态 | 学生 |
| `/student/chapters/:chapterId` | 章节阅读（标记完成） | 学生 |
| `/student/projects/:projectId` | 实验详情（学生视图，只读项目信息 + 领取按钮，未解锁禁用并提示） | 学生 |
| `/student/submissions` | 我的提交与反馈：提交表单（skillZipRef/capsuleRef/auditEvents/哈希）、复验结果与教师评语 | 学生 |

路由守卫：未登录访问任意受保护页面跳 `/login`；角色不匹配跳回本角色首页。

## 布局说明

- **菜单区**：左侧 Sider，Logo + 按角色过滤的菜单 + 底部折叠按钮。
- **功能区**：中间主内容区，顶部 Header 含面包屑（随路由自动生成）、主题开关、主题色板、用户菜单。
- **辅助区**：右侧 280px 可收起面板（`AuxiliaryPanel`），内容由各页面通过 `useAuxiliaryPanel(title, content)` 注入（页面说明/待办/快捷操作），收起状态持久化。

## 主题切换

- Header 右侧开关切换明亮/暗黑（antd `theme.darkAlgorithm`），色板 Popover 提供 6 个预设主题色，点击即换 `colorPrimary`。
- 基于 antd v5 `ConfigProvider + cssVar`，选择经 zustand persist 存 localStorage（key：`nju-lab-theme`），刷新不丢。

## 主要 API 对接点（`src/api/index.ts`，已按后端 3100 端口实测契约对齐）

- 认证：`POST /api/auth/login`、`POST /api/auth/register`（返回 `accessToken`）
- 课程：`GET/POST /api/courses`、`GET/PATCH/DELETE /api/courses/:id`、`POST /api/courses/:id/publish`、`GET /api/courses/:id/progress`（返回对象 `{courseId, chapterCount, studentCount, students[]}`）、`GET /api/courses/:id/dashboard`
- 选课学生：`GET /api/users/students`、`GET/POST /api/courses/:id/enrollments`、`DELETE /api/courses/:id/enrollments/:studentId`
- 章节：`POST /api/courses/:id/chapters`（upsert，带 id 更新，可切换 status 发布/下线）、`GET/DELETE /api/chapters/:id`
- 实验：`GET/PATCH/DELETE /api/projects/:id`（**PATCH 为整体替换，必须提交完整字段**）、`POST /api/projects`、`POST /api/projects/:id/publish`、`GET /api/projects/:id/submissions`、`GET /api/projects/:id/dashboard`
- 提交批改：`GET /api/submissions/:id`、`POST /api/submissions/:id/verify`、`GET /api/submissions/:id/evaluation`、`POST /api/submissions/:id/grade`
- 学生：`GET /api/me/courses`、`GET /api/chapters/:id`（含 `myProgress`）、`POST /api/chapters/:id/complete`、`GET /api/me/assignments`（每条任务内嵌最新提交 `submission: {id, status, submittedAt} | null`）、`POST /api/assignments/:id/claim`、`POST /api/assignments/:id/submit`（skillZipRef/capsuleRef + 两者 SHA-256 必填）、`GET /api/me/evaluations/:id`（:id 为 evaluation ID）
- 工作台：`GET /api/dashboard/teacher-summary`（课程数/学生总数/待批改列表）

> 注意：课程 PATCH 是部分更新，项目 PATCH 是整体替换（编辑表单始终提交完整字段集）。

