# nju-lab-client

NJU-Lab 的**定制 DSH 客户端插件**（host 半 + client 半）。

- **host 半**（Node，`src/host/`）：平台 API 客户端（含上传/下载）、`agent/request` 评估条件锁定、三个平台工具、ClaimPanel 的 HTTP 路由、证据采集（`.dshc` 证据包：会话审计事件导出 + 脱敏 + 完整性哈希）、模型引导（system prompt 段 + `nju-lab-experiment` skill）。
- **client 半**（浏览器，`src/client/`）：右侧栏的任务面板（列表 / 领取 / 提交 / 显示钉定条件）。

## 结构

```
nju-lab-client/
  package.json        # 声明 dsh.bundle（host）+ dsh.client（client 半）+ exports
  cordis.patch.yml    # bundle patch：从空条目插入 host 半（serverUrl / token 取自环境变量）
  tsdown.config.ts    # host / client 分别打包（client 半 external 掉 react）
  src/host/           # Node 面
    index.ts          # export name / inject / apply(ctx, config)
    config.ts         # schemastery Config —— 同时就是设置页渲染的 schema
    api.ts            # 平台 API 客户端（契约对齐 server/src，含 uploadFile / downloadFile）
    actions.ts        # 业务核心：list / claim / submit（工具与面板路由共用这一份）
    tools.ts          # 对话式工具（渲染层：把 actions 的结果变成文本）
    panel.ts          # ClaimPanel 的 host 路由（挂在 Connection 的 /api 通道上）
    lock.ts           # agent/request 条件锁定（model + reasoningEffort）
    zip.ts            # 最小 ZIP 编解码（纯 JS，不调系统 zip/unzip）
    evidence.ts       # `.dshc` 证据包：从 sessionPersistence 导出会话 → 筛 approval/*、permission/* → 脱敏 → sha256 完整性
    eval-state.ts     # 评估条件跨进程持久化：claim 时写盘、启动时恢复（只存闭包的话重启就丢）
    guidance.ts       # 模型引导：常驻 system prompt 段 + runtime 注册的 `nju-lab-experiment` skill
  src/client/         # 浏览器面
    index.tsx         # 两阶段注册右侧栏 tab（type + body + title + guide）+ 自动打开 + 设置卡片注册
    ClaimPanel.tsx    # 任务面板：同源 fetch 取数，token 不进浏览器
    SettingsCard.tsx  # 设置页「NJU-Lab 平台」卡片（settingsScope 读写 serverUrl/token）
```

## 构建

```sh
npm install
npm run build      # → lib/host/index.js, lib/client/index.js
npm run typecheck  # host 与 client 两半都干净
```

## 测试

L2 需要一个 `dsh` 可执行文件（仓库不内置）。它按 `DSH_BIN` → `PATH` 的顺序查找，找不到会 **skip**（TAP 里是 `ok … # SKIP`，**不是**通过）。所以 L2 的结论必须带 `DSH_BIN` 跑；不带的话 61 条里那 6 条 L2 静默 skip，`npm test` 仍显示全绿。

```sh
npm test                                 # L1 + L2
DSH_BIN=/path/to/dsh npm test            # 追加真 DSH 端到端
DSH_BIN=/path/to/dsh npm run test:e2e    # 只跑 L2
```

没有 dsh 时先装一个，装完就在 PATH 上，之后的 `npm test` 会自动带上 L2：

```sh
npm i -g @deepseek-ai/dsh@0.1.5-rc.2
```

如果本机装过仓库里的 PoC（`dsh/verify-poc`，同一个锁定版本），那份也能直接用：
`DSH_BIN=$PWD/../verify-poc/node_modules/.bin/dsh npm test`。

