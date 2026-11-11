# 学生应用托管（第 20 章）· 平台方案设计

> 状态：**一期已实现（2026-11-11）** —— 数据模型、上传/发布/预览/反代、对话落库、教师管理页、
> 运行时镜像 `nju-lab-app-runtime:0.1.0` 都已完成并端到端跑通；二期（免登录分享 / 并发配额 / 成本看板）
> 见 §9。课程侧的设计与里程碑见 [`PLAN-2026-11-final-chapter-harness.md`](PLAN-2026-11-final-chapter-harness.md)。
>
> 关联：`nju-lab-craft.md`（系统设计总文档）、`DESIGN-2026-09-28-platform-workspace.md`（工作台反代，
> 本方案与它同构）、`PLAN-2026-10-experiment-roadmap.md`（前三个批次）。

## 1. 要解决的问题

第 20 章要求学生交出**一个能给别人用的智能体应用**：上传附件、生成报告、有前端、能改主题。
"能跑通"和"能交付"之间的差距全部落在平台侧：

| 学生需要 | 平台现状（改造前） | 本方案 |
|---|---|---|
| 应用能被别人打开 | 只有 dsh 工作台一条反代通道 | 新增**应用运行容器** + 后端反代 `HTTP` |
| 前端是学生自己改的 | 平台只能托管教师上传的图片/文件 | 托管 `web/` 静态产物（iframe 预览） |
| 老师能看到 / 管住 | 无"应用"概念 | 新增 `agent_apps` 与教师管理页（预览 / 对话记录 / 下架） |
| 发布后可分享 | 无 | 一期：教师可见 / 课程内可见；二期：免登录只读链接 |

## 2. 硬约束（与既有批次同一套）

| 约束 | 事实 | 对本设计的影响 |
|---|---|---|
| 无外网 | 容器在 `--internal` 网络（只放行模型 API 的 SNI） | 前端必须**零依赖**；容器内 `pip/npm install` 不可能成功 |
| 不改 nginx | 宿主 nginx 由运维维护，`/lab/api/` 与 `/lab/` 已是既有通道 | 所有应用流量走 `/lab/api/apps/...`，**不新增 location** |
| 不用宿主端口 | `--internal` 下 `-p` 静默失效（2026-09-28 实测） | 反代走**容器 IP**（与工作台一致） |
| 镜像只读 + 预装集固定 | `nju-lab-verify:0.2.0-rc.2-pkg8` | 运行时镜像 `FROM` 它，学生代码只写 `/work` |
| 判据只认 `output.json` | 复验驱动只看产出文件 | 应用能否跑**不进自动判分**；判据只判交付物字段（`app.web_sha256` 等） |

## 3. 总体架构

```
浏览器
  ├─ /lab/student/apps          我的应用（学生）
  ├─ /lab/teacher/apps          学生应用（教师）
  └─ /lab/api/apps/<id>/site    iframe 预览（HTML/CSS/JS）
        │
        ▼
NestJS（/lab/api → 127.0.0.1:3100）
  ├─ apps 模块：CRUD / 上传 / 发布 / 对话落库 / 权限
  ├─ AgentAppRuntime：按需起容器、空闲回收、并发上限
  └─ 反代：site（静态） + api/chat（对话）
        │  docker（容器 IP，--internal 网络）
        ▼
nju-lab-app-runtime 容器（每应用一个，USER 1000，512m/0.3cpu）
  ├─ /pkg/app.zip        ← 只读挂载：学生的产物（app.json + harness/ + web/）
  ├─ /work/app           ← 容器内解包（entrypoint.sh）
  ├─ /work/data          ← 会话/上传（随容器回收）
  └─ app_host.py（教师提供，学生不改）：静态页 + multipart + 会话 + 调 core
```

## 4. 数据模型（`agent_apps` / `agent_app_versions` / `agent_app_messages`）

| 表 | 关键字段 | 说明 |
|---|---|---|
| `agent_apps` | `studentId` / `courseId` / `title` / `scenario` / `entry` / `theme` / `attachments` / `visibility` / `status` / `latestVersionId` / `shareKey` | 应用本体。`visibility` = `owner \| teacher \| course`；`status` = `draft \| published \| archived` |
| `agent_app_versions` | `appId` / `bundlePath` / `sha256` / `size` | **只增不改**；回滚 = 切 `latestVersionId` |
| `agent_app_messages` | `appId` / `sessionId` / `role` / `content` | 教师复盘与答疑用；内容截断到 4000 字 |

