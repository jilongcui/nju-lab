# 平台侧兜底实验工作台 —— 设计方案（2026-09-28）

> **状态：设计稿；有两条并行路径**（见 §2）——
> **路径 A：禁用 5 个消费者插件**（**已实测可行**，零前置条件，代价是缺文件上传/附件/交付物面板）；
> **路径 B：改 CPU 模型**（功能完整，需管理员 + 重启生产 VM）。
> 两条路**都以"容器内转发"为前提**（dsh 硬禁 `--host 0.0.0.0`，与 CPU 无关），该机制**已实测通过**（§4.4）。
> 标 **[已实测]** 的结论均在本机验证过，标 **[待验证]** 的尚需验证。
>
> ⚠️ **2026-09-28 反代实测的重要更正**：早期版本设想的 `https://<域>/lab/ws/<session>/`
> **子路径形态已被实测证伪**（§4.5）——浏览器里的 dsh 把运行时路径全部锚定在 **origin 根**
> （`/api/…`、`/api/remote.mux`、`/plugins/events`、`/plugins/??…`），nginx 改不动这些运行时
> 拼接。正确形态是**每个会话独占一个 authority**：`https://<wsKey>.<工作台域>/`（子域根路径），
> 并且 nginx 必须把**外部 authority** 作为 `Host` 转给容器（否则 WebSocket 一律 403）。
> 该形态已用真实镜像 + 真实后端 + nginx 反代端到端实测通过（HTTP/静态资源/插件包/SSE/WebSocket/
> 越权拦截），**新增前置条件**：泛子域 DNS 解析 + 覆盖泛子域的证书（§4.5 末）。
>
> 关联：`HANDOFF.md` §2.1 · `docs/OPS-2026-09-28-storage-expansion.md` · `nju-lab-craft.md`

---

## 1. 目标与非目标

**目标**：为「本地为主、平台兜底」中的**兜底**场景提供实验环境——学生不装任何东西，
用浏览器打开平台就能获得与本地一致的 dsh 实验环境。

**兜底针对的人群**：没有可用电脑的学生、本地环境装不上的学生（OS/权限限制）、
以及需要"确定一致环境"的教学演示场景。**不是**替代学生本地 DSH（本地仍是主路径）。

**非目标**：
- 不做多人共享的单一环境（必须一人一容器，见 §3）
- 不做容器内的图形桌面/IDE（只提供 dsh 本身的交互界面）
- 不替代服务端复验（复验仍走现有 `DockerEvaluationRunner`）

---

## 2. 两条并行路径：禁用插件 / 修 CPU

### 2.1 阻塞链条 **[已实测]**

```
本机 CPU 只有到 SSE2（无 SSE4.2/POPCNT）
   → sharp 的官方 prebuilt 二进制拒绝加载
      → 插件 attachment-local 不可用
         → attachments / fileUploads 服务缺失
            → dsh-web-app 的 3 个核心插件无法激活，dsh web 启动即崩
```

实测报错（`dsh --profile web`）：

```
Error: dsh: plugin tree failed to load: ... attachment-local ...:
Cannot read properties of undefined (reading 'endsWith')
TypeError ... at node_modules/sharp/dist/sharp.mjs:115:19
```

即便用 `--patch` 禁掉 `attachment-local`，也只是把崩溃点后移：

```
dsh: 3 entries did not activate
@deepseek-ai/dsh-api-session-controller: pending (waiting for services: attachments, fileUploads)
@deepseek-ai/dsh-client-file-upload:       pending (waiting for service: attachments)
@deepseek-ai/dsh-client-ui-deliverables:   pending (waiting for service: sessionController)
```

**为什么复验没受影响** **[已实测]**：复验走 headless，profile 里已显式禁用 `attachment-local`
（`server/verify-image/profile/nju-lab-verify/cordis.patch.yml`），headless 不需要附件服务。

⚠️ **更正（2026-09-28 实测）**：本文早期版本在这里写过"**web 绕不过去**"——**那是错的**。
准确结论是：**单关 `attachment-local` 绕不过去**（消费者会挂起），
但**把它的消费者一并禁掉就绕过去了**，web 可正常启动且 UI 主干完整。见 §2.2 路径 A。