- `test/mock-platform.mjs` — 平台替身：任务/领取/上传/下载/提交 5 个端点，强制 `Authorization: Bearer`。**契约以 `REQ-2026-09-21-submit-pipeline.md` §0 为准**（不要照 client 类型反推，那正是之前固化漂移的原因）。`claim` / `submit` 返回 **201**，与真实 NestJS 的裸 `@Post` 一致
- `test/fake-llm.mjs` — 假 OpenAI 兼容端点（SSE），让 L2 无需模型 key
- `test/host-tools.test.mjs` — L1：契约形状断言 + `list_assignments` / `claim` / `submit` + token 提示
- `test/host-panel.test.mjs` — L1：面板三条 host 路由（快照 / 领取 / 提交 / 错误路径）
- `test/skill-root.test.mjs` — L1：`resolveSkillRoot` 三态（§1.0）+ 纯 JS 打包（§1.4.2）
- `test/restrict.test.mjs` — L1：`evalConfig.tools` 能力名 → DSH 工具名的映射与 `restrict()` 生效路径
- `test/evidence.test.mjs` — L1：`.dshc` 只留 `approval/*`、`permission/*`、按 `cwd` 归属会话、超长字段截断、`integrity` 口径、无持久化时的降级
- `test/eval-state.test.mjs` — L1：评估条件的落盘 / 恢复 / 清理 / 损坏与形状不对时的容错；用"同一工作区第二次 `apply()`"模拟重启，断言条件回到新 agent 的工具面（`restrict` 收到 allow），并验证优先级（平台条件 > 配置默认）与回落
- `test/guidance.test.mjs` — L1：引导段的注册面（段名前缀、排序位、文字要点）与 skill 的合法性（kebab-case 名、描述 ≤ 目录渲染上限、`source` 必须是字符串）；以及缺 `systemPrompt` / `skills` 时的软依赖行为与卸载撤销
- `test/dsh-e2e.test.mjs` — L2（6 条）：真跑 `dsh --profile headless`，断言工具进入模型工具面、`restrict` 收窄生效、claim 之后同一会话即受约束、`.dshc` 采到本会话的审计事件、引导与 skill **真的到达模型**（system prompt 段 + skill 目录 + `skill` 工具加载正文）、**重启进程后条件仍被钉定**

## 学生如何使用

学生并不直接“调用”这个插件：学生启动的是 DSH，插件随 profile 挂进去，为 DSH 增加一个右侧栏面板、三个平台工具，以及一段常驻引导 + 一个 `nju-lab-experiment` skill（所以模型知道什么时候该领任务、什么时候可以交）。

```sh
# 一次性安装（详见 ../profiles/nju-lab-student/README.md）
dsh plugin --profile nju-lab-student install

# 每次使用
export NJU_LAB_SERVER_URL='https://lab.xiaohe.biz/api'
export NJU_LAB_TOKEN='<平台个人页生成的长期 token>'
dsh --profile nju-lab-student --no-open
# → 浏览器打开 http://127.0.0.1:3080/?token=...
```

`token` 有两个来源，**设置页优先**：

1. **DSH 设置页**（推荐）：设置 → 插件 → `nju-lab`，填 `serverUrl` 与 `token`
   —— 那正是本插件的 `Config` schema，由 `ctx.settings.installSection` 暴露。改动**即时生效**，不必重启 DSH。
2. **环境变量**（上面的写法）：composition 层的默认值，适合脚本化 / 机房批量部署。

**未配置或已失效时，工具返回可读的修复指引，而不是裸 401。**

之后有两个入口，分别对应插件的两半：

### 1. 对话式工具调用（host 半）

学生说人话，由模型决定调用哪个工具。当前注册的工具：

| 工具 | 行为 | 平台 API |
| --- | --- | --- |
| `nju_lab_list_assignments` | 列出任务：解锁状态、章节、截止时间、最新提交 | `GET /me/assignments` |
| `nju_lab_claim` | 领取：**真实下载**模板与数据集到 `<会话工作区>/nju-lab/<id>/`、逐个校验 sha256、纯 JS 解压模板，并**探测真正的 Skill 根**（模板带顶层目录时是 `skill/csv-cleaner`）+ 钉死评估条件；claimed/submitted 幂等重发 | `POST /assignments/:id/claim`、`GET /files/:id` |
| `nju_lab_submit` | 提交前自检 → 逐文件 sha256 → 打包 ZIP → 生成 `.dshc` → 上传两者 → 以 fileId 模式提交 | `POST /files`、`POST /assignments/:id/submit` |

### 2. 右侧栏面板（client 半）

面板**不直接调平台**：host 半把数据与动作暴露成同源路由，面板用 `fetch` 调用。

| 路由 | 语义 |
| --- | --- |
| `GET /api/nju-lab.assignments` | 首屏快照：任务列表 + 当前钉定条件 + 落盘目录 + `tokenConfigured`（带 `?sessionId=` 时按会话工作区判定） |
| `POST /api/nju-lab.claim` | `{ assignmentId }` → 领取结果（落盘点、解压目录、evalConfig） |
| `POST /api/nju-lab.submit` | `{ assignmentId, skillDir?, note? }` → 提交结果 |

