# 需求：文件上传/下载与提交链路接线（2026-09-21）

> 写给实现 agent（nju-lab-client 插件侧）。服务端（server/）与 Web 端（web/）已完成并由主对话 curl 实测通过；本文件是唯一契约依据。**联调纪律：以 curl 实测为准，不要凭想象写字段名。**
>
> 测试环境：平台 `https://lab.xiaohe.biz`（或本地 `http://127.0.0.1:3100/api`）；账号 `student1/student123`、`teacher/teacher123`。示例项目已绑定真实模板与数据集文件，student1 的任务已重置为 `pending`，可直接联调。

## 0. 服务端已完成的事实（curl 实测）

### 0.1 文件 API

```
POST /api/files        # 登录即可（教师/学生/管理员），multipart，字段名 file，单文件上限 100MB
→ 200 { code:0, data: { fileId, url, originalName, size, sha256 } }
# sha256 是服务端计算的权威值；url 形如 /api/files/<fileId>

GET  /api/files/:id    # 登录即可，二进制流（Content-Disposition: attachment）
# 未登录 401。文件 id 为不可猜测 UUID，当前充当能力凭证（细粒度鉴权留待生产化）
```

### 0.2 项目实体与领取

- `skillTemplateRef` / `testDatasetRef` 字符串引用**已删除**，替换为 `skillTemplateFileId` / `testDatasetFileId`（关联 files）。
- `POST /api/assignments/:id/claim` 响应**已变**（旧客户端的 `templateUrl`/`datasetUrl` 不再存在）：

```json
{
  "code": 0,
  "data": {
    "assignment": { "id": "...", "status": "claimed", "...": "..." },
    "skillTemplate": { "fileId": "...", "url": "/api/files/...", "originalName": "template.zip", "size": 35, "sha256": "..." },
    "testDataset":   { "...": "同上结构或 null" },
    "evalConfig": { "model": "deepseek-chat", "reasoningEffort": "medium", "tools": ["shell","fs"], "timeoutSeconds": 600 }
  }
}
```

- `GET /api/projects/:id`：教师端恒带 `skillTemplate`/`testDataset` 文件信息；学生端仅**已领取后**才带。

### 0.3 提交

`POST /api/assignments/:id/submit` 现在有两种模式（**推荐 fileId 模式**）：

```json
// fileId 模式（新，推荐）：先各自 POST /api/files 上传，再提交
{ "skillZipFileId": "<uuid>", "capsuleFileId": "<uuid>",
  "auditEvents": [...], "fileHashes": { "SKILL.md": "<sha256>", "...": "..." } }

// 直填模式（旧契约保留兼容）
{ "skillZipRef": "s3://...", "skillZipSha256": "<64hex>", "capsuleRef": "...", "capsuleSha256": "<64hex>" }
```

服务端行为（均已实测）：

- fileId 模式：文件**必须是本人上传**，否则 403；sha256 以服务端存储值为准写库（`skillZipRef` 记为 `file:<id>`）；若客户端同时自报 `skillZipSha256` 且不匹配 → 400。
- 两个提交物都缺失 → 400；重复提交（当前提交非 failed 状态）→ 400。

## 1. 插件侧需求

### 1.0 Skill 目录探测约定（三处一致，务必遵守）

模板 ZIP 与学生提交的 ZIP 都**允许包一层顶层目录**（如 `csv-cleaner/SKILL.md`），消费方必须统一做"剥离唯一顶层目录"探测：

```
resolveSkillRoot(dir):
  若 dir/SKILL.md 存在 → dir 即 Skill 根
  否则若 dir 下只有一个子目录且该子目录含 SKILL.md → 该子目录为 Skill 根
  否则 → 报错（找不到 SKILL.md）
```

适用三处：

1. **claim 解压模板后**：工作区 `skill/` 下可能是 `skill/csv-cleaner/SKILL.md`，须把真正的 Skill 根告诉学生/模型（或在解压时直接剥平）
2. **submit 自检与打包**：自检"是否有 SKILL.md"必须先经 `resolveSkillRoot`；打包时以探测到的 Skill 根为准（学生 ZIP 保持"单层顶层目录"风格，与 `csv-cleaner/references/checklist.md` 的约定一致）
3. **服务端复验容器**（后续 EvaluationRunner 实现时照此办理，与插件保持同一语义）

### 1.1 token 获取（平台侧已完成，插件侧只剩配置入口）

平台已实现 **D-lite+ 方案**（2026-09-21，curl 实测）：

- `POST /api/me/tokens`（登录态调用）→ `{ accessToken }`，**365 天长期 token**，JWT payload 带 `ver`（= 用户 tokenVersion）
- `POST /api/me/tokens/revoke` → tokenVersion + 1，该用户**全部**已签发 token（含 Web 登录态）立即 401
- Web 端已加入口：右上角头像菜单 →「API Token」弹窗 → 生成/复制/全部吊销

插件侧要做的事**不变且更小了**：用 DSH settings 服务把 `serverUrl` + `token` 注册为设置页可填项，引导学生到 Web 平台「API Token」弹窗复制 token 粘贴即可。不需要 `nju_lab_login` 工具了（如仍想做账号密码换 token，字段是 `accessToken` 不是 token）。

验收：任意 nju_lab_* 工具调用不再 401。

### 1.2 PlatformApi 更新（`src/host/api.ts`）