- 迁移：`server/src/migrations/1791300000000-AgentApps.ts`（`up` 只建表，`down` 只删表）；
- 产物落盘：`<AGENT_APP_DATA_DIR>/<appId>/<versionId>.zip`；默认
  `/data/workspaces/agent-apps`（`/data` 属 root，建子目录要 sudo，而部署沙箱不允许）；
- **不删数据**：下架只改 `status` 并清 `shareKey`，容器停掉，产物与对话都留着。

## 5. API 契约（全部在 `/lab/api` 下，未新增 nginx location）

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| POST | `/apps` | 学生/教师 | 新建（`title` / `scenario` / `courseId?`） |
| GET | `/apps/mine` | 学生/教师 | 我的应用列表 |
| GET | `/apps/:id` | 作者 / 教师 / 课程内可见 | 详情 |
| PATCH | `/apps/:id` | 作者 / 教师 | 改标题、场景、可见性、主题等 |
| POST | `/apps/:id/versions` | 作者 | 上传产物 zip（`multipart`，字段 `file`） |
| POST | `/apps/:id/publish` / `unpublish` | 作者 / 教师 | 发布（生成 `shareKey`）/ 下架（清 `shareKey`、停容器） |
| POST | `/apps/:id/start` | 作者 / 教师 | 起（或复用）容器，返回 `upstream` |
| GET | `/apps/:id/site[/:file]` | 作者 / 教师 / 课程内可见 | 静态前端；HTML 注入 `<base>` 与 `window.__APP_API_BASE__` |
| POST | `/apps/:id/api/chat` | 同上 | 对话（JSON + 附件 base64 → 后端转 multipart） |
| GET | `/apps/:id/messages` | 同上 | 对话记录（教师复盘） |
| GET | `/courses/:courseId/apps` | 教师 | 按课程看学生应用 |

## 6. 运行时（`server/apps-image/`）

- 镜像：`FROM nju-lab-verify:0.2.0-rc.2-pkg8` + `entrypoint.sh`（**复用复验/工作台同一套 python 与预装集**）；
- `entrypoint.sh`：`unzip /pkg/app.zip -d /work/app` → `python3 app_host.py`；
  兼容"zip 里多包一层目录"的产物（找含 `app.json` 的那层做根）；
- 容器：`USER 1000`、`512m` / `0.3cpu`、`--internal` 网络、**只挂 zip（只读）**，
  不挂宿主任何目录 —— 学生代码碰不到平台文件；
- **视觉/模型出网**：`--internal` 网络里 DNS 全失败，白名单域名要钉到 SNI 代理 IP
  （`egressProxyIp = runtime.ensureEgressProxy()`），否则图片视觉抽取报
  `Temporary failure in name resolution`；模型 key 用 `-e DEEPSEEK_API_KEY`（**只写变量名**）透传，
  与工作台同一条路径（2026-11-11 实测：缺 key 报「环境里没有 DEEPSEEK_API_KEY」，缺 add-host 报 DNS 失败）；
- **HTTP 就绪探测**：容器拿到 IP 只要几百毫秒，但 `entrypoint.sh` 还要 unzip + 起 python；
  转发前必须探测 `/api/health`（最多约 20 秒），否则第一次对话就是 `fetch failed`；
- 生命周期：`AgentAppRuntime`（内存会话表）按需起、空闲 **15 分钟**回收、全局并发 **10**；
  后端重启时按 label 收掉遗留容器（产物不丢，随时可重建）；
- **容器里没有大模型 key**：题目给的 case 用 `plan_stub.json`；真模型要走平台代理（二期）。
  例外是**图片**：视觉抽取需要模型（`deepseek-flash` 支持 `image_url`），一期用工作台/复验同一条
  `DEEPSEEK_API_KEY` 透传路径，二期改成平台代理并计费。

## 7. 前端