这样做的两个好处：**平台 token 永不进浏览器**；路由挂在 Connection 的 `/api` 共享通道上，自动继承它的 Host/Origin 围栏与浏览器认证，不用自己写鉴权。

### 3. 评估条件锁定

`nju_lab_claim` 成功后把 `evalConfig` 存入闭包。平台下发的真实字段是
`model / reasoningEffort / tools / timeoutSeconds`，其中：

- `model`、`reasoningEffort` 由 `agent/request` waterfall 在每次请求前覆盖
- `tools` 需要 `ctx.tools.restrict({ allow })`，**waterfall 管不了工具集**（实现见 `src/host/restrict.ts`）
- `timeoutSeconds` DSH 侧没有对应能力，仅作展示

**跨进程持久化（`src/host/eval-state.ts`）**：闭包只活一个进程，而 DSH 每次启动都是新进程（headless 更是每条任务一个进程）。学生 claim 完关掉 DSH 再打开，条件就丢了 —— 工具面重新放开，等于"自测条件 ≠ 复验条件"。所以 claim 成功后把条件写进**会话工作区**：

```
<会话工作区>/nju-lab/pinned-eval-config.json
{ "assignmentId": "...", "evalConfig": { ... }, "claimedAt": "..." }
```

**落盘根解析（2026-09-22 起）**：材料、钉定文件、提交默认目录、证据归属都跟随**会话工作区**（UI 里选的 workspace），而不是 dsh 进程启动目录 —— 学生常在 `~/Downloads` 之类的地方启动 dsh，项目语义却全在会话工作区上。解析顺序：显式 `workspaceDir` 配置 → 会话 cwd（工具经 `exec.agent.id`、面板经 `sessionId`，host 用 sessionPersistence 解析）→ 进程启动目录（兜底）。恢复也按此对齐：**agent 创建时按它自己的 cwd 找回 pinned 条件**并收窄工具面；启动时从进程目录的恢复只作兜底。

- **平台本次没下发条件时清掉旧值**，避免上一个实验的限制被"继承"过来（那是无故收窄，可能让学生做不下去）；
- 文件缺失静默跳过，损坏/形状不对只警告并忽略 —— 插件必须能在任何残留状态下正常启动；
- 载体选工作区文件而不是 DSH 的 `ctx.storage`（storage-json 落在 `$DSH_HOME/storages/<域>`，语义上是设备级存储）：条件本来就绑定"这个工作区里的这次实验"，与领取物同处、学生可见可删，也与 `.dshc` 按会话 `header.cwd` 归属项目的口径一致。

### 4. 模型引导（`src/host/guidance.ts`）

光有工具还不够 —— 模型得知道"什么时候该去平台上领任务、什么时候算改好了可以交"。两处引导：

- **常驻 system prompt 段**（`nju-lab:workflow`，order 1800，落在 DSH 内置工具说明段之后、persona suffix 之前）：一段短文字，点出三个工具的适用时机、Skill 根约定，并指向下面的 skill。它进**每一次**请求，所以刻意写短。
- **`nju-lab-experiment` skill**：详细操作手册（三步流程、工作区布局、常见报错、不要做的事）。用 `ctx.skills.register()` 做 **runtime 注册**，而不是往磁盘上放 `SKILL.md` —— 文件系统的 skill 发现根是 `<projectRoot>/.dsh/skills`、`$DSH_HOME/skills` 这类运行时才知道的位置（项目根还要按 `.git` 上溯），而学生的项目目录在 profile 之外；注册进注册表则随插件分发。

`dsh-tool-skill` 会在首次请求前把目录（名字 + 描述）发给模型，模型用 `skill` 工具按需加载全文；学生也可以直接输入 `/nju-lab-experiment` 调用。

两者都走 `ctx.inject` 软依赖：缺 `systemPrompt` 或 `skills` 时静默跳过，插件照常加载。

