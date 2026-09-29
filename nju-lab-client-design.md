# NJU-Lab 定制 Agent 客户端（nju-lab-client）技术设计

> 本文是 [`nju-lab-craft.md`](./nju-lab-craft.md) 在"学生本地 DSH 定制客户端"这一块的落地设计。
> 与 `nju-lab-craft.md` 不同，本文的事实前提**逐条核对了官方源**（GitHub `deepseek-ai/deepseek-harness`、npm `@deepseek-ai/*`）。
>
> 图例：**✅ 已核实**（读到官方 docs / 包 manifest / 清单原文）；**⚠️ 待核实 / 需自研**；**🧭 设计决策**（本项目选择，非 DSH 事实）。

---

## 0. 结论先行

要在 DSH 上做一个"定制 agent 客户端"，本质是**两层叠加**：

1. **一个自定义 profile**（`nju-lab-student`）：在 `dsh-base` 之上，按序堆叠内置 `web-app` bundle + 我们自己的插件 bundle，用 `cordis.patch.yml` 钉死启动形态。
2. **一个双半插件**（`nju-lab-client`）：host 半（Node）负责平台 API、条件锁定、证据采集、提交前自检；client 半（浏览器）负责在 Web UI 里注入任务面板 / 领取 / 提交 / 对比视图。

不需要 fork DSH，不需要自绘整机 GUI。DSH 的"everything is a plugin + profile 分层 patch"模型正好承载这件事。若要脱离 Web UI 做独立客户端（自绘 GUI/CLI），再走 SDK（`dsh --profile sdk` + stdio JSON-RPC），见 §5.4。

**必须先接受的前提（✅ 已核实）**：DSH 处于 developer preview，npm 当前主线是 `0.1.7-rc.2`，官方明示**会有破坏性变更**。`nju-lab-craft.md` 里锚定的 `0.1.2-rc.1 / v0.1.3-alpha.1` 已落后，且文中的四个社区插件**在 npm 上不存在**（见 §9）。

---

## 1. 事实基线与版本锁定

| 项 | 事实（✅ 已核实，来源见附录） |
|---|---|
| 项目 | DeepSeek Harness（`dsh`），MIT，Cordis 插件框架，"everything is a plugin" |
| 仓库 / 文档 | `github.com/deepseek-ai/deepseek-harness`（分支 `master`）；文档站 `deepseek-harness.github.io/deepseek-harness/` |
| npm 主线 | `@deepseek-ai/dsh@0.1.7-rc.2`（包 > 100 个，多为 `0.0.1-rc.x`） |
| 启动器 | `dsh` CLI：`dsh <profile>` ≡ `dsh --profile <profile>`；`npx @deepseek-ai/dsh web` |
| 内置 profile 模板 | `web`、`headless`、`sdk`、`sdk-minimal`、`acp` |
| `desktop` | 保留名，CLI 拒绝 |

**🧭 版本锁定策略**：本仓库/本文锁定 `0.1.7-rc.*` 线，学期内不升级；升级前须重跑 §9 的实证清单。

---

## 2. 三级"定制"能力与选型

DSH 里"定制客户端"有三种粒度，本项目**全部落在 ①+②**，③ 作为后续可选：

| 级别 | 是什么 | 本项目用法 | 结论 |
|---|---|---|---|
| ① 组合层：**profile + bundle** | Harness home 里的具名组合，堆叠 bundle + 自带 patch | `nju-lab-student` profile | 🧭 **采用** |
| ② 插件层：**host 半 + client 半** | 注入服务/工具（host）与 UI（client） | `nju-lab-client` 双半插件 | 🧭 **采用** |
| ③ 整机层：**新 bundle / SDK 客户端** | 像 `web-app`/`headless`/`sdk-app` 那样新起一个 surface；或 SDK 驱动 | 复验用内置 `headless`；独立 GUI 走 SDK | 🧭 复验采用 ③ 的 headless；自绘 GUI 暂缓 |

对应 `nju-lab-craft.md` 的映射：