本机实测指令集（对比现代 CPU）：

```
本机:  ... mmx fxsr sse sse2 ht ... pni cx16 x2apic ...        ← 只有到 SSE2
现代:  ... sse sse2 ... sse4_1 sse4_2 popcnt avx avx2 fma ...   ← 多出这些
```

### 2.2 路径 A：禁用消费者插件 **[已实测可行，零前置条件]**

原理：`attachment-local` 是 `attachments` / `fileUploads` 服务的**提供者**，不是可选功能开关。
禁掉提供者后消费者插件会永远 pending，dsh 判定插件树加载失败而退出。因此必须**连消费者一起禁**。

实测的 5 个插件（`dsh --profile web --dump-config` 可核对 id）：

| 插件 id | 包名 | 失去的能力 |
|---|---|---|
| `attachment-local` | `@deepseek-ai/dsh-attachment-local` | 附件本地处理（sharp 依赖的根） |
| `session-controller` | `@deepseek-ai/dsh-api-session-controller` | 服务端会话控制器 |
| `file-upload` | `@deepseek-ai/dsh-client-file-upload` | UI 文件上传 |
| `ui-attachment` | `@deepseek-ai/dsh-client-ui-attachment` | 附件显示 |
| `ui-deliverables` | `@deepseek-ai/dsh-client-ui-deliverables` | 交付物面板 |

patch 文件（经 `--patch` 传入）：

```yaml
- id: attachment-local
  disabled: true
- id: session-controller
  disabled: true
- id: file-upload
  disabled: true
- id: ui-attachment
  disabled: true
- id: ui-deliverables
  disabled: true
```

实测结果：**dsh web 正常启动**（index 返回 HTTP 200、25893 字节），client 插件清单里
对话 / 工具 / 技能 / 工作区 / 会话 / 模型选择 / 审批等主干全部在列，被禁的 5 个不在列。

⚠️ **边界**：
- 这是 **hack，不是 dsh 支持的配置**，依赖其内部插件依赖关系。`DSH 版本锁定 0.1.5-rc.2、学期内不升级`
  （`HANDOFF.md` §2），本学期稳定——**升级 dsh 时必须重新验证这个 patch**。
- 已验证的是"UI 能完整加载"，**尚未在浏览器里跑通一次完整实验流程**；
  `session-controller` 缺失的实际影响需浏览器实测确认。

### 2.3 路径 B：修 CPU 模型 **[功能完整，需重启]**

把 VM 的 CPU 模型改为 **`host-passthrough`**（或任何 ≥ Nehalem / 支持 x86-64-v2 的模型）。
这是 `HANDOFF.md` §2.1 注意③ 早就给出的建议，当时因复验路径可绕过而未执行。

验证：

```bash
grep -o -E "sse4_2|popcnt|avx" /proc/cpuinfo | sort -u
```

⚠️ **改动需关机重启**，该机同时运行生产 MySQL、nju-lab 后端、dify 容器与复验代理——
必须安排维护窗口并先备份。

**与路径 A 的关系**：CPU 修好后 sharp 可用，**就不再需要禁那 5 个插件**，可拿回完整功能。
两条路**并行推进**（2026-09-28 决定）：短期用 A 立刻可用，B 到位后切回完整功能。

### 2.4 两条路的取舍

| | 路径 A（禁插件） | 路径 B（修 CPU） |
|---|---|---|
| 前置条件 | 无 | 管理员 + 重启生产 VM |
| 功能完整度 | 缺文件上传 / 附件 / 交付物面板 / 会话控制器 | 完整 |
| 稳定性风险 | 依赖 dsh 内部依赖关系（本版本锁定，可控） | 无 |
| 可撤销性 | 改 patch 文件即可 | 需再重启 |

---

## 3. 与现有架构的关系

`nju-lab-craft.md` 的核心简化是：

> 本方案的核心简化：在线多租户问题被架构消除了。DSH 是单用户本地工具，本方案让它始终在
> **单用户场景**下工作（**学生本地 / 一次性容器**），服务端只有无状态的 Web 服务和批处理。