**为什么不用磁盘上的 `SKILL.md`（即"profile 内放文件"）**：DSH 的 skill 来源优先级是
`project-dsh 100 · project-agents 200 · runtime 250 · custom 300 · user-dsh 400 · user-agents 500 · bundled 600`（越小越优先，见 `dsh-skill/lib/index.js` 的 `RUNTIME_RANK` / `BUNDLED_SKILL_RANK`）。官方在 `dsh-skill` 的 README 里把
`ctx.skills.register()` 明确列为"**嵌入式 skill**"（插件自带数据）的用法，而 `dsh-skill-filesystem` 面向的是"skill 存在磁盘上"的场景。文件形态要额外满足：profile 目录不是默认发现根，得配 `customSkillDirs` / `bundledSkillDir`，且后者经 `resolve()` 按进程 cwd 解析（相对路径会走偏，只能绝对路径或 `!!js` 表达式）；而 profile 是拷到 `$DSH_HOME/profiles/<name>` 的副本，`dsh plugin install` 不管理散文件。runtime 注册零配置、优先级更高（250 > 400/600，只低于学生项目里的 `<projectRoot>/.dsh/skills`），且手册与插件同版本发布，不会出现"旧手册 + 新插件"。

实测结论（真 `dsh --profile headless`）：`bundledSkillDir` 这条路**可用**（配 `bundledSkillDir: !!js process.env.X` 后探针 skill 确实进了模型目录；注意 `!!js` 表达式不能以引号字面量开头，YAML 会解析失败）。我们没选它，只是因为上面那些代价；若将来手册改由教师频繁编辑、希望改完即生效（filesystem provider 有 watcher，无需 `npm run build` + 重装 profile），再切换即可 —— 切换时要同时删掉这里的 runtime 注册，避免两份手册漂移。

## 当前实现状态

| 能力 | 状态 |
| --- | --- |
| 构建 / host 半加载 | ✅ 已验证：`npm run build` 产出 `lib/`，`dsh --profile nju-lab-student` 启动出现 `[nju-lab-client] host half loaded` |
| client 半挂载 | ✅ Playwright 真实浏览器验证（2026-09-22）：CJS + `__ModuleLoader__.load` 外壳被模块系统接受；tab 两阶段注册（type + body + title）生效，`guide` 入口 + 轮询 `sidebarRight.openTab` 自动展开右栏并渲染 ClaimPanel；设置卡片经 `settingsScope` 写入落盘 `settings.yaml` |
| `nju_lab_list_assignments` | ✅ 已实现 |
| `nju_lab_claim` | ✅ 真实下载 + sha256 校验 + 解压；真实平台联调通过 |
| `nju_lab_submit` | ✅ 打包/哈希/上传/提交；真实平台联调后库里是 `skillZipRef=file:<id>` |
| Skill 根探测（REQ §1.0） | ✅ `resolveSkillRoot`：`<dir>/SKILL.md` → 唯一子目录含 `SKILL.md` → 报错。claim 与 submit 两处同语义；传 `skill/` 或 Skill 根本身都能提交 |
| 打包 / 解压 | ✅ 纯 JS（`src/host/zip.ts`：写 store、读 store + deflate），不依赖学生机器上的 `zip`/`unzip` |
| ClaimPanel | ✅ 列表 / 领取 / 提交 / 显示钉定条件；host 路由已在真 `dsh web` 上验证（`GET /api/nju-lab.assignments` → 200）。交互与状态对齐 host 半：未解锁/无 token/未领取时按钮禁用并给出原因（`title` 提示），已领取后领取按钮变「已领取」、提交按钮才可用；**云端 claimed 但本地无材料（换机/清理）时按钮变「重新下载」**——平台对 claimed 任务的 claim 幂等重发材料，快照新增 `downloaded`（本地已落盘的任务 id）供面板判断；动作结果渲染成可关闭的成功/失败横幅，并摊开落盘目录、每个下载物（名称/大小/路径）、Skill 根、解压失败警告、submission id、两个 sha256 前缀与本地 ZIP 路径；截止时间过期标红 |
| 登录与 token | ✅ 插件侧两个来源：DSH **设置页**的 `nju-lab` 节（`ctx.settings.installSection`，即时生效）+ `NJU_LAB_TOKEN` 环境变量作默认；缺失/被拒给可读提示。平台侧 `POST /api/me/tokens` + `revoke`（D-Lite+，`tokenVersion` 整体吊销）已实测可用 |
| 评估条件跨进程持久化 | ✅ `src/host/eval-state.ts`：claim 后写 `<workspace>/nju-lab/pinned-eval-config.json`，启动时恢复（优先于配置里的默认值），平台本次未下发条件时清掉旧值；文件损坏/形状不对只警告并忽略。L2 实测：两趟**独立** `dsh` 进程，第二趟一启动工具面就已被收窄（含 `bash`、不含 `web_fetch`） |
| 测试 | ✅ 61 条（55 L1 + 6 L2），带 `DSH_BIN` 真跑 `dsh` 时 **61 pass / 0 fail / 0 skip**；不带则 6 条 L2 静默 skip。真模型也验证过会自己调用工具 |
| 模型引导 | ✅ `src/host/guidance.ts`：常驻 system prompt 段（`nju-lab:workflow`，order 1800）+ 通过 `ctx.skills.register()` 注册的 `nju-lab-experiment` skill（目录 + 按需加载 + `/nju-lab-experiment`）。L2 实测（真 headless DSH）：引导文字出现在请求的 system 消息里，skill 目录列出该名字，模型调 `skill` 后拿回 `<skill_content name="nju-lab-experiment">` 正文 |
| `evalConfig.tools` 白名单 | ✅ 能力名 → DSH 工具名映射（`shell`→`bash`、`fs`→`read/write/edit/glob/grep`），在 `agent/created` 用 `agent.ctx.tools.restrict({ allow })` 生效，并在 claim 之后对**已存在**的 agent 补一刀。未知能力名忽略并显式警告 |
| 证据包 `.dshc` | ✅ 真实实现：`collectEvidence()` 经 `ctx.sessionPersistence` 取**本工作目录下各会话**（按 `header.cwd` 归属，跨多次 DSH 启动）→ 按 `approval/`、`permission/` 前缀筛审计事件 → 递归脱敏（字符串 200 / 数组 50 / 深度 6）→ `buildCapsule()` 产出 `nju-lab.capsule/v1`（`sessions` + `auditEvents` + sha256 `integrity`，`note` 不入哈希）落盘 `evidence.dshc` → 上传并以 `capsuleFileId` 提交，`auditEvents` 一并交给平台。采集失败只记 `note`，**不阻断提交**。L2 实测（真 headless DSH）：17 个会话事件 → 2 条审计事件（`permission/preset`、`approval/policy`），无降级 |

