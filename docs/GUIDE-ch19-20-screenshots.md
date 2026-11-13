# 第 19 / 20 章 图文引导 · 截图清单（给老师用）

> 用途：把学生最容易迷路的地方用**截图**讲清楚，插到实验页的 `content` / `description` / `faq`。
> 现状（2026-11-13）：**已截图 → 已上传平台 → 已插入两个实验项目**，学生打开实验页就能看到；
> 图在正文列里会被缩到 ~760px 宽，所以 MarkdownView 加了**点图放大**（`cursor: zoom-in` + Modal）。
> 原图留在 `docs/assets/ch19-20/`（重截/换图时用），线上走平台文件（`file:<fileId>`）。
> 下面保留"截在哪 / 要看到什么"的口径，便于以后页面改版时**重截**（脚本思路：playwright-core +
> `chromium_headless_shell` 的 executablePath，登录一次性学生账号或教师账号，逐页 screenshot）。
>
> 截图约定：**1920×1080 或 1440×900**，只截相关区域，文件名按下面编号；
> 存到 `docs/assets/ch19-20/`（**不要**放进 `web/public`，避免进构建产物）。
>
> ⚠️ 2026-11-13 口径已变，**旧清单作废**：第 19 章是「构建通用 agent」，第 20 章是「用 agent 做真实应用」，
> **应用 = Skill**（不是 agent）；学生不再跑 `publish_app.py`，改成「用我的 Skill 创建应用」点一下。

## 第 19 章（构建通用 agent）· 5 张

| # | 文件名 | 在哪截 | 要让人看到什么 | 配的一句话 |
|---|---|---|---|---|
| 1 | `19-01-project.png` | 章节页 → 第 19 章实验详情 | 标题「构建一个通用 agent」+ 「两个不同领域样例」表（图书借阅 / 设备维护） | 「这章做的是运行时，不是某个业务助手」 |
| 2 | `19-02-materials.png` | 同一页「实验材料」 | 两个下载按钮 + 「在平台实验环境里完成」 | 「材料在这里下，做在左侧『实验环境』」 |
| 3 | `19-03-skills-dir.png` | 工作台输入框里打 `@SKILL`（Files & folders 面板） | `problem/cases/case01` 与 `case02` 各有 `skills/maintenance`、`skills/summary-report` 两份 `SKILL.md`（路径也显示在右列） | 「agent 要按 triggers 选对 skill，选不中就返回 null」 |
| 4 | `19-04-agent-profile.png` | 工作台打开 `agent/profile.json` | 中性模版（名字 / 语气 / 签名 / 禁语） | 「这份是 agent 的定制，不是应用」 |
| 5 | `19-05-output.png` | 工作台跑完样例后的 `output.json` | `answers[].skill` 与 `metrics.skills_routed` | 「每轮用了哪个 skill，都记在产出里」 |

> 3 已截并插入（2026-11-13，起一次工作台容器截的）；4–5（`profile.json` / `output.json`）还没截 ——
> 同样是起容器后在 `@` 面板里找文件，按下面「换图 / 补图流程」3 步补。

## 第 20 章（用 agent 做真实应用）· 7 张

| # | 文件名 | 在哪截 | 要让人看到什么 | 配的一句话 |
|---|---|---|---|---|
| 1 | `20-01-needs.png` | 第 20 章实验详情首屏 | 「两个需求（A 实验数据→报告 / B 随访·用药提醒）」+ 「应用 = Skill」对照表 | 「数据你自己准备，产出你自己定」 |
| 2 | `20-02-my-apps.png` | 左侧「我的应用」 | 顶部两个按钮：**用我的 Skill 创建应用** / 新建空应用 | 「主路径是左边那个按钮」 |
| 3 | `20-03-skill-submissions.png` | 点「用我的 Skill 创建应用」 | 弹窗里的提交列表（选一次提交） | 「平台会把你提交的 Skill 装成应用」 |
| 4 | `20-04-created.png` | 生成成功后 | 提示「应用已生成并发布」+ 应用地址 | 「不用打包、不用命令行」 |
| 5 | `20-05-share-link.png` | 列表里点「分享链接」 | 已复制提示 / 链接弹窗 | 「发给别人，不登录也能打开」 |
| 6 | `20-06-preview.png` | 点「预览」 | 应用页面（对话区 + 报告区 + 签名） | 「签名就是你在 profile.json 里做的定制」 |
| 7 | `20-07-teacher-apps.png` | 教师端「学生应用」 | 列表 + 「预览 / 对话记录 / 版本 / 评分」 | 「老师在这里看、评、下架」 |