**本方案不违反这条判断**，理由：

1. 仍然**一人一容器**，容器内是单用户单会话的 dsh——多租户问题没有被引入服务端业务逻辑。
2. craft 文档已明确把"一次性容器"列为 DSH 的合法运行场景之一，本方案是它的自然延伸。
3. 服务端新增的只是**容器编排 + 路由转发**，不新增任何共享的可变业务状态。

同时必须承认：本方案**对抗了 dsh 的一项设计意图**——dsh 刻意把自己做成
"不能被网络访问的单用户本地工具"（连 `--host 0.0.0.0` 都硬性拒绝，见 §4.4）。
把它的 UI 暴露到网络，是这项设计要防的事。因此**隔离与鉴权是本方案的第一优先级**，不是可选加固。

---

## 4. 架构方案

### 4.1 总览

```
浏览器
  │  https://<wsKey>.<工作台域>/?token=…      ← 每会话独占一个 authority（子域根路径）
  ▼
宿主 nginx ──(auth_request 用 wsKey 换 upstream)──► nju-lab 后端
  │                                                    │
  │  proxy_pass → 容器 IP:9090（Host=外部 authority）    └─► workspace 模块：起容器 / 分配上游 / 回收
  ▼
学生容器（一人一个）
  ├── 容器内 TCP 转发  监听 0.0.0.0:9090  →  127.0.0.1:8080
  ├── dsh web（`nju-lab-workspace` profile，绑定 127.0.0.1）
  ├── workspace 卷   /data/workspaces/<userId>
  └── 网络：internal + SNI 白名单出口（复用复验的 egress 机制）
```

**鉴权不是平台 JWT**：浏览器是**直接导航**到工作台 URL 的（带不上 `Authorization`），
所以 `auth_request` 走的是 `wsKey` **能力凭证**（24→16 字节 hex 随机、仅会话存活期内有效），
配置示例见 `lab-nginx-snippet.conf`；取舍见 §4.6。

### 4.2 镜像（新建，不能复用复验镜像）

复验镜像 `nju-lab-verify` 是 **headless** bundle + 复验驱动，工作台需要 **web-app** bundle +
学生插件。二者应各建各的镜像，共享同一个基座钉版策略。

| 项 | 复验镜像（现有） | 工作台镜像（拟建） |
|---|---|---|
| bundle | `dsh-base` + `dsh-headless` | `dsh-base` + `dsh-web-app` |
| profile | `nju-lab-verify` | `nju-lab-student`（已有，`dsh/profiles/`） |
| 插件 | — | `nju-lab-client` |
| 驱动 | `run-eval.mjs`（跑一次即退） | `dsh --profile ... --port <n> --no-open`（长驻） |
| 基座 | `node:22.23.2-slim`（**钉小版本**） | 同左，**必须同样钉版** |

⚠️ 基座必须钉 `node:22.23.2-slim`：`HANDOFF.md` §2.1 记录了漂浮 tag 会拿到老基底导致
sharp 加载失败、跨机重建全挂。CPU 修好后 sharp 可用，但**钉版纪律不变**。

### 4.3 网络出口（复用复验的 SNI 白名单）

工作台容器需要出网到 LLM API，且学生 Skill 也可能尝试出网。**直接复用复验的隔离机制**：

- `--network <internal 网络>`（无外网路由，DNS 黑洞 + 直连 IP 无路由）
- `--add-host <白名单域名>:<代理 IP>` → 钉到 SNI 代理
- 白名单配置在 `server/verify-image/egress-proxy/nginx.conf`

需要**扩白名单**：除 LLM API 外，还要允许学生容器访问**平台自身的 API**
（`nju-lab-client` 插件要 claim/submit 用）。建议在 internal 网络中直接放行平台后端地址，
不经代理。

### 4.4 反代与 `--host` 限制的绕法

**约束** **[已实测]**：`dsh web --host 0.0.0.0` 被硬性拒绝：

```
error: --host 0.0.0.0 is intentionally not supported yet for safety:
it would expose remote code execution to the network; use 127.0.0.1 instead
```