- `myAssignments()`：对齐真实响应。实际形状是 `{ id, status, claimedAt, unlocked, project: { id, title, deadline, chapterTitle }, submission: { id, status, submittedAt } | null }[]`——当前 `Assignment` 接口里的 `projectId`/`unlockHint` 与事实不符，需修正。
- `claim()`：返回类型改为 0.2 节的新结构（`skillTemplate`/`testDataset` 文件信息对象）。
- 新增 `uploadFile(path: string): Promise<StoredFileInfo>`：读本地文件 → multipart POST `/api/files`（Node 22 的 fetch 支持 `FormData` + `Blob`，构造 `new FormData(); form.append('file', new Blob([buf]), filename)`）。
- 新增 `downloadFile(info: StoredFileInfo, destPath: string)`：GET `/api/files/:id`（带 Authorization）→ 写盘 → **重算 sha256 与 info.sha256 比对，不一致抛错**。

### 1.3 `nju_lab_claim` 工具（`src/host/tools.ts`）

- claim 成功后：把模板 ZIP 与数据集**真实下载**到工作区（建议 `nju-lab/<assignmentId>/` 下），校验 sha256，模板 ZIP 解压为 Skill 目录骨架。
- evalConfig 映射：server 字段为 `model/reasoningEffort/tools/timeoutSeconds`。**模型与 effort 的权威事实（2026-09-21 对官方 API 实测）**：可用模型 `deepseek-flash` / `deepseek-v4-pro`；`reasoning_effort` 合法值 `none|minimal|low|medium|high|xhigh|max`。⚠️ DSH 层面注意：`agent/request` waterfall 钉 `reasoningEffort` 会被 dsh-llm-deepseek 拒绝（UNSUPPORTED_REASONING_EFFORT）——effort 只能通过 profile config 层生效（复验容器就是这么做的），插件不要钉它；插件 `EvalConfig` 类型里的 `'off'|'low'|'high'|'max'` 枚举与事实不符，需修正。`agent/request` 只能钉 provider/model/reasoningEffort/maxTokens；**`tools` 白名单要用 `ctx.tools.restrict()` 实现**；`timeoutSeconds` 无法钉，记录到面板展示即可。
- 回复文案改成真实路径（不再打印 templateUrl/datasetUrl）。
- **补记（2026-09-21）**：claim 下发的 `evalConfig` 必须**跨进程持久化** —— DSH 每次启动都是新进程（headless 每条任务一个进程），只存闭包会丢条件、工具面会在重启后重新放开，等于"学生自测条件 ≠ 复验条件"。实现：claim 时写 `<workspace>/nju-lab/pinned-eval-config.json`，`apply()` 启动时读回（**优先于配置里的默认值**），平台本次未下发条件时清掉旧值。见 `src/host/eval-state.ts`；测试 `test/eval-state.test.mjs` + L2「重启 DSH 后评估条件仍被钉定」（两趟独立进程）。

### 1.4 新增 `nju_lab_submit` 工具

参数建议：`{ assignmentId: string, skillDir: string, note?: string }`。流程：

1. 遍历 `skillDir` 逐文件算 sha256 → `fileHashes`（相对路径 → sha256，真实生成）。
2. 打包 `skillDir` 为 ZIP（纯 JS 实现，排除 `node_modules`/`.git`），整体 sha256。
3. `buildCapsule()` 生成 `.dshc` 证据包。**已真实化（2026-09-21）**：见 `src/host/evidence.ts` —— 经 `ctx.sessionPersistence` 导出本工作目录下各会话的事件，筛 `approval/`、`permission/` 前缀并递归脱敏，产出 `nju-lab.capsule/v1`（`sessions` + `auditEvents` + sha256 `integrity`）；采集失败只记 `note`，**不阻断提交**。
4. 两个文件分别 `uploadFile()`，然后 `submit(assignmentId, { skillZipFileId, capsuleFileId, auditEvents, fileHashes })`。
5. 返回服务端 submission 的关键信息（id、status、两个 sha256）。

### 1.5 ClaimPanel（`src/client/ClaimPanel.tsx`）

从占位变真实面板：拉取任务列表（状态/解锁提示/截止时间）、领取按钮、提交按钮、显示当前 evalConfig 钉定状态。slot 组件拿不到 ctx——数据桥接方式按插件现有结构自行决定（如 host 半起本地回调或经 cordis 服务）。

## 2. 端到端验收标准

1. 学生 DSH 内 `nju_lab_list_assignments` 不再 401，能列出示例任务（含 `[unlocked]`）。
2. `nju_lab_claim` 后本地出现模板 Skill 目录与数据集文件，sha256 与平台一致；后续模型请求的 model/reasoningEffort 被钉死，工具集被 restrict。
3. 改一改 Skill → `nju_lab_submit` → 数据库 `submissions` 行 `skillZipRef=file:<id>`、sha256 与本地 ZIP 一致。
4. Web 教师端对该提交触发复验（当前 Mock）→ 批改 → 学生端可见反馈。

## 3. 不在本次范围

- ~~证据包 `.dshc` 真实化（接 dsh-session-persistence，审计事件自动提取）~~ **已完成（2026-09-21）**：实现见 `src/host/evidence.ts`，L2 用例 `test/dsh-e2e.test.mjs`「submit 把本会话的审计证据导出进 .dshc」在真 DSH 下通过（实测 17 个会话事件 → `permission/preset`、`approval/policy` 两条审计事件，无降级）。
- 真实容器复验（EvaluationRunner）——服务端需求，与插件无关。
- ~~profile 内 skill / system prompt 引导~~ **已完成（2026-09-21）**：见 `src/host/guidance.ts`（常驻 system prompt 段 + `ctx.skills.register()` 注册的 `nju-lab-experiment` skill），L2 用例 `test/dsh-e2e.test.mjs`「引导与 skill 到达模型」在真 DSH 下通过。
