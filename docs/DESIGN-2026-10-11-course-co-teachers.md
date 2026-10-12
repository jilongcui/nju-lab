# 课程多教师协作 + 编辑并发保护（设计）

> 2026-10-11。背景：课程是**单教师**模型（`courses.teacherId` 一个字段），希望一门课能属于
> 多位老师、同时编辑。用户已确认三项口径：**完整多教师**（除「删除课程」「转让」仍限
> 主教师+管理员，其余权限协作者同等）、**一并做乐观锁**、**协作者由主教师/管理员直接指定**。

## 1. 现状与问题

- `courses.teacherId` 单值；「谁算这门课的老师」这个判断**散落在 7 个模块的 11 处**：
  `courses.service.ts`（列表 where / 转让 / isOwner / 更新校验 / 删课）、`dashboard.service.ts`（工作台课程列表）、
  `submissions.service.ts`（批改、看提交）、`slides.service.ts`（canEdit）、`projects.service.ts`、
  `course-applications.service.ts`（审批）。
  只加字段不动这些点，会出现「章节能改、幻灯片不能改」这类不一致。
- **没有任何并发保护**：`upsertChapter` 与 `slides.save` 都是 `Object.assign` + `save`，
  **后保存者静默覆盖**；幻灯片「生成」是异步的，两人同时点会互相覆盖并白烧两次 token。
  前端只有「本页有未保存修改就拦一下」的**本地**守卫，跨用户无效。
  ⇒ 所以多教师必须与乐观锁**一起**做，否则「同时编辑」的体验比现在更差。

## 2. 数据模型

| 变更 | 说明 |
|---|---|
| **新增 `course_teachers`** | `(id, courseId, userId, createdAt)`，`UNIQUE(courseId, userId)`，两个外键 `ON DELETE CASCADE`。仿 `enrollments` 的写法。**主教师也在表里**（便于一条 JOIN 查「我参与的全部课程」） |
| `courses.teacherId` | **保留**，语义收窄为「**主教师**（创建者/负责人）」。展示、转让、`slug` 发布等仍以它为准 |
| `chapters.version` | `int NOT NULL DEFAULT 0`，每次成功保存 +1（乐观锁） |
| `chapters.updatedBy` | `varchar(36) NULL`，记录最后一次保存者（冲突提示里要说清「被谁改了」） |
| `slide_decks.version` / `updatedBy` | 同上 |

**迁移**（`server/src/migrations/<ts>-CourseCoTeachers.ts`，`up`/`down` 成对）：
① 建 `course_teachers`；② 给 `chapters` / `slide_decks` 加 `version`、`updatedBy`；
③ **回灌**：`INSERT INTO course_teachers SELECT UUID(), id, teacherId, NOW() FROM courses`（幂等用 `NOT EXISTS`）。
回滚：`down` 删表删列；回灌只影响新表，不触碰 `courses.teacherId`，因此**随时可退回单教师**。

## 3. 权限矩阵

| 能力 | 主教师 | 协作者 | 管理员 |
|---|---|---|---|
| 看课程（含草稿）/ 编辑章节 / 幻灯片 / 实验项目 | ✓ | ✓ | ✓ |
| 批改提交、看提交与成绩、导出 CSV | ✓ | ✓ | ✓ |
| 审批报名申请 | ✓ | ✓ | ✓ |
| **改协作者名单** | ✓ | ✗ | ✓ |
| **转让主教师 / 删除课程 / 发布** | ✓ | ✗ | ✓ |

判定收敛成 `CoursesService` 上**两个**方法，其它模块一律调它们：

```ts
/** 该用户是否算这门课的老师（管理员直通；主教师或协作者） */
async isTeacherOfCourse(course: Course, userId: string): Promise<boolean>
/** 同上，但不是就抛 403；返回 course，便于调用方继续用 */
async assertTeacherOfCourse(user: User, courseId: string): Promise<Course>
```

11 处替换原则：原来 `course.teacherId === user.id`（或 `!==` 抛错）→ 换成 `assertTeacherOfCourse`；
「课程列表 / 工作台列表」由 `where: { teacherId: user.id }` 改为
`JOIN course_teachers ct ON ct.courseId = c.id AND ct.userId = :uid`（管理员仍看全部）。
**「删课 / 发布 / 改协作者 / 转让」四处继续判 `teacherId === user.id || ADMIN`** —— 这是矩阵里刻意保留的差别。