**绕法**：容器内加一层极简反向代理（`socat` 或 nginx），监听 `0.0.0.0:<proxyPort>`，
转发到 `127.0.0.1:<dshPort>`。dsh 始终绑 `127.0.0.1`，**遵守它的安全约束**，
"暴露到网络"的责任显式落在我们自己写的这一层——这正是它期望的边界划分。

**必须同时配置 `--trusted-host`**：dsh 的 `/api` 有 browser-trust fence，只接受被声明的
authority。外部访问域名（如 `lab.xiaohe.biz`，或 `medai.nju.edu.cn`）要传进去：

```bash
dsh web --port <n> --no-open --trusted-host <外部域>[:port]
```

**[已实测 2026-09-28]**：在 CPU **未**修复的机器上，用「路径 A + 容器内 TCP 转发」验证通过：

| 项 | 结果 |
|---|---|
| 容器内转发（`0.0.0.0:9090` → `127.0.0.1:8080`） | ✅ |
| `-p <宿主端口>:9090` + 从宿主机访问 | ✅ |
| 带 `?token=` 的 GET `/` | ✅ 返回 **303 + Set-Cookie**（正确的鉴权交换） |
| 跟随 303 带 cookie 访问 `/` | ✅ **HTTP 200**，index 正常返回 |
| `--trusted-host <authority>` | ✅ **必需**——不带它 browser-trust fence 直接 401 |

⚠️ **关键细节**：dsh 的 browser-trust fence **只信任显式声明的 authority**，连它自己绑定的
`127.0.0.1:<port>` 都不默认信任。容器内直连 `127.0.0.1:8080` 会 401；
必须把**外部访问所用的那个 authority**（如 `127.0.0.1:19090`、`medai.nju.edu.cn`）经
`--trusted-host` 传入。这一条对工作台的 nginx 反代配置是硬要求。

**[已实测 2026-09-28]**：经**真实 nginx 反代**（容器内 nginx + `auth_request` + 动态 `proxy_pass` +
真实后端 + 真实工作台镜像）逐项验证：

| 项 | 结果 |
|---|---|
| `GET /`（无 token） | ✅ 401（dsh 的 browser-trust fence 生效） |
| `GET /?token=…` | ✅ **303 + Set-Cookie**（cookie 的 `authority` ＝ 它看到的 Host） |
| 带 cookie `GET /` | ✅ 200，`<title>DeepSeek Harness</title>` |
| 静态资源 `/assets/index-*.js` | ✅ 200（555 KB） |
| 插件包 `/plugins/??…`（49 个 client.js 合并） | ✅ 200（10.9 MB） |
| RPC `POST /api/<endpoint>` | ✅ 到达容器（dsh 回 404 `not found`，即请求确实进了 dsh） |
| **WebSocket `/api/remote.mux`** | ✅ **101 Switching Protocols**（`Upgrade` 转发正确） |
| SSE `/plugins/events` | ✅ 200 `text/event-stream`（需 `proxy_buffering off`） |
| 伪造 wsKey | ✅ 403（`auth_request` 拦截） |
| WS 的 `Origin` 换成别的域 | ✅ 403 `forbidden`（跨站防线，行为正确） |

⚠️ **WebSocket 的 Origin 校验是本方案最硬的一条约束**（实测）：dsh 会校验 WS 请求的 `Origin`
与它看到的 `Host`（及其授权列表）是否一致 —— 把 `Host` 传成**容器 IP** 时，HTTP 全部正常、
**WebSocket 一律 403**。所以 nginx **必须** `proxy_set_header Host $http_host`（外部 authority），
而后端必须把该 authority 经 `WORKSPACE_TRUSTED_HOSTS` 传进容器
（已实现：按 `WORKSPACE_PUBLIC_BASE` 里的 `{key}` 自动展开成 per-session authority）。

### 4.5 路由：必须走容器 IP **[已实测，原方案已更正]**

⚠️ **早期版本本节建议"动态宿主端口映射"，那是错的**——2026-09-28 实测：

```
docker run --network <internal> -p 127.0.0.1:21000:9090 ...
  → 容器内 `Ports` 只有 `9090/tcp`，`docker port` 为空
  → 宿主 21000 无监听、连接被拒
```