## 已截的补充图

| # | 文件名 | 内容 |
|---|---|---|
| 8 | `20-08-conversation.png` | 带附件的对话：报告四节 + 异常值提示 + 签名（说明"传上去就能用"） |

## 还没截（有容器/有对话就能补）

| # | 文件名 | 内容 |
|---|---|---|
| 4 | `19-04-agent-profile.png` | 工作台打开 `agent/profile.json`（名字 / 语气 / 签名 / 禁语） |
| 5 | `19-05-output.png` | 跑完样例后的 `output.json`：`answers[].skill` 与 `metrics.skills_routed` |
| 9 | `20-09-refusal.png` | 问「直接告诉我是不是 XX 病」时被拒答的样子（说明边界真的生效） |
| 10 | `20-10-vision.png` | 一张截图附件与它被**视觉**读出来的几行（说明图片不用自己 OCR） |

## 工作台内部的图怎么截（可复现，2026-11-13 实测）

1. 注册一次性学生 → 教师 `POST /lab/api/courses/<courseId>/enrollments {"studentIds":[id]}` →
   学生 `POST /lab/api/workspace/start`，轮询 `/workspace/status` 到 `running`。
2. 把题目包解压进该学生的挂载目录（工作台工作区 = `/home/ubuntu`，宿主对应
   `/data/workspaces/<userId>/`）：`unzip -q problem.zip -d /data/workspaces/<userId>/problem`。
   不做这一步，工作台里看不到 `problem/`（真实学生是让 agent 调 `nju_lab_claim` 领的）。
3. playwright：`--host-resolver-rules=MAP medai.nju.edu.cn 127.0.0.1`，登录后进
   `/lab/student/workspace` → 点「进入实验环境」→ 点掉 `Preview Notice` 的 `Continue` →
   在输入框里打 `@` + 关键字（如 `@SKILL`）唤出 **Files & folders** 面板。
4. 截图用 `deviceScaleFactor: 2` + `clip`（只留左侧栏与文件面板）—— 1 倍密度缩到 758px 宽会糊。
5. 收尾：`POST /workspace/stop`（停容器）→ 删 `users`/`enrollments` 行 →
   `rm -rf /data/workspaces/<userId>`。

> 已知小瑕疵：`/wsbridge/client.js` 会 403（网关不透传 WS 时的桥），不影响页面与文件面板。

## 已插入的位置（2026-11-13）

- **19 章**（项目 `a9c69502-…`）：`content` 末尾新增「页面长什么样（照着点）」—— 三步：
  ① `19-01`（首屏两样例表）② `19-02`（材料卡"在这里下、在左侧实验环境里做"）
  ③ `19-03`（进工作台后按 `@` 搜 skills：两个样例各两个 `SKILL.md`，`triggers` 写在里面）。
  第 ③ 张按 2 倍像素密度截（`deviceScaleFactor: 2`）+ 只裁「左侧栏 + 文件面板」，
  避开右侧「NJU-Lab 实验任务」面板（那里显示"没有分配给你的任务"，学生未领取时会误读）。
- **20 章**（项目 `28ba4aaf-…`）：
  - `content`「为什么应用 = Skill」节末 → `20-01`（首屏两需求 + 对照表）；
  - `description`「建议步骤」下方 → 新增「照着点一遍（主路径不用命令行、不用打包）」六步，
    依次 `20-02` → `20-03` → `20-04` → `20-05` → `20-06` → `20-08`；
  - `faq` 新增第 6 条「老师在哪看我的应用、怎么评？」→ `20-07`。