## 4. 接口

| 方法 | 路径 | 权限 | 语义 |
|---|---|---|---|
| `GET` | `/courses/:id/teachers` | 课程任一教师 + 管理员 | 返回 `{ ownerId, teachers: [{ id, nickname, username, role: 'owner' \| 'co_teacher' }] }` |
| `PUT` | `/courses/:id/teachers` | **主教师 + 管理员** | body `{ userIds: string[] }`，**全量设置协作者**（主教师由转让改，自动从列表里剔除）；目标必须是 teacher/admin |
| `PATCH` | `/courses/:id`（`teacherId`） | **主教师 + 管理员**（原先只允许管理员） | 转让：`courses.teacherId = 新教师`；**新主教师加入 `course_teachers`**，**原主教师保留为协作者**（不夺走他的编辑权） |

`GET /courses`（教师视角）与 `GET /courses/:id` 的返回补 `teacherNames: string[]`
（主教师在前），前端卡片与公开页据此显示「授课教师：A、B」。

## 5. 并发（乐观锁协议）

- **写请求带版本**：`UpsertChapterDto.version?`、`SaveDeckDto.version?`、`GenerateDeckDto.version?`（都可选）。
- **判定**：给了 `version` 且 ≠ 库中当前值 → `409 ConflictException`，body：
  `{ message: '内容已被他人修改', currentVersion, updatedBy: { id, nickname } | null }`。
  未给 `version` 时按旧行为放行（向后兼容：学生端不写、老前端不传）。
- **成功保存**：`version += 1`、`updatedBy = user.id`（章节与 deck 都要）。
- **前端**：编辑页记住加载时的 `version`，保存时带上；收到 409 → 弹 `Modal.confirm`：
  「此章节已被 **窦环** 修改（12:31），你的修改**未保存**。刷新后会加载对方的最新内容，请重新合并。」
  两个动作：**刷新（丢弃我的修改）** / **留在此页（我先手动复制）**。
- 幻灯片「生成」同样带 `version`：两人同时点生成，后到者收到 409 而不是静默覆盖 + 白烧 token。

## 6. 前端改动

- `types`：`Course.teacherNames?: string[]`、`CourseTeacher { id, nickname, username, role }`、
  `Chapter.version?: number`、`SlideDeckView.version?: number`。
- `teacher/CourseList.tsx` 编辑弹窗：
  - 「**主教师（转让）**」单选 —— 可见性：管理员 或 本人是主教师（原先只有管理员）。
  - 「**协作教师**」多选（`/courses/:id/teachers` 的 `PUT`）—— 可加/减；选项来自教师名单接口。
  - 卡片副标题改为「授课教师：窦环（主）、张三」。
- `student/CourseDetail.tsx`、`courses/CourseDetail.tsx`（公开页）、`MyCourses`：`teacherName` 单值处改为拼接 `teacherNames`。
- 章节编辑页 / 幻灯片页：保存带 `version`，409 走上面的冲突弹窗。

## 7. 验证与回滚

- **接口级验证脚本** `server/tools/verify-co-teachers.mjs`（打真实 API，不碰 UI）：
  1) 管理员把教师 B 加为课程协作者 → `GET /courses/:id/teachers` 含 2 人（A 主、B 协）；
  2) **B 能编辑章节**（`POST /courses/:id/chapters` 200）与**保存幻灯片**（200）；
  3) **B 不能**删课 / 发布 / 转让 / 改协作者名单（403）；
  4) B 保存章节后 `version` +1；用过期 `version` 再存 → **409** 且 body 含 `updatedBy`；
  5) 主教师转让给 B：`teacherId` 变 B、B 仍是成员、A **保留为协作者**。
- **回归**：`web/tools/verify-course-pages.mjs`（多教师卡片显示）、`verify-chapter-slides.mjs`、`assert-semantic.mjs`。
- **部署**：`npm run migration:run`（先备份库）→ `npm run build` → 重启 systemd → 前端 `deploy/deploy-web-lab.sh`。
- **回滚**：`down` 迁移可退回单教师（`courses.teacherId` 全程未动）；前端产物按 `deploy` 脚本的备份目录换回 `index.html`。