**`--internal` 网络的容器不会建立端口发布**（`-p` 静默失效）。

**实际可行的是容器 IP 直连**：宿主对该网段有直连路由
（`br-xxxx` 上的 `172.18.0.1/16`），实测宿主直连容器 `IP:9090` 行为完全正确
（无 token → 401、带 token → 303）。

因此路由方案确定为：

| 项 | 做法 |
|---|---|
| 目标 | 容器在隔离网络里的 `ip:9090` |
| 后端 | `ContainerRuntime.containerIp()` 取 IP，随 `workspace.status` 返回 `upstream` |
| nginx | `auth_request` 拿到 `X-Workspace-Upstream`，用它做 `proxy_pass` |
| 稳定性 | 容器 IP 在**容器生命周期内不变**；后端每次 `start` 重新取（无需自己维护端口池） |

> 副作用（正向）：不需要端口池、不会端口耗尽；但**容器 IP 不可达公网**，
> 所以外部访问**必须**经 nginx（这也正是我们想要的收敛点）。

### 4.5.1 路径形态：必须「独占 authority」（子路径方案已被实测证伪）**[已实测 2026-09-28]**

早期版本（本文档 §4.1 与 `lab-nginx-snippet.conf` 的旧版）设想的是
`https://lab.xiaohe.biz/lab/ws/<session>/?token=…` —— **子路径 + 响应体文本改写**。**走不通**：

浏览器里的 dsh 把运行时路径全部锚定在 **origin 根**，与页面所在路径无关：

| 客户端会请求的路径 | 出处 |
|---|---|
| `new URL("/api/<endpoint>", location.origin)` | `dsh-client-connection` 的 RPC 发送器 |
| `wss://<origin>/api/remote.mux` | Remote stream 多路复用（WebSocket） |
| `/plugins/events`（EventSource） | client-hmr 的事件流 |
| `"/plugins/??…"`（index.html 里的绝对路径） | 插件包 preload / script |
| `/open-in-app/{apps,open,icon}` | open-in-app 插件 |

nginx 只能改**响应体文本**（`sub_filter`）与**重定向头**（`proxy_redirect`），改不了运行时用
`location.origin` 拼出来的字符串。实测对照（同一个 nginx，两种 server 形态）：

| 客户端真实行为 | 子路径 `/lab/ws/<key>/` | 独占 authority `<key>.<域>/` |
|---|---|---|
| `GET …?token=…`（入口交换） | ✅ 303（改回带前缀） | ✅ 303（原生 `location: /`，无需改写） |
| `GET` 带 cookie | ✅ 200，`sub_filter` 也成功改了 `<base href>` 与 `"/plugins` | ✅ 200（原生正确） |
| `POST /api/…`（**客户端实际发的绝对路径**） | ❌ **502** —— 命中宿主根的 `/api`（njuserver 上是 dify） | ✅ 200 / 404（到达 dsh） |
| `/plugins/events`（绝对路径） | ❌ 404 | ✅ 200 `text/event-stream` |
| `wss://…/api/remote.mux` | ❌ 同一原因必失败 | ✅ 101 |

**结论**：工作台必须**独占一个 authority** → `https://<wsKey>.<工作台域>/`。
一人一子域；nginx 从 `Host` 取 `wsKey` → `auth_request` → `proxy_pass`（见 `lab-nginx-snippet.conf`）。

⚠️ **由此新增的部署前置条件（不落实则该形态上不了线）**：

1. **泛子域 DNS**：`*.<工作台域>` 解析到宿主。
   ⚠️ njuserver 的对外入口是校园网关按 **Host** 分发的 `medai.nju.edu.cn`（见 `HANDOFF` §2.1），
   子域能否被网关/校内 DNS 放行**须在真实链路上确认**；若不行，备选是换一台可自控
   Host 与证书的机器承载工作台（与 §7 的"换机器"选项合并考虑）。
2. **证书**：覆盖 `*.<工作台域>`。否则 `?token=` 会明文过链路（这是**唯一的**凭证）。
3. 后端 `WORKSPACE_PUBLIC_BASE=https://{key}.<工作台域>`（`{key}` 必填，见 `workspace.config.ts`）。