## 踩坑记录：evalConfig 曾让 claim 之后的 DSH 完全不可用（已修）

平台示例数据原本是：

```json
{"model": "deepseek-chat", "tools": ["shell"], "timeoutSeconds": 600, "reasoningEffort": "medium"}
```

但 `deepseek-official` 声明的模型是 `deepseek-flash` / `deepseek-v4-flash` / `deepseek-v4-pro` /
`deepseek-v4-flash-vision-exp`（**没有 `deepseek-chat`**），且该 provider **整体不支持 reasoning
effort**（`dsh-llm-deepseek` 的 `reasoningEffort()` 直接抛 `UNSUPPORTED_REASONING_EFFORT`；
deployment 的 `thinking: 'disabled'` 也会拒掉非 `off` 的值）。

`lock.ts` 会把这两个字段钉进每个请求，于是 **claim 之后每个模型请求都失败**：

```
dsh: UNSUPPORTED_REASONING_EFFORT: provider "deepseek-official" model "deepseek-chat"
     does not support reasoning effort "medium"
```

**已修（只改平台数据，插件不动）**：

- `server/src/seed.ts`：示例 evalConfig 改为 `{ model: 'deepseek-flash', tools: [...], timeoutSeconds: 600 }`
- `web/src/pages/teacher/ProjectDetail.tsx`：评估模型 placeholder 改为 `deepseek-flash`，并给
  「推理档位」补了留空提示（DeepSeek provider 不支持）
- 数据库现有行已 `UPDATE` 成同一组合（`claim` 实测返回 `{"model":"deepseek-flash","tools":["shell"],"timeoutSeconds":600}`）
- 真 DSH + 真平台 + fake 模型实测：claim 之后的请求**不再失败**

**注意**：`reasoningEffort` 的钉制能力仍在（`lock.ts` 没改，测试仍覆盖它）—— 只是当前 provider
不支持，所以平台不下发。将来接上支持推理档位的 provider 可以再打开。

**留给未来的选项**：插件目前**不做**能力校验，教师填错就会炸。若要防这一手，可在钉之前用
`ctx.llm.resolveModelInfo(provider, model)`（返回 `efforts: LlmReasoningEffortInfo[]`）过滤掉不支持的
字段 —— 代价是一套异步查询 + 缓存。

## 关键事实（均已核对官方源）

**评估条件**