- `nju-lab-student` = ① 自定义 profile（stack `dsh-base` + `web-app` + `nju-lab-client`）
- `nju-lab-client` = ② host+client 双半插件
- 平台复验 = 内置 `headless` profile + 自定义复验 patch（§7）
- 独立客户端 GUI = ③ 的 SDK（§5.4，暂缓）

---

## 3. DSH 组合模型（profile / bundle / patch）

> 全部 ✅ 已核实，来源：`docs/architecture.md`、`packages/boot/app-boot/README.md`、`apps/cli/README.md`、`docs/subsystems/boot.md`。

### 3.1 一次运行 = 按序叠加的插件树

各层按顺序应用到空条目列表，**后者按行覆盖前者**（同 id 整行替换，非深合并）：

```
dsh-base 层（模型适配器、工具、持久化、沙箱/审批、settings、credentials、telemetry）
  → profile 按序堆叠的 bundle patch（dsh.profile.bundles）
  → profile 的 cordis.patch.yml
  → home 级 $DSH_HOME/cordis.patch.yml
  → 命令行 --patch <path>（可重复，按 argv 顺序）
```

### 3.2 profile 在磁盘上长什么样（✅）

```
$DSH_HOME/                 # 默认 ~/.dsh
  .env                     # 环境层（PATH/DSH_* 等"启动决定型"变量禁止放这里）
  cordis.patch.yml         # home 级 tweak 层
  profiles/
    nju-lab-student/       # 一个 profile = 一个目录
      package.json         # 声明 dsh.profile.bundles + 依赖
      cordis.patch.yml     # 该 profile 的 tweak 层
```

### 3.3 `package.json` 的 `dsh` 字段（✅，`dsh.profile` 仅 docs 级）

```jsonc
// bundle 包：声明它的 patch 文件
{ "dsh": { "bundle": { "patch": "./cordis.patch.yml" } } }

// 带 Web client 半的包：声明 client 面
{ "dsh": { "client": { "platform": "web", "inject": [], "immediately": true } } }

// profile 包：声明堆叠的 bundle 列表（形状 dsh.profile.bundles，docs 级，未取到完整样例 ⚠️）
{ "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "nju-lab-client"] } } }
```

### 3.4 patch 语法（✅）

```yaml
# 插入新行（本地插件用绝对路径 / 相对 patch 文件的 ./ 相对路径）
- insert:
    - id: nju-lab-client
      name: '/abs/path/nju-lab-client/src/index.ts'
      config: { serverUrl: 'https://lab.example.edu/api' }

# 按 id 替换现有行（整行替换，不深合并）
- id: typert-loader
  disabled: true
```
- 支持 `!!js` 表达式（boot 期求值）。
- **`cordis.patch.yml`** 是分层 tweak 层；**`cordis.yml`** 是某次启动的基础 Loader 配置（CLI 示例用）。

### 3.5 关键命令（✅）

```sh
dsh web                                   # ≡ dsh --profile web；默认 127.0.0.1:3080
dsh web --no-open                         # 不自动开浏览器（--no-open 是 web-app 参数）
dsh --profile web --dump-config           # 打印"本机实际 boot 的整棵树"（含 profile+home+patch）
dsh --profile <name> --dump-default-config# 只看内置 bundle 默认值
dsh --profile nju-lab-student --from-default-profile web   # 从内置模板派生一个新 profile
dsh plugin --profile nju-lab-student <pnpm args>           # 在 profile 目录里跑 pnpm（装插件）
dsh web --patch ./nju-lab-client/cordis.yml                # 叠加一次性 overlay（调试用）
```

---

## 4. `nju-lab-student` profile 设计（🧭）

### 4.1 选型

- 从内置 `web` 模板派生（`--from-default-profile web`），得到 base + web-app + 实时 patch 能力。
- 在其上**插入 `nju-lab-client` bundle / 插件行**。
- 用 profile 的 `cordis.patch.yml` 钉死本课程约束：
  - 默认权限预设 = `workspace-write`（**不提供** `danger-full-access`）。
  - 审批策略 = `ask`（学生交互场景）。
  - 预置平台 API 地址与个人 token（经 credentials 服务，不硬编码）。
  - 关闭学生不可见的工具/命令（按课程需要）。

### 4.2 `nju-lab-student/package.json`（🧭，字段形状见 §3.3）