⚠️ **wsKey 必须是大小写安全编码**（现为 16 字节 hex）：它作为**子域**出现，而 URL 规范与浏览器
都会把 hostname 小写化（`new URL(...).host` 亦然）。用 base64url 时 key 会被改写，
`auth_request` 拿小写 key 查不到会话 → 一律 403（实测踩过）。

### 4.6 鉴权（第一优先级，不可省）

学生 A **绝不能**访问学生 B 的容器。建议：

1. nginx `auth_request` 子请求 → 平台后端校验平台 JWT 有效性
2. 后端返回该用户的 workspace 会话是否有效，并**校验 session 归属该用户**
3. 只有归属校验通过才 `proxy_pass`

⚠️ 不要用"URL 里带不可猜 ID"当权限（现有 `GET /api/files/:id` 的 UUID 能力凭证模式
在文件下载场景可接受，但工作台是**长驻的远程代码执行入口**，不能靠"猜不到"来保护）。

**[已实测 2026-09-28]**：`auth_request` 形态已逐项验证 —— 伪造 `wsKey` → **403**、
无 token 直接访问 → **401**（dsh 的 browser-trust fence）、
`Origin` 与 authority 不一致的 WebSocket → **403**。

⚠️ **当前 `wsKey` 就是唯一凭证**（浏览器带不上 JWT，`proxy-auth` 只能按 key 找会话）：
因此 ① 必须 HTTPS（`?token=` 与 cookie 都会明文过链路）、② 会话回收/后端重启后 key 立即失效
（内存态，已实现）、③ 上线前应补"同一 IP/UA 的并发会话上限"之类的滥用护栏。
**仍待办**：把 `wsKey` 与平台账号绑定校验（例如 start 时写入 `wsKey → userId`，
`proxy-auth` 同时校验来源），以便日后给"工作台入口页"加二次确认。

### 4.7 生命周期

| 事件 | 动作 |
|---|---|
| 学生点「启动实验」 | 起容器 → 等 dsh web 就绪 → 返回访问 URL **[已实测：就绪检测＝读容器日志里的 `WORKSPACE_TOKEN=`；`start` 立即返回 `starting`，前端轮询 `status` 惰性推进，避免把 20-30s 的启动阻塞在请求里]** |
| 空闲超时 | 回收容器（同时回收端口） |
| 学生点「结束实验」 | 立即回收 |
| 后端重启 | 需要能识别并回收孤儿容器（建议容器打 label，如 `nju-lab-workspace=<userId>`） |

⚠️ **启动耗时问题** **[已实测]**：dsh web 启动期间 CPU 会跑到 100%+ 且持续 20-30 秒
（推测在做插件加载/前端准备）。这对"点了就能用"是明显延迟，方案上需二选一：

- **按需启停**：省资源（实测 15 个容器仅占 ~1G），但要接受启动等待
- **预热池**：常驻少量已就绪容器，学生来了直接分配；资源占用上升

建议先做**按需启停**，实测体验后再决定是否加预热池。

### 4.8 workspace 持久化

容器本身一次性，但学生的**实验数据**应有归宿：

- 挂载 `/data/workspaces/<userId>`（`/data` 已在 2026-09-28 扩容中建好，957G）
- 学生提交物仍走现有平台 API（claim/submit），**不依赖容器内数据**
- 因此容器可以随时回收，不丢已提交的成果

---

## 5. 容量与限额（基于实测）

### 5.1 实测数据 **[已实测]**

| 指标 | 实测值 | 方法 |
|---|---|---|
| 单会话稳态内存（独占） | **132 MB** | 容器内跑 dsh 并卡在网络等待 |
| 单会话内存（15 并发时） | **≈70 MB** | 15 容器并发，宿主 used 增量 1047MB ÷ 15 |
| 15 并发总增量 | **+1047 MB** | 宿主 used 2260→3307MB |
| 15 并发 CPU 影响 | **load 0.53 → 0.56** | 几乎无变化，证实是 IO 等待型负载 |
| 空 node 容器 | 7.4 MB | —— |
| dsh web 启动期峰值 CPU | **>100%（持续 20-30s）** | 插件加载阶段 |
| **dsh web 空闲稳态内存** | **≈233 MB** | 路径 A（禁 5 插件）下 web UI 启动后空闲 |