- `agent/request` 是 **waterfall**，`await next()` 得到本要用的 call 配置，返回替换值即改写；它只替换 **provider / model / reasoningEffort / maxTokens**，**不能钉工具集**（工具用 `ctx.tools.restrict()`）。
- `ctx.tools.restrict({ allow })` 的语义是"**只保留** allow 里的"。它过滤的是该 scope **继承来的层**（全局 + 祖先层），**只有 agent 自己那层豁免** —— 插件工具注册在插件根，所以**照样会被收窄**，必须显式列进 `allow`（它们属于 inherited，在 `restrictableNames` 里，能合法列出）。
- `restrict()` 只在 **scoped context** 上可用（插件根 ctx 会抛 `requires a scoped context`）。`agent/created` 事件的 `this` 是 `Scoped<Agent>` —— 它**故意不暴露属性**（只作 scope carrier，官方注释："Event payloads carry the real subject"），真正的 agent 要从 **`payload.agent`** 取，然后 `agent.ctx.tools.restrict(...)`。
- 平台发的 `tools` 是**抽象能力名**（`shell` / `fs`），不是 DSH 工具名，翻译放在插件的 `CAPABILITY_TOOLS`。这份映射必须与服务端复验容器一致。
- `ctx.tools.restrict()` 有两条硬约束：**只能在 scoped context（`agent.ctx`）上调用**（插件根 ctx 会抛错），且名字必须是**真实存在的全局工具名**。
- `reasoningEffort` 的类型是 `ReasoningEffortId` —— provider adapter 定义的 opaque branded string（官方注释：no validation is performed），所以平台下发 `medium` 是合法的，不要硬编码白名单。

**插件骨架**

- client 半由 DSH 的 client-modules 服务按 `package.json` 的 `dsh.client` **自动扫描挂载**，需导出到 `exports["./client"]`。
- slot 组件拿不到 `ctx`；要给它数据/回调，用 `ctx.slots.register({ ..., inject: () => ({...}) }, Component)`（`inject` 建在能访问 `ctx` 的闭包里）。
- **`sidebar.right.pane.tab` 是按 key 的 keyed slot**，必须两阶段注册：先 `ctx.sidebarRightTabs.register({ id, kind, title })` 声明 tab 类型，再用它的 `id` 当 `key` 注册 body 与 `sidebar.right.pane.tab.title`。只写单阶段 `register({ name })` 什么也不会渲染。
- client 半的 `react` / `react/jsx-runtime` 由 DSH 的模块 loader 在运行时提供，**必须在打包时外部化** —— 打包进来会出现第二份 React，hooks 直接崩。
- client 半产物必须是**自注册的 classic script**：`window.__ModuleLoader__.load({ id, factory })`，工厂体内是 CJS（`require` / `module.exports`）。combo 路由按字节原样拼接各包产物，发 ESM 会让整个 combo 脚本在浏览器 parse 阶段就 SyntaxError（`import outside a module`），**同脚本内所有包的工厂都注册不上**（报 `loaded without registering ... via __ModuleLoader__.load`）。`tsdown.config.ts` 里用 `format: 'cjs'` + `build:done` 钩子包外壳（不能用 rolldown banner/footer，会让 dts 的 fake-js 解析失败）。
- client 侧的类型增强（`ctx.slots`、`ctx.sidebarRightTabs`）声明在包的 **`./client` 子路径**，`import type {} from '<pkg>/client'` 才会生效。
- **服务访问需要 inject**：`ctx.foo` 在未注入时直接抛 `cannot get property "foo" without inject`，所以"运行时探测某服务在不在"是行不通的。要可选依赖，用 `ctx.inject(['foo'], (scoped) => { ... })`（服务不出现就不执行）。`connection`/`settings` 只在 `dsh web` 下存在，headless 没有 —— 硬写进 `inject` 数组会让插件在 headless 下**整个加载失败**。
- **tab 注册 ≠ tab 可见**：右栏停靠面每会话一份、刷新后回折叠态，且只在选中会话时挂载席位。tab 类型要加 `guide` 入口才会上引导页（省略即不上）；要主动展开就用 `ctx.sidebarRight.openTab(kind)`（写操作在无挂载会话面时抛错，我们轮询到首次成功）。契约全文见官方子系统文档《右侧 Sidebar》。
- **设置页要两个半侧配合**（官方 cookbook《新增设置卡片》）：Host 半 `installSection` 只喂命名空间；设置页插件配置 tab 只渲染有卡片认领的命名空间 —— 卡片由 client 半注册到 `settings.plugin.item`（key = 命名空间），用 `ctx.settingsScope.bind({ namespace })` 读写（`set`/`unset`，revision 设栅）。官方卡片的辅助组件不能跨包 import（bundle 纯净度门禁），卡片样式要自绘。