```jsonc
{
  "name": "nju-lab-student-profile",
  "private": true,
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "nju-lab-client"]
    }
  },
  "dependencies": {
    "@deepseek-ai/dsh-base": "0.0.1-rc.1",
    "@deepseek-ai/dsh-web-app": "0.0.1-rc.1",
    "nju-lab-client": "workspace:*"
  }
}
```

### 4.3 `nju-lab-student/cordis.patch.yml`（🧭 形状 ✅）

```yaml
# 学生端约束（示例，字段名以 config-catalog 为准，装库时用 dsh --dump-config 校准）
- id: permission-presets
  config:
    defaultPreset: workspace-write
- id: user-approval
  config:
    policy: ask
- insert:
    - id: nju-lab-client
      name: 'nju-lab-client'
      config:
        serverUrl: 'https://lab.example.edu/api'
```

> 学生端**永不**出现 `danger-full-access`（`nju-lab-craft.md` §3.3 的最小权限原则）。

---

## 5. `nju-lab-client` 插件设计（🧭，API ✅）

### 5.1 包结构与双半声明

```
nju-lab-client/
  package.json          # 声明 dsh.client（client 半）+ exports["./client"]；可选 dsh.bundle
  cordis.patch.yml      # 若同时作为 bundle 分发
  tsdown.config.ts      # client 半用 tsdown 打包（✅ 官方 client bundle 用 tsdown）
  src/
    index.ts            # host 半入口：export name / inject / apply(ctx, config)
    host/
      config.ts         # Config Schema（schemastery）
      api.ts            # 平台 API 客户端（HTTPS + Bearer token）
      tasks.ts          # 任务面板数据（service）
      claim-submit.ts   # 领取 / 提交（工具或命令）
      precheck.ts       # 提交前自检（目录结构、frontmatter、哈希）
      evidence.ts       # 证据采集（session 持久化 / 导出）
      lock.ts           # agent/request 条件锁定
    client/
      index.ts          # client 半入口
      ClaimPanel.tsx    # slot 组件：领取 / 提交
      CompareView.tsx   # 对比视图（用 vs 不用 Skill）
```

`package.json`（✅ 形状）：

```jsonc
{
  "name": "nju-lab-client",
  "exports": {
    ".": { "default": "./lib/host/index.js" },
    "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" }
  },
  "dsh": {
    "client": {
      "platform": "web",
      "inject": ["@deepseek-ai/dsh-client-locale", "@deepseek-ai/dsh-client-runtime",
                 "@deepseek-ai/dsh-client-ui-conversation"],
      "immediately": true
    }
  }
}
```

**client 半的接线机制（✅）**：host 半扫描 Loader 条目里声明了 `dsh.client` 的包，按各自 Loader specifier 组合出 `window.__DSH_BOOT__`（`WebBootGraph { rev, entries, batches }`），Web 端在 `/plugins/??<pkg>/client.js&rev=<rev>` 拉取懒加载 CJS 模块。插件无需自管 HTML/入口，只需正确声明 + 导出产物。

### 5.2 host 半：能力

**入口（✅ 形态）**：

```ts
import type { Context } from '@deepseek-ai/cordis'
export const name = 'nju-lab-client'
export const inject = ['tools', 'credentials']   // 等待依赖服务就绪后再 apply

export function apply(ctx: Context, config: Config) {
  registerPlatformTools(ctx, config)   // 领取/提交/自检
  registerConditionLock(ctx, config)   // agent/request 条件锁定
}
```

**注册一个平台工具（✅ `defineTool` DSL，来自 `@deepseek-ai/dsh-tools`）**：

```ts
import { defineTool } from '@deepseek-ai/dsh-tools'

ctx.tools.register(defineTool({
  name: 'nju_lab_claim',
  description: 'Claim the current assignment and download template + test dataset.',
  parameters: { assignmentId: { type: 'string', required: true, description: 'assignment id' } },
  output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
  async execute({ assignmentId }) {
    return await api.claim(assignmentId)   // 打平台 HTTPS API，落盘模板/数据
  },
}))
```

**配置 Schema（✅ 用 `@deepseek-ai/schemastery`，普通对象会被拒）**：