- 学生「我的应用」：新建 → 上传产物 → 发布 → 预览（iframe）；
- 教师「学生应用」：按课程列表 → 预览 / 对话记录 / 下架 / 恢复发布；
- iframe 源是 `/lab/api/apps/<id>/site`：后端把 HTML 注入 `<base>` 与 `window.__APP_API_BASE__`，
  于是学生写的相对路径（`./theme.css`）与 `fetch('/api/chat')` 都能在平台前缀下工作，
  **学生代码不需要知道部署在哪个子路径**。

## 8. 安全与隐私

| 面 | 现状 | 说明 |
|---|---|---|
| 学生代码执行 | 容器内、非 root、只读镜像、只挂自己的 zip | 与工作台同一套隔离；不 `--privileged` |
| 越权看应用 | `assertCanRead`：作者 / 教师 / 课程内可见 | 一期教师可读全部课程的应用（教师人少） |
| 对话记录 | 落库，教师可读 | **需要在课程说明里告知学生**（教学复盘用途）；二期加"学生可关闭记录" |
| iframe | 同源 + 注入 base | 未加 `sandbox`（学生页面要 fetch 平台 API）；二期改成独立源 + `sandbox` |
| 产物校验 | 只接受 `zip`、≤30MB | 解包在容器内完成，宿主不解压（zip-slip 影响不到宿主） |
| LLM 额度 | 一期不注入 key | 二期走平台代理 + 每会话 token 上限 |

## 9. 两期计划

**一期（已实现）**：数据模型 / 上传发布 / 运行时 / 反代 / 对话落库 / 学生与教师页面。

**二期（2026-11-11 已实现）**：
1. ✅ **免登录分享**：`GET /api/apps/share/:key` + `/site` + `/api/chat`（`@Public`）——
   只有「已发布 + 有 `shareKey`」可匿名访问，下架即失效；匿名侧只给 title/scenario/theme/附件类型，
   **不暴露学生与课程归属**；
2. ✅ **限流与排队**：登录通道每应用 **60 次/分**、分享链接 **20 次/分**（超了返回 **429**）；
   容器并发超上限时**先排队最多 15 秒**（期间触发一次空闲回收），仍满才 503；
3. ✅ **多版本与回滚**：`GET /apps/:id/versions` + `POST /apps/:id/versions/:vid/activate`
   （只切 `latestVersionId` 并停容器，下次预览用新版本重建）；
4. ✅ **评分**：新表 `agent_app_reviews`，教师按「总分 + 评语」打分（学生端「我的应用」直接能看到）；
   参考口径：托管可用 30 / 前端体验 20 / 分享与权限 10 / 场景完成度 30 / 演示答辩 10；
5. ✅ **删除应用**：`DELETE /apps/:id`（作者或教师）—— 停容器 + 删四张表 + 删落盘产物；
   与"下架"分工明确：下架保留数据、分享链接失效；删除不可恢复；
6. ✅ **前端补齐**：学生页（可见性下拉 / 分享链接复制 / 版本回滚 / 评分列 / 删除）；
   教师页（可见性 / 版本回滚 / 评分 / 下架）。

**三期（待做）**：
- **LLM 平台代理**：容器内 `APP_LLM_BASE_URL` 指向平台 `/api/apps/llm/chat`，平台统一计费与审计
  （当前是 key 透传 + egress add-host，可用但不计费；这是下一件最该做的事）；
- **成本看板**：按应用/学生汇总视觉调用与 token；
- **评分进成绩单**：把 `agent_app_reviews` 汇总进现有 `submissions`/`Grading`；
- **iframe 独立源**：学生页面放 `{key}.app.example.com` 并加 `sandbox`（需要 nginx + 证书）。

## 10. 已知限制与回滚

- **一期没有删除接口**：应用只能下架（数据保留）。清理测试数据要手工删三张表；
- **教师可见全部课程的应用**：教师变多时要按课程教师名单收窄（复用 `course_teachers`）；
- **容器冷启动 30–60 秒**：预览页有"正在启动"提示；二期可预热；
- **回滚**：`AGENT_APP_IMAGE=nju-lab-verify:...` 不动；要完全关掉就 `AGENT_APP_MAX_TOTAL=0`
  （起容器直接 503）+ 前端隐藏菜单；数据库三张表留着不影响其他模块。