> ⚠️ 前 4 行是 **headless 口径**（复验 profile）。**web 形态更高**：空闲即 ~233MB，
> 真实会话（工具调用、上下文增长）会再高。§5.2 的 1g 限额对 web 仍有余量，但**这是 web 形态
> 唯一直接实测过的点、且只测了空闲态**——上线前必须按 §9 第 2 项补并发实测。

内存下降（132MB→70MB）来自**容器共享镜像页**（同一 node 二进制 + dsh 模块被 15 个容器共享），
这是容器化的密度红利。

### 5.2 建议限额

| 项 | 值 | 依据 |
|---|---|---|
| `--memory` | **1g** | 实测 70-132MB，余量充足；与复验一致 |
| `--cpus` | **0.5** | 稳态 CPU 近 0；但要给启动期留量，故不设更小 |
| 同时在线上限 | 按内存反推 | 30 人 × 1g = 30G（上限口径）· 实际占用 ~2G |

外推：30 人 ≈ 2.1G 实际占用，60 人 ≈ 4.2G —— 对 28G available 毫无压力。

---

## 6. 改造点清单

| # | 位置 | 改动 | 规模 | 状态 |
|---|---|---|---|---|
| 1 | `server/workspace-image/`（新建） | Dockerfile + profile 拷贝 + 容器内转发脚本 | 与 `verify-image/` 同构，小 | ✅ 已完成并实测 |
| 2 | `server/src/workspace/`（新建） | workspace 模块：起停容器、就绪探测、空闲回收、孤儿清理 | 中，可大量参考 `docker-evaluation-runner.ts` | ✅ 已完成并实测 |
| 3 | `server/src/submissions/docker-evaluation-runner.ts` | **抽取**通用容器编排能力供两处复用（限额/网络/白名单/挂载） | 中，属重构 | ✅ 已完成（`server/src/container-runtime/`） |
| 4 | `server/verify-image/egress-proxy/nginx.conf` | 白名单加上平台自身 API 地址 | 小 | ⏳ 待办（§8.5-5） |
| 5 | 宿主 nginx | 工作台 **独立 server 块**（子域 + `auth_request` + 动态 `proxy_pass`） | 小 | ✅ 配置形态已实测（`lab-nginx-snippet.conf`）；**宿主机上尚未部署** |
| 6 | `web/` 前端 | 新增「进入实验环境」入口页（启动/轮询/进入/结束） | 小 | ⏳ 待办（§8.5-3） |
| 7 | `/etc/systemd/system/nju-lab.service` | 确认 `docker.sock` 访问权限（workspace 模块要调 docker） | 小 | ✅ 已具备 |
| 8 | `server/src/workspace/workspace.service.ts` + `workspace.config.ts` | **per-session 对外 authority**：`WORKSPACE_PUBLIC_BASE` 支持 `{key}`，展开后自动进容器的 `--trusted-host`；`wsKey` 改 16 字节 hex（大小写安全） | 小 | ✅ 已完成（2026-09-28 反代实测导出，见 §4.5.1） |

> 第 3 项是关键：**不要让工作台复制一份容器编排逻辑**，否则限额/白名单/隔离策略会在两处漂移。
> 现有 `runContainer()`（`docker-evaluation-runner.ts:243`）已封装了限额、internal 网络、
> SNI 白名单、只读挂载——应抽成共享模块。

---

## 7. 形态对比

| 形态 | 可行性 | 学生体验 | 备注 |
|---|---|---|---|
| **web + 路径 A（禁插件）** | ✅ **已验证可启动** | 网页，缺文件上传等 | **零前置条件**，短期首选（见 §2.2） |
| **web + 路径 B（修 CPU）** | ✅ 根治 | 完整网页体验 | 需 ZStack 管理员 + 重启（见 §2.3） |
| 终端形态（ttyd/wetty + `dsh` CLI） | ✅ 可用 | 终端界面，非网页 | headless 不需要 attachments，走复验同款 profile；比 web 更省事但体验差异大 |
| 换机器（CPU 正常的） | ✅ | 同 web 形态 | 顺带解决"与生产 MySQL 同机"的隔离风险 |