**配置与设置页**

- 把 `Config` 暴露成设置页可填项，用 `ctx.settings.installSection(owner, ns, schema, config, hooks)`：`ns` 必须是 **lowercase-hyphenated** 标识符（官方用 `llm-deepseek`，我们用 `nju-lab`），`schema` 就是 schemastery 的 `Config`，`entry` 是 composition 层的值。
- `hooks.setSource` 收到的是**取值 thunk**（`() => T`）而不是值本身 —— 保存它、每次读时调用，用户改设置就即时生效。所以 `PlatformApi` 接受 `Config | (() => Config)`。
- settings 的用户层存在 `$DSH_HOME/settings.yaml`，层级是 `schema 默认值 → composition base → 用户文档`。
- 敏感值（token）DSH 另有 `ctx.credentials` 服务（settings 只存**环境变量名**这类引用，真值由 provider 保管）。我们目前把 token 直接放在 settings 里，没走 credentials。

**ZIP 与 Skill 目录**

- 模板 ZIP 与学生提交的 ZIP 都**允许包一层顶层目录**（`csv-cleaner/SKILL.md`）。任何消费方都必须先经 `resolveSkillRoot`（REQ-2026-09-21 §1.0），不能假定 `<dir>/SKILL.md` 存在 —— 服务端复验容器也要用同一语义。
- 打包 / 解压走 `src/host/zip.ts`（无外部依赖）：**写**用 store 模式（输出对相同输入逐字节确定，sha256 可复现），**读**支持 store + deflate。
- **真实平台的模板是 deflate 压缩的**（只有小文件才可能落成 store），所以"读"只实现 store 会在真实模板上炸 —— 这个 bug 本地小样本测不出来，必须对真平台跑一次。
- 切 ZIP 条目数据要按**压缩后**大小（central directory 的 offset 20），不是 uncompressed size（offset 24）：两者只在 store 时相同。
- 读 ZIP 走 central directory，而不是顺序扫 local header —— 带 data descriptor（flag bit 3）的 ZIP 在 local header 里读不到长度。

**面板路由**

- host 侧用 `ctx.connection.fetch.register({ path: '/api/<name>', methods, requestBody: 'buffered', fetch: (req: Request) => Promise<Response> })`；`path` 是 `/api` 之下的绝对路径。
- 部署与调试：profile 的插件是从 **pnpm 装的副本**读的 —— 改了插件源码必须重新 `dsh plugin --profile <name> install`；非 TTY 环境下要 `CI=true`（否则 pnpm 以 `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` 中止）。

## client 半开发总结（2026-09-22，真实浏览器验证定稿）

这一节是把本插件 client 半从零到可用的完整方法论，按"声明 → 构建 → 可见 → 设置 → 验证"组织。每一步都标注了权威来源；与上文「关键事实 → 插件骨架」互为索引。

### 1. 声明：一个包，两副面孔

- host 半：`exports["."]` + bundle 的 `cordis.patch.yml` 插入挂载（profile 只需 `package.json` 依赖 + patch 行）。
- client 半：`exports["./client"]` + `package.json` 的 `dsh.client = { platform: 'web', inject: [...], immediately: true }`。挂载侧**不需要**任何额外行 —— client-modules 服务自动扫描已启用 Loader 条目里声明了 `dsh.client` 的包，组合进 `window.__DSH_BOOT__`。
- `dsh.client.inject` 填**包名**（模块图里工厂必须先于我们到场的包，如 `@deepseek-ai/dsh-client-ui-sidebar-right`）；`exports.inject` 填**服务名**（cordis 要等的服务，如 `slots`、`sidebarRight`、`settingsScope`）。两者别混。
- client 侧类型增强一律 `import type {} from '<pkg>/client'`（`./client` 子路径），值导入会撞 bundle 纯净度门禁。

### 2. 构建：产物必须是 lazy-CJS factory

这是最容易翻车的一步（我们在此栽过：发 ESM 导致**整个 combo 脚本 parse 失败，50+ 个包的工厂全注册不上**，报 `loaded without registering ... via __ModuleLoader__.load`）。