```ts
import { Schema } from '@deepseek-ai/schemastery'
export interface Config { serverUrl: string; token?: string }
export const Config: Schema<Config> = Schema.object({
  serverUrl: Schema.string().required(),
  token: Schema.string(),
})
```

**事件监听（✅）**：`ctx.on('tools/result', handler)`；waterfall 监听**必须调用 `next()`** 才算委派。注意：`turn/*`、`step/*`、`tool/call`、`tool/result` 是**持久化事件**，同名 Cordis 事件不存在——要观察它们用 `session/event`。

**证据采集（✅ 可用构件）**：
- `@deepseek-ai/dsh-session-persistence`（`ctx.sessionPersistence`，provider `…-jsonl`，`session.vN.jsonl[.zstd]`，带校验和）。
- `@deepseek-ai/dsh-session-log-export`（"Web Session-log 导出命令 + 下载对话框"，真实路径 `packages/session-query/session-log-export`）。
- `@deepseek-ai/dsh-session-telemetry` / `…-otel`（`DSH_TELEMETRY_MODE`、`DSH_TELEMETRY_OTLP_URL`）。

> ⚠️ `nju-lab-craft.md` 里的 **`.dshc`（dsh-capsule）证据包在 npm 上不存在**；"打包证据包"这一步需**自研**，基于上面的 session 持久化 + 导出构件实现。

### 5.3 client 半：UI 与 slot 注入

**注册 UI（✅ slots API）**：

```tsx
import type { Context } from '@deepseek-ai/cordis'
export const inject = ['slots']

export function apply(ctx: Context): void {
  ctx.slots.inject('conversation.session.header.actions', () =>
    ctx.slots.register(
      { name: 'conversation.session.header.actions', id: 'nju-claim', order: 100 },
      ClaimButton,
    ))
  ctx.slots.inject('sidebar.right.pane.tab', () =>
    ctx.slots.register(
      { name: 'sidebar.right.pane.tab', id: 'nju-tasks', order: 100 },
      TaskPanel,
    ))
}
```

- slot 有 `single | list | keyed | chain` 基数与 `root | session | session-maybe` 作用域。
- **组件永远拿不到 `ctx`**（只能通过声明的 `store`/`inject`/`locale` 输入）。
- 已核实可注入的真实 slot key（选取，完整表见 `docs/subsystems/slots.md`）：
  `root`、`sidebar`、`sidebar.settings`、`settings.section`、`settings.plugins.tab`、`main.conversation`、
  `conversation.session.header.actions`、`conversation.session.header.utilities`、`conversation.composer`、
  `conversation.composer.bar`、`conversation.input.model`、`conversation.chat.assistant-actions`、
  `conversation.chat.node`、`conversation.chat.turnTail`、`tool.call.toolview`、`rightbar.session`、
  `sidebar.right.pane.tab`、`shell.overlay`。
- 实时查看当前树的 slot：命令面板里的 `cordis_inspect what:"client"`。

**打包**：client 半用 **tsdown**（`tsdown` / `tsdown --watch`）；app shell 前端本身是 **Vite**（`@deepseek-ai/dsh-web-frontend`）。⚠️ 官方未提供 plugin client bundle 的 Vite 配置先例，按 tsdown 走。

### 5.4 关键扩展点：`agent/request` 条件锁定（✅ **已核实存在**）

`nju-lab-craft.md` 里最有争议的一点——"用 `agent/request` waterfall 钉死评估条件"——**成立**：

```ts
// 生成自 packages/core/agent/src/runtime-types.ts（docs/subsystems/core.md）
'agent/request'(
  payload: { agent: Agent; turn: number; step: number; signal: AbortSignal },
  next: () => Promise<LlmCallConfig>,
): Promise<LlmCallConfig>
```

- **waterfall**；`await next()` 得到机器本要用的 call 配置，返回替换值即可改写。
- 触发时机：**prompt 组装之后、`step/start` 之后，系统提示与被采纳的用户消息提交之前**（`docs/architecture.md` §Turn flow；`docs/agent-lifecycle.md` 时序图第 35 行）。
- 它替换的是**冻结的 call 配置**，即 `AgentOptions` 里声明的 `provider / model / reasoningEffort / maxTokens`。