线上 fileId（重装/换库后要重传，见下节）：

| 文件 | fileId |
|---|---|
| `19-01-project.png` | `f4416eb8-f7c1-41d2-896f-0b39b3995278` |
| `19-02-materials.png` | `f3b1c632-e206-476a-990b-63b1d2a3e711` |
| `19-03-skills-dir.png` | `ff66884f-6ee3-4aa7-bd82-8644681fb890` |
| `20-01-needs.png` | `22fb5878-8d6f-445e-9dfe-252483a9eb4e` |
| `20-02-my-apps.png` | `a4b5a414-13d9-48a9-bf70-f0a7638e916c` |
| `20-03-skill-submissions.png` | `22eec4c6-2b27-430a-9ad8-8543e9850e99` |
| `20-04-created.png` | `eafe5758-d5cc-488e-b91a-6ce4ba127ff2` |
| `20-05-share-link.png` | `ba8924a6-ba52-44cf-a22c-3ac188b395c2` |
| `20-06-preview.png` | `d5f63330-dafa-4b6c-bc0b-b8fb2e0e3acc` |
| `20-07-teacher-apps.png` | `1965427c-e6cf-49f5-80e4-460f01ce40e4` |
| `20-08-conversation.png` | `9da247b3-8e54-4437-8210-e6c83163f041` |

## 用 Markdown 插入（唯一可行写法）

```markdown
![第 20 章实验详情首屏：两个需求 + 「应用 = Skill」对照表](file:22fb5878-8d6f-445e-9dfe-252483a9eb4e)
```

- 平台 Markdown 渲染器（`web/src/components/MarkdownView.tsx`）把 `file:<uuid>` 换成
  `data-file-ref`，再由父页面**带 JWT** 取回文件、补成 data URL 显示 —— 章节正文、实验页、教师端预览都走这条管线。
- **不要**写 `/lab/api/files/<id>`：`GET /api/files/:id` 要登录态，`<img src>` 不带头 → **401**
  （这条 2026-11-13 实测确认，旧版本文档里的写法是错的）。
- **不要**把图放 `/var/www/lab/...` 手写路径：前端重新部署后要另记一份手工资产，且换环境就失效。
- 学生端"看图"体验：图在正文列里最宽 ~760px，1440×900 的整页截图会被缩小 ——
  `MarkdownView` 已支持**点图放大**（Modal 显示原图，关闭用 Esc / 右上 ×），图片有 `title="点击放大"`、
  光标是 `zoom-in`。

## 换图 / 补图流程（3 步）

1. 截图存 `docs/assets/ch19-20/<编号>.png`（覆盖同名文件即可）；
2. 教师账号上传，拿 `fileId`：

   ```bash
   TOKEN=$(curl -s http://127.0.0.1:3100/api/auth/login -X POST -H 'Content-Type: application/json' \
     -d '{"username":"teacher","password":"teacher123"}' | jq -r .data.accessToken)
   curl -s -H "Authorization: Bearer $TOKEN" -F "file=@docs/assets/ch19-20/xxx.png" \
     http://127.0.0.1:3100/api/files        # → data.fileId
   ```

3. 改项目字段（`PATCH /api/projects/:id`，**必须带 `Content-Type: application/json`**，否则接口 200 但什么都没改）：

   ```bash
   curl -s -X PATCH -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
     http://127.0.0.1:3100/api/projects/28ba4aaf-25cc-4217-bc01-459aade1cd0a \
     -d '{"description":"<新全文，含 ![说明](file:<新 fileId>)>"}'
   ```

   字段是**整段覆盖**：改之前先 `GET /api/projects/<id>` 取回原文再替换，别只提交增量。
4. 验证：学生账号打开 `/lab/student/projects/<id>`，用 headless-shell 查
   `.markdown-view img` 的 `naturalWidth > 0`（= data URL 取回成功）再截一张图确认排版。