- 模块系统是懒加载 CJS 表：combo 路由把各包 `client.js` **按字节原样拼接**，浏览器按 classic script 解析。产物必须是自注册的 `window.__ModuleLoader__.load({ id, factory })`，工厂体内用 `require` / `module.exports`，副作用只在物化时跑。
- 官方原话（cookbook《新增设置卡片》）："bundle 必须是 loader 的 lazy-CJS factory 产物……没有已发布的预设，本仓库之外的包得**自行复刻**同样的输出格式"。
- 我们的复刻法（`tsdown.config.ts`）：`format: 'cjs'` + `build:done` 钩子手写外壳（**不能用** rolldown banner/footer —— 会进 dts 的 fake-js 解析而报错）+ `outExtensions` 强制 `.js` 对齐 `exports["./client"]`。
- `react` / `react/jsx-runtime` 必须 external —— 它们是 shell 的种子模块，运行时 `require("react")` 由 loader 应答；打包进来就是第二份 React，hooks 直接崩。

### 3. 可见性：注册了不等于看得见

右栏停靠面的三条生命周期事实（官方子系统文档《右侧 Sidebar》）：**每会话一份、刷新后回折叠态、只在选中会话时挂载席位**。所以：

- tab 类型注册的 `guide` 字段**省略即不上引导页**，用户没有任何入口发现你的 tab —— 必须加。
- 要主动展开：公开 API 是 `ctx.sidebarRight.openTab(kind)`；席位未挂载时写操作抛错。官方没有"会话选中"事件，我们用 2s 轮询到首次成功（`src/client/index.tsx` 的 auto-open 段）。
- 重复 `openTab` 同 (kind, address) 会聚焦已有 tab（页面类 tab 在 pane 内去重），所以轮询成功一次就停，避免抢焦点。

### 4. 设置页：两个半侧缺一不可

官方 cookbook《新增设置卡片》的配对模型：Host 半 `ctx.settings.installSection(ns, schema, ...)` 只负责**喂命名空间**；设置页插件配置 tab **只渲染有卡片认领的命名空间**——只装 Host 半的话设置页什么都看不到（我们踩过）。

- 卡片由 client 半注册到 `settings.plugin.item`（**key = 命名空间**，这是两半配对的键）。
- 读写走 `ctx.settingsScope.bind({ namespace })`：`getSnapshot()/subscribe()` 拿 `{ status, value, user, writable, revision }`，`set(field, v)` / `unset(field)` 写入（revision 设栅、串行化、失败可恢复）。`unset` = 清回组装层（composition base）。
- 官方内置卡片的辅助组件（PluginCard/ValueField/CardForm）**不能跨包 import**（纯净度门禁），卡片样式自己画（`src/client/SettingsCard.tsx` 是最小可用版）。
- scope 的 disposer 挂在**调用方** fiber 上，且写路径经提供方 ctx 转发 —— 调用方不需要自己 inject `remote.settings`。

### 5. 验证方法论：curl 证明不了浏览器里能跑

本次最大的教训：**HTTP 200 只证明字节送达，证明不了脚本能 parse、工厂能注册、UI 能渲染**。client 半的验证要分层：

1. `npm run typecheck` + L1/L2 测试（61 条）——逻辑与 host 半契约；
2. **vm 模拟 loader**：Node `vm` 里以 stub `window.__ModuleLoader__` 执行产物，断言 `id` 注册成功、`factory(require)` 物化出 `name/inject/apply` —— 秒级，能抓出 ESM 事故；
3. **Playwright 真实浏览器 E2E**（终极判据）：起真 `dsh --profile nju-lab-student`，Chromium 走完 引导弹窗 → 选工作区 → 建会话，断言面板自动展开渲染、设置页卡片出现、保存写进 `$DSH_HOME/settings.yaml`。本次三个 bug 里有两个只有这一层能发现。

### 6. 权威文档（比逆向 minified 产物可靠得多）

- 官方文档站：https://deepseek-harness.github.io/deepseek-harness/
  - 《右侧 Sidebar》子系统：`/reference/subsystems/sidebar-right` —— tab 类型注册、导航服务、slot 契约全文
  - 《客户端 Slots》子系统：`/reference/subsystems/slots`
  - cookbook《新增设置卡片》：`/reference/cookbook/adding-a-settings-card` —— 两半配对 + lazy-CJS factory 要求
- 社区白皮书：https://electricitysheep.github.io/dsh-handbook/（第 3 章 profile 与插件系统、第 4 章插件开发实战）