```ts
// nju-lab-client/host/lock.ts（🧭）
ctx.on('agent/request', async (payload, next) => {
  const base = await next()
  return { ...base, provider: evalConfig.provider, model: evalConfig.model,
           reasoningEffort: evalConfig.reasoningEffort, maxTokens: evalConfig.maxTokens }
})
```

> ⚠️ **纠正**：`agent/request` **能否钉死工具集**未获证实——它只替换 `LlmCallConfig`，工具 schema 组装在 `request/header.tools`，是**另一条链路**。工具可见性应通过 `ctx.tools.restrict()` / `presentAs()` / scope 控制（见 `docs/subsystems/tools.md`、glossary 的 restriction 条目）。因此"工具集白名单"的锁定要另做，不能只靠 `agent/request`。
> 相关 hook：`agent/pre-step`（改写/驳回已声明消息，waterfall）、`agent/request-error`（重试）、`agent/turn-stopping`（serial，终止一轮）。

**SDK 客户端（③，暂缓）**：若要做脱离 Web UI 的独立客户端，用 `dsh-sdk-app`（= `dsh --profile sdk`）挂 `@deepseek-ai/dsh-sdk-jsonrpc-server`，**stdio 换行 JSON-RPC**，协议类型在 `@deepseek-ai/dsh-sdk-protocol`：`initialize` 握手 → `session/prompt`（返回 `{ messageId }`）→ 流式 `session.event` + `session.status` → `shutdown`。TS 端 `packages/sdk/client`，Python 端 `pip install deepseek-harness-sdk`（`DeepSeekHarness(...).run(prompt)`）。

---

## 6. 安全模型映射（✅ 三层）

`nju-lab-craft.md` §7 的"沙箱 → 权限预设 → 审批"三层，在 DSH 里的真实构件：

| 层 | 包 / 服务 | 关键事实（✅） |
|---|---|---|
| 审批 | `@deepseek-ai/dsh-user-approval`（`ctx.approval`） | `ApprovalPolicy = 'ask' \| 'never'`；`never` **确定性返回 `rejected`，不派发任何应答者**，且后续 `prepend` 监听也无法绕过（fail-closed）；审计对 `approval/asked` / `approval/decided` |
| 权限预设 | `@deepseek-ai/dsh-permission-presets`（`ctx.permissionPresets`） | `PresetSpec { sandbox, approval, name?, description? }`；默认 `workspace-write`+`ask`、`danger-full-access`+`never`；日志型 `permission/preset` 事件 |
| 沙箱 | `@deepseek-ai/dsh-sandbox`（`ctx.sandbox.confine(argv, policy, signal)`） | provider `dsh-sandbox-local`（Linux bwrap/Landlock、macOS Seatbelt、Win ACL）；消费方 `dsh-bash-sandbox` / `dsh-pwsh-sandbox`；`SandboxMode = read-only \| workspace-write \| danger-full-access`；沙箱不可用 fail-closed |

- **学生端**：`workspace-write` + `ask`；禁用 `danger-full-access`。
- **复验端**：`approval=never` 确定性拒绝（无人值守）。强制方式：把会话审批策略设为 `never`，或使用 `danger-full-access`+`never` 预设；进程级回退环境变量 **`DSH_PERMISSION_MODE`**。
- ⚠️ 注意：内置 **`sdk-minimal` profile 钉死 `danger-full-access` 且不挂审批服务**——**不能**直接拿它做复验，必须自建受约束的 headless patch（§7）。

> 沙箱只管文件效果，**不挡网络与进程**（与 `nju-lab-craft.md` §7 一致）——所以复验容器仍须**断网**，容器是唯一信任边界。

---

## 7. 复验：headless + 断网 + approval=never（✅ + 🧭）

**内置 headless 的一次性运行（✅ 2026-09-21 实测校准，见 dsh/verify-poc/）**：