**当前决定（2026-09-28）：路径 A 与路径 B 并行**——A 立刻可用作过渡，B 到位后切回完整功能。
终端形态保留作为 A/B 都不可用时的兜底。

---

## 8. 风险清单

| 风险 | 级别 | 缓解 |
|---|---|---|
| 学生容器与**生产 MySQL 同机**，逃逸即数据泄露 | 🔴 高 | 非 root、cap-drop、只读根、pids 限制、断网白名单、**一次性不复用**；长期建议迁到独立机器 |
| 鉴权绕过导致学生互访容器（远程代码执行） | 🔴 高 | 服务端归属校验，**禁止用不可猜 ID 当权限** |
| CPU 修改需重启，中断生产 | 🟠 中 | 维护窗口 + 重启前备份 + 确认容器 `--restart` 策略 |
| 端口/容器泄漏（后端崩溃后孤儿容器） | 🟠 中 | 容器打 label，后端启动时扫描回收 |
| `sharp` 在 CPU 修复后仍失败 | 🟡 低 | 修复后立即复测 §2.1 的链条 |
| 启动延迟（20-30s）影响上课体验 | 🟡 低 | 先按需启停实测，必要时加预热池 |

---

## 9. 待验证清单

**已在 2026-09-28 验证**（见 §2.2 / §4.4 / §4.5.1）：
- ✅ 路径 A：禁 5 个消费者插件后 `dsh --profile web` 正常启动，UI 主干完整加载
- ✅ 容器内转发（`0.0.0.0` → `127.0.0.1`）+ 端口映射 + 从容器外访问
- ✅ `--trusted-host` 的必要性（不带则 401），以及 `?token=` → 303 + cookie 的鉴权交换
- ✅ **nginx 反代**（真实后端 + 真实镜像 + `auth_request` + 动态 `proxy_pass`）：
  401 / 303+cookie / 200 index / 静态资源 / 插件包（10.9 MB）/ RPC / **WebSocket 101** / SSE 200 /
  伪造 wsKey 403 / 跨域 Origin 403（§4.4 表）
- ✅ **反代路径形态定案**：子路径 `/lab/ws/<key>/` **证伪**，改为「子域独占 authority」；
  连带定出 `Host` 必须传外部 authority、`wsKey` 必须大小写安全（§4.5.1）
- ✅ **就绪探针**：`start` 立即返回、`status` 惰性读容器日志里的 `WORKSPACE_TOKEN=`（§4.7）
- ✅ 孤儿容器回收（后端重启时按 label 回收上一次的容器，多次实测）

**仍待验证**（按优先级）：

1. **在浏览器里跑通一次完整实验流程**（claim → 开发 → 自测 → 提交）——验证 `session-controller`
   缺失的实际影响。**这是路径 A 能否真正上线的关键前提。**
   本次反代实测只覆盖 HTTP/WS/SSE 层与静态资源，**没有跑过 JS**（无浏览器）。
2. 并发 15-30 个 **web** 进程（而非 headless）的真实内存/CPU——§5.1 的 web 数据只有空闲态
3. ~~nginx 反代下的静态资源路径与 WebSocket 正确性~~ ✅ 已实测（§4.4）；
   **但仍是"容器内 nginx 测试实例"**，宿主机（真实 `cms.conf` / 校园网关）上的部署与
   泛子域 DNS/证书尚未做（§4.5.1 的前置条件）
4. ~~dsh web 的就绪探针~~ ✅ 已实现并实测（§4.7）
5. 路径 B 完成后：`grep -o -E "sse4_2|popcnt" /proc/cpuinfo` 确认指令集到位，并复测 §2.1 的链条
6. 路径 B 完成后：去掉禁插件 `--patch`，确认 web 恢复完整功能
7. **泛子域 DNS + 泛证书**能否在目标环境落地（§4.5.1）——决定工作台挂在 njuserver 还是另找机器