```sh
dsh --profile headless "run the skill against the standard dataset"
# task 只能位置参数（多词空格拼接）；不支持 stdin 传 task（"-" 会被当字面任务）
# stdout: 最终 assistant 文本（无 assistant message 则空行 + exit 1）
# ⚠️ 0.1.5-rc.2 没有 --json/NDJSON 模式；**0.1.7-rc.2 起有 `--json`**（NDJSON 事件流：
#    `{"type":"session",…}` / `{"type":"status",…}` / …），驱动脚本尚未切换，仍按下面的
#    session 持久化日志采集：
#    $DSH_HOME/sessions/<cwd-slug>/<session-id>/session.v3.jsonl.zstd（多帧 zstd，用 zstd -dc 解）
# stderr: "dsh: reasoning:" 段与 "dsh: <code>: <message>"
# 退出码: 0 = 完成一轮；1 = 中止/报错/无 turn
```
- over `dsh-base`，关 HMR，不开端口；`headless-runner` 是全局 required 条目之一。

**🧭 复验 profile（`nju-lab-verify`，从 headless 派生）**：

```yaml
# nju-lab-verify/cordis.patch.yml
- id: permission-presets
  config: { defaultPreset: workspace-write }
- id: user-approval
  config: { policy: never }        # 确定性拒绝所有提权
# 网络：由一次性容器负责关闭（DSH 层做不到）
# 资源限额：CPU/内存/时长/token 由容器 + config 双重限制
```

容器编排（与 `nju-lab-craft.md` §6.4 一致）：解包 Skill → 用标准数据集跑 baseline/treatment → 采集 `session` 持久化/导出产物 → 输出结构化结果 JSON。**学生 Skill 的 `scripts/` 是任意代码，容器是唯一信任边界**。

> 平台复验用的是**平台自己的** `nju-lab-verify` profile 与基础镜像，**不读学生本地 profile**——这就是"评估条件不可篡改"的落地方式（学生改本地 profile 不影响复验）。

---

## 8. 与平台服务的契约（🧭，沿用 `nju-lab-craft.md` §6.7）

`nju-lab-client` host 半调用的平台 API（与现有 NestJS 后端一致，见 `server/README.md`）：

| 用途 | 方法 | 路径 |
|---|---|---|
| 我的课程/进度 | GET | `/api/me/courses` |
| 任务列表（含 unlocked） | GET | `/api/me/assignments` |
| 领取（校验 unlockRule，返回模板+数据+evalConfig） | POST | `/api/assignments/:id/claim` |
| 提交（ZIP ref + capsule ref + 审计事件 + 各文件 sha256） | POST | `/api/assignments/:id/submit` |
| 我的复验结果/反馈 | GET | `/api/me/evaluations/:id` |

- 认证：`Authorization: Bearer <token>`；token 由 credentials 服务持有，按人签发。
- `evalConfig`（provider/model/reasoningEffort/maxTokens）由 `claim` 下发 → host 半用它喂 §5.4 的 `agent/request` 锁定。

---

## 9. 风险与待核实项

### 9.1 已纠正（本文与 `nju-lab-craft.md` 的差异）

1. **四个社区插件不存在**（✅ npm 404）：`dsh-skillforge`、`dsh-session-lab`、`dsh-skill-dossier`、`dsh-group-manager`。真实社区生态活跃，但**是别的名字**：`@linxin666/dsh-client-ui-task-board`、`@linxin666/dsh-client-ui-skill-explorer`、`@michengai/dsh-skills-manager`、`dsh-session-manager`、`dsh-context`、`@xxxyz/dsh-mcp-manager`、`@linxin666/dsh-ssh` 等。→ `nju-lab-craft.md` §10 第〇阶段的"插件实证"必须真做，且要**改名单**或**自研替代**。
2. **`.dshc`（dsh-capsule）证据包不存在**：证据采集/打包需基于 `dsh-session-persistence` + `dsh-session-log-export` 自研。
3. **`agent/request` 存在**（✅ 名号正确），但**只能钉 provider/model/reasoningEffort/maxTokens**；**工具集白名单要另用 `ctx.tools.restrict()`**，不能只靠该 hook。
4. **版本落后**：`0.1.2-rc.1` → 当前 `0.1.5-rc.2`，rc 期破坏性变更。

### 9.2 待核实（落地前必测）

- `dsh.profile.bundles` 的完整 `package.json` 样例（仅 docs 级描述）→ 装库时用 `dsh --dump-config` 反推。
- `permission-presets` / `user-approval` 的**精确 config 字段名**（本文按 catalog 推断）→ 用 `docs/config-catalog.md` 校准。
- headless JSON 输出字段的稳定性（rc 期）。
- `nju-lab-client` client 半的 tsdown 打包与 Web shell 的版本兼容。

### 9.3 通用风险

| 风险 | 对策 |
|---|---|
| DSH rc 期破坏性变更 | 锁定 `0.1.5-rc.*`；平台服务与 DSH 解耦（本就解耦） |
| 学生 Skill 恶意代码 | 一次性**断网**容器复验；容器是唯一信任边界；静态检查 |
| 评估不公平 | 版本化数据集 + 平台侧 profile 复验（学生改不了） |
| 证据伪造 | session 持久化校验和 + 导出产物 + 平台独立复跑 + 审计事件交叉印证 |
| 学生本地安装不一致 | 一键配置脚本；第〇阶段产出安装手册；机房预装镜像兜底 |

---

## 10. 实施步骤（🧭）

```sh
# 0. 装（锁定版本）
npx @deepseek-ai/dsh@0.1.7-rc.2 web      # 冒烟：起 Web UI

# 1. 派生学生 profile
dsh --profile nju-lab-student --from-default-profile web
#   → 编辑 ~/.dsh/profiles/nju-lab-student/{package.json,cordis.patch.yml}

# 2. 开发 nju-lab-client（host + client 双半）
#   本地用 overlay 调试：
dsh web --patch ./nju-lab-client/cordis.yml

# 3. 校准配置字段
dsh --profile nju-lab-student --dump-config | less

# 4. 建复验 profile（从 headless 派生，approval=never + workspace-write）
dsh --profile nju-lab-verify --from-default-profile headless
dsh --profile nju-lab-verify "run standard dataset"

# 5. 集成测试：学生端领取→开发→自测(锁定条件)→提交→平台容器复验
```

**里程碑**：一名真实学生从"学习章节 → 领取 → 本地开发 → 提交 → 平台复验"全程无人工干预。

---

## 附录 A：术语

- **profile**：Harness home 里的具名启动形态（`$DSH_HOME/profiles/<name>`），堆叠 bundle + 自带 patch。
- **bundle**：Cordis 配置行 + 其挂载代码的分发格式（`package.json` 的 `dsh.bundle`）。
- **host 半 / client 半**：同一插件的 Node 面与浏览器面；client 半用 `dsh.client` 声明。
- **slot**：Web client 的类型化 React 组合系统（`ctx.slots.register/inject`）。
- **seam**：可替换能力（Service Definition + Provider + Consumer），如 `ctx.sandbox`、`ctx.fs`、`ctx.shell`。

## 附录 B：来源（均为本次实拉）

- GitHub：`deepseek-ai/deepseek-harness`（`master`）— `README.md`、`docs/architecture.md`、`docs/agent-lifecycle.md`、`docs/config-catalog.md`、`docs/subsystems/{boot,client-modules,slots,approval,permission-presets,sandbox,tools,core,persistence,session}.md`、`docs/user/develop/basic/{index,tool,config}.md`、`docs/user/develop/framework/{service,events}.md`、`docs/user/guide/python-sdk.md`、`packages/boot/app-boot/README.md`、`packages/bundle/{headless,sdk-app,web-app}/README.md`、`apps/cli/README.md`。
- 文档站：`https://deepseek-harness.github.io/deepseek-harness/`。
- npm：`@deepseek-ai/dsh@0.1.7-rc.2`、`@deepseek-ai/dsh-web-app`、`@deepseek-ai/dsh-headless`、`@deepseek-ai/dsh-sdk-app`、`@deepseek-ai/dsh-cordis-{host,client}-runner`、`@deepseek-ai/dsh-session-log-export`、`@deepseek-ai/dsh-user-approval`、`@deepseek-ai/dsh-permission-presets`、`@deepseek-ai/dsh-sandbox` 等（registry.npmjs.org）。
- 社区插件搜索：`registry.npmjs.org/-/v1/search?text=dsh`。
