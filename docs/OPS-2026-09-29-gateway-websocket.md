# 校园网关 WebSocket 透传 —— 需求说明与配置

- 日期：2026-09-29
- 对象：承载 `medai.nju.edu.cn` 的反向代理 / 校园网关（TLS 终止那一层）
- 相关：`HANDOFF.md` §8.3 第 7 条、§8.5 第 1.5 条 · `docs/DESIGN-2026-09-28-platform-workspace.md` §4.6.1
- 用途：**上方正文可直接转发给网络中心**；末尾「我方后续动作」是内部内容，转发时请删除

---

## 一句话

`https://medai.nju.edu.cn` 后面的实验环境（NJU-Lab，页面在 `/lab/`）需要 WebSocket
才能正常交互。目前网关没有把 WebSocket 升级请求透传到我们的服务器，请在网关侧开启
WebSocket 透传。

## 现象与证据

1. 浏览器侧 `wss://medai.nju.edu.cn/api/remote.mux` 一直失败（前端反复报 `connection lost, retry #N`）。
2. 我们服务器 access.log 里对应的请求是 **`404` / 45 字节** —— 既不是应用服务器的 404
   （9 字节 `not found`），也不是我们 nginx 的 403/502。
3. 该 404 响应**不带 `Server:` 头**；而我们服务器直出的响应带 `Server: nginx/1.18.0`。
   ⇒ 这个 404 是**网关自己回的**，说明升级请求根本没有以「升级」形态到达我们。
4. 对照实验（完全绕开网关，直连我们服务器、带完整升级头）→ **`101 Switching Protocols`**；
   同一 URL 若剥掉 `Upgrade`/`Connection` 头 → 应用返回 404。
5. ⇒ 我们这一层（nginx 反代 + 应用 + 工作台容器）链路完好，**唯一缺的就是网关的升级透传**。

## 需要改什么

- **对象**：承载 `medai.nju.edu.cn` 的反向代理（TLS 终止那一层）。
  实测链路（2026-09-29）：`客户端 → 219.219.122.131（反解 paper.nju.edu.cn）→ 10.28.128.56:80`，
  内网方向只有这一跳。
- **范围**：**整个站点**都要放行 WebSocket 升级，至少 `/api/**` 这条转发规则。
- ⚠️ **`/api/**` 必须原样转发到我们的服务器**，不要被网关自己的服务截胡 ——
  请求该归谁由我们这层按会话 cookie 判定，网关只负责透传。
- **原因**：实时通道是应用**写死在 origin 根**的 `/api/remote.mux`（不是 `/lab/` 子路径），
  且它是该应用会话事件流的唯一通道（`/plugins/events` 那类 SSE 只负责插件热重载，
  不能替代）。所以**只对 `/lab/` 放行是不够的**。

### 改动清单（全部放在**同一个** proxy location 里）

```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade    $http_upgrade;
proxy_set_header Connection $connection_upgrade;
proxy_set_header Host       $http_host;     # ← 漏了它 WebSocket 一律 403（见下）
proxy_read_timeout  3600s;                  # ← 否则空闲的 WS 会被掐（见下）
proxy_send_timeout  3600s;
```

| 行 | 必要性 | 现状（2026-09-29 实测） |
|---|---|---|
| `proxy_http_version 1.1` + `Upgrade` + `Connection` | **必须** | ✅ 已生效（抓包确认） |
| `proxy_set_header Host $http_host` | **必须** | ✅ 已生效（2026-09-29 抓包复验：上游传出的 Host 已由内网 IP 变为 `medai.nju.edu.cn`） |
| `proxy_read_timeout` / `proxy_send_timeout` | **建议** | ⚠️ **抓包看不出**（据我方反馈已加）；实际效果需在真实使用中观察——若闲置十几分钟后仍会断，说明这条没落到点上 |

下面两节分别说明后两项。

### ⚠️ `Host` 也必须一起改 —— 漏了它等于没改（实测）

抓包实测（2026-09-29，见文末「当前实测状态」）：升级头已经透传成功，**但 `Host` 被改写成了
后端的内网地址**：

```
GET /api/remote.mux HTTP/1.1
Host: 10.28.128.56          ← ❌ 必须是 medai.nju.edu.cn
Upgrade: websocket          ← ✅ 已透传
Connection: upgrade         ← ✅ 已透传
```

原因：nginx 反代**不写 `proxy_set_header Host` 时，默认填 `$proxy_host`**，也就是 `proxy_pass`
的目标地址。所以必须显式补一行：

```nginx
proxy_set_header Host $http_host;      # 原样透传客户端请求里的外部域名
```

**为什么这是硬要求**：实验工作台前端对 WebSocket 做 browser-trust 校验 —— 会核对
`Origin`（`https://medai.nju.edu.cn`）与它看到的 `Host` 是否受信任。**`Host` 是内网 IP 时，
HTTP 全通、WebSocket 一律 403**（我们此前已实测确认过这个行为）。外部表现就是
「页面能打开，但一直 `connection lost, retry #N`」。

> 顺带：抓包里还有一个 `Connection: keep-alive` 与 `Connection: upgrade` **并存**的情况
> （两个 `Connection` 头）。规范上同一个 `Connection` 头应只有一个值，建议合并成
> `proxy_set_header Connection $connection_upgrade;` 一条。

### 如果网关是 nginx

```nginx
# ① map 必须定义在 http {} 层 —— nginx 不允许写在 server{} / location{} 里
#    （若已有同名 map，复用即可，不要重复定义）
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
```

```nginx
# ② 三条 proxy 指令写在**真正 proxy_pass 到我们服务器的那几个 location 里**，
#    不要写在 server 层（原因见 ③）。

#    ⚠️ 下面 location 的路径只是**举例**，请用你们实际承载 medai 的那条反代规则：
#       · 若你们是一条 `location /` 反代整个站点 → 加在那一条里即可（最省事，推荐）
#       · 若是按路径分了几条 → **至少**要覆盖根路径 `/api/`（见下面「路径说明」）
location /api/ {
    proxy_pass http://<我们的服务器>;              # ← 原样不动

    proxy_http_version 1.1;
    proxy_set_header Upgrade    $http_upgrade;
    proxy_set_header Connection $connection_upgrade;

    # ⚠️ 这个 location 里原有的 proxy_set_header（Host / X-Real-IP / X-Forwarded-For …）
    #    必须原样保留在这里，一条都不能少 —— 原因见 ③
}
```

**路径说明（重要，容易搞混）** —— 需要透传的是**根路径 `/api/`，不是 `/lab/api/`**：

| 路径 | 是什么 | 需要 WS 透传吗 |
|---|---|---|
| `/api/remote.mux`（**根路径**，无 `/lab` 前缀） | 实验工作台前端的实时通道 | ✅ **必须** |
| `/lab/api/**` | 平台自己的 REST API（普通 HTTPS，无 WebSocket） | ❌ 不需要（加了也无害） |

原因：工作台前端把运行时路径**锚定在 origin 根** —— 页面虽然开在 `/lab/ws/<key>/` 下，
它的 WebSocket 却打在 `wss://medai.nju.edu.cn/api/remote.mux`，**不带任何前缀**。
所以只对 `/lab/` 或 `/lab/api/` 放行，WS 依然通不了。

③ **为什么必须写在 location 里，而不是图省事写在 server 层**：nginx 的 `proxy_set_header`
**不累积，是整组替换**。官方文档原文：

> These directives are inherited from the previous configuration level **if and only if**
> there are no `proxy_set_header` directives defined on the current level.

也就是说：只要某个 `location` 里**自己写了哪怕一条** `proxy_set_header`（反代配置里几乎必然
要写 `Host`，如上例），那么 `server{}`/`http{}` 层写的那些**对这个 location 全部作废**。
把 Upgrade/Connection 放 server 层，极可能一条都没生效，而配置看上去「已经加了」，非常难查。
（既有的 `X-Forwarded-For` / `X-Real-IP` 之类也是同理 —— 这是 nginx 的既有行为，不是本次改动引入的。）

④ **最常见的漏改点**：如果该 location 里**已有** `proxy_set_header Connection close;`
（或 `Connection ""`），它会盖掉新加的 `$connection_upgrade` → 必须删掉，或改成
`$connection_upgrade`。

⑤ 校验并生效：`nginx -t && nginx -s reload`

⑥ 若你们**有多条**反代到 medai 的规则（或 80/443 各一套），把 ② 那 3 行放进一个 snippet
文件、在每个需要的 location 里 `include` 它，比逐处粘贴更不容易漏（nginx 官方推荐写法）。

**可以把整个站点（`location /`）都加上吗？—— 可以，而且更省事**：那 3 条只对**带 `Upgrade` 头**
的请求产生实质效果；普通请求不会被升级，站内其它系统的行为不变（它们本来也不会发 `Upgrade`；
即便发了，后面没有对应处理逻辑，也只是当普通请求走）。
整站加上还有个实际好处：工作台前端**写死在根路径的入口不止 `/api/`**（还有 `/plugins/`、
`/open-in-app/`，将来可能更多），整站透传一次到位，不用跟着我们改。

> （可选）如果你们原本靠 `proxy_set_header Connection "";` 给上游开启 keepalive 复用，
> 注意 `$connection_upgrade` 在非 WS 请求上给的是 `close`，会让复用失效。想两全，把 map 中
> `''` 对应的值改成空串（而不是 `close`）即可 —— 不影响 WS，按现网情况取舍。

**关于 80 端口那个 server 块**：`wss://` 走的是 443。80 那个块**只有在它自己也直接
`proxy_pass` 到我们服务器（而不是 `return 301 https://…`）时才需要改**；如果它只是
跳转到 https，改它是多余的。

**⚠️ 别忘了同一条 location 里的读超时**：`proxy_read_timeout` 的默认值是 **60s** —— WebSocket
是**有静默期**的长连接（用户不操作时没有任何数据），60 秒一到网关就会把连接掐掉，表现是
「能连上、但隔一会儿断一次」，看起来很像"配置没生效"，其实坏在超时。如果你们这条 location
没单独设过它，请一并加上（我们这侧已经是 3600s）：

```nginx
proxy_read_timeout 3600s;
proxy_send_timeout 3600s;
```

**只加 `proxy_http_version 1.1;` 是不行的**：还必须要有 `Upgrade` + `Connection` 两条显式透传，
目标服务器才会回 101。这三条（`proxy_http_version` + `Upgrade` + `Connection`）写在
**同一个 location** 里最稳。

#### 把改动拼起来：完整结构示意（http → server → location 三层）

下面把前面的 ①②③ 与「读超时」拼成一个完整骨架。**`【原有】`/`…` 处按你们现网的实际内容填，
不要照抄我的写法**；只加 `【新增】` 标记的那几行：

```nginx
http {
    # … 你们 http 层原有的配置 …

    # 【新增】WebSocket 升级用的 map —— 只能放 http 层；若已有同名 map，复用即可
    map $http_upgrade $connection_upgrade {
        default upgrade;
        ''      close;
    }

    # ────────── 443：承载 medai.nju.edu.cn（wss:// 走这里）──────────
    server {
        listen 443 ssl;
        server_name medai.nju.edu.cn;
        # … 你们原有的 ssl_certificate / ssl_certificate_key / 认证相关配置，一律不动 …

        # 【情形 A·推荐】如果你们是一条 location / 反代整个站点，就改这一条
        location / {
            proxy_pass http://<我们的服务器>;           # 【原有】目标地址不动

            # ⚠️ 这个 location 里**原本已有的** proxy_set_header，一条都不能删
            #    （整组替换语义，见 ③）。我们抓包看到：现网这条 location 只生效了一条
            #    默认的 `Host $proxy_host`，**没有** X-Real-IP / X-Forwarded-For。
            #    → 所以下面只需改 Host、再追加三行；**不用**凭空新增 X-Real-IP 之类。
            proxy_set_header Host        $http_host;     # ← 【必改】原来没写 = 默认 $proxy_host（内网 IP）

            # 【可选】如果你们原本就有这两条，原样保留在这里即可（与 WebSocket 无关，
            #   dsh 只看 Host；它们是你自己的日志/统计在用）。原本没有就别为了这次改动新增：
            #     proxy_set_header X-Real-IP       $remote_addr;
            #     proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

            # 【新增 1】WebSocket 升级透传（必须与上面的 proxy_set_header 在同一 location 里）
            proxy_http_version 1.1;
            proxy_set_header Upgrade    $http_upgrade;
            proxy_set_header Connection $connection_upgrade;

            # 【新增 2】长连接静默期放宽（默认 60s 会掐掉空闲的 WS）
            proxy_read_timeout 3600s;
            proxy_send_timeout 3600s;
        }
    }

    # ────────── 80：仅当它也直接 proxy_pass 到我们服务器时才需要改 ──────────
    server {
        listen 80;
        server_name medai.nju.edu.cn;
        return 301 https://$host$request_uri;       # ← 这种「只跳转」的情形：不用动
    }
}
```

**【情形 B】若你们是按路径分了几条 location**：把上面 `【新增 1】【新增 2】` 那 6 行
**复制进每一条**真正 `proxy_pass` 到我们服务器的 location 里 —— **至少**要覆盖 `/api/`
（WS 实际打在这里，见上面的「路径说明」）；`/plugins/`、`/open-in-app/` 建议一并加上
（或用 ⑥ 的 snippet + `include` 一次搞定）；`/lab/`、`/lab/api/` 加不加都不影响功能。

### 如果是 F5 / WAF / 其他负载设备

- 开启对应的「WebSocket 支持 / Upgrade 透传」开关；
- 同时确认**连接空闲超时**不要小于几分钟 —— 应用侧是长连接，空闲是正常现象。

## 怎么验证改对了

改完之后，从校园网发起一次带升级头的请求，看响应头里是否出现
`Server: nginx/1.18.0`（= 请求已经到了我们的服务器），而不是现在这种无 `Server:` 头的 45 字节 404：

```bash
curl -sS -D- -o /dev/null \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  https://medai.nju.edu.cn/api/remote.mux
```

最终判定以浏览器实测为准：打开 `https://medai.nju.edu.cn/lab/` 进入实验环境，
DevTools → Network → WS，应看到 `/api/remote.mux` 返回 **`101 Switching Protocols`**，
且页面不再刷 `connection lost, retry #N`。

## 当前实测状态（2026-09-29）

链路（内网方向只有一跳，校外 `219.219.115.199` 那台 CAS 网关不在这条路上）：

```
客户端 ──► 219.219.122.131（反解 paper.nju.edu.cn）──► 10.28.128.56:80 （njuserver）
```

抓包复现（在**后端服务器上**跑；这一跳是明文 HTTP，所以只有在这里才看得到请求头 ——
客户端到 122.131 那段是 HTTPS，到内网抓只能看到密文）：

```bash
sudo bash -c 'timeout 25 tcpdump -i any -A -s0 -l "tcp port 80 and host 219.219.122.131" > /tmp/wsdump.txt 2>/dev/null & sleep 2; curl -skS -o /dev/null --resolve medai.nju.edu.cn:443:219.219.122.131 -H "Connection: Upgrade" -H "Upgrade: websocket" -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" https://medai.nju.edu.cn/api/remote.mux; sleep 4; kill %1 2>/dev/null; grep -a -i -E "^GET /api/remote.mux|^Upgrade:|^Connection:|^Host:" /tmp/wsdump.txt'
```

2026-09-29 10:15 实测结果：

```
GET /api/remote.mux HTTP/1.1
Host: 10.28.128.56          ← ❌ 待修：必须透传成 medai.nju.edu.cn
Upgrade: websocket          ← ✅ 已透传
Connection: upgrade         ← ✅ 已透传
Connection: keep-alive      ← ⚠️ 多余，建议合并为一条
```

⇒ **上游三项均已配置（2026-09-29 抓包复验）**：升级头透传 ✅、`Host` 透传 ✅
（实测：上游传出的 Host 已从内网 IP `10.28.128.56` 变为 `medai.nju.edu.cn`）。超时项抓包看不出来。
**端到端 `101` 仍以实际进入工作台为准**（见下）。

## 我方现状（已就绪，供参考 —— 这部分不需要网关侧处理）

宿主机 `njuserver` 上的 nginx 反代**已经部署完成**，WebSocket 升级头在本机这一层也已配好：

| 位置 | 内容 |
|---|---|
| `/etc/nginx/nginx.conf:12` | `include /etc/nginx/snippets/medai-workspace-http.conf;` |
| `/etc/nginx/sites-enabled/cms.conf:51` | `include /etc/nginx/snippets/medai-workspace-server.conf;` |
| `medai-workspace-http.conf:10` | `map $http_upgrade $connection_upgrade { default upgrade; '' close; }` |
| `medai-workspace-http.conf:21` | `map $http_host $ws_out_host { … }` ← Host 兜底（见下） |
| `medai-workspace-server.conf:56,59,60` | `/lab/ws/`：`proxy_http_version 1.1` + `Upgrade` + `Connection` |
| `medai-workspace-server.conf:104,106,107` | `/api/`：同样三条（应用的 WS 就是 `/api/remote.mux`） |

我们这几个 location 就是按上面 ③ 的做法写的：**每个 proxy location 各自把自己需要的头写全**
（`Host` + `Upgrade` + `Connection`），不依赖 server 层继承 —— 实测 101 通过，可直接照抄这个形态。

⇒ **升级透传已在两侧就位**，端到端即为原生 WebSocket。

**Host 兜底（2026-09-29 新增，已部署并线上复验）**：针对上游把 `Host` 改写成内网 IP 的问题，我们这侧加了一道
兜底 —— 转发到工作台容器的 location 不再直接用 `$http_host`，而用 `$ws_out_host`
（`medai-workspace-http.conf:21` 的 map）：只有 Host 确实是 `medai.nju.edu.cn`（可带端口）时
原样透传，否则纠正回它。行为已实测（`nginx -t` + 真实请求验证：上游传 `10.28.128.56` 时，
容器实际收到 `medai.nju.edu.cn`）。

**即便如此，仍请上游补 `proxy_set_header Host $http_host;`** —— 兜底只救工作台这一条链路；
上游把 Host 改写成内网 IP 是全局行为，其它依赖 Host 的功能（生成链接、重定向、日志、
将来新增的子系统）都会受影响。上游改对之后，这个兜底退化为恒等映射、无副作用。

---

## 我方后续动作（⚠️ 内部内容 —— 转发给网络中心时请连同本行一起删到文件末尾）

当前为绕过「网关不透传 WS」而启用了一个替代通道：容器内把应用的 WS 拆成
**「上行 POST + 下行 1 秒短轮询」**（都是网关放行的普通 HTTPS），页面注入适配脚本自动接管。
网关透传可用了，就把它关掉，回到原生 WebSocket（延迟更低、无 1 秒颗粒感）。

**✅ 已于 2026-09-29 执行**（关闭后首次进入即拿到 `101`，`access.log` 可查）。

**⚠️ 顺序问题（容易搞反）**：**只要桥还开着，客户端就不会发起原生 WebSocket，`101` 也就
永远不会出现** —— 桥的适配脚本会 hook 掉 `new WebSocket()` 并接管 dsh 的 WS。所以不存在
「先看到 101 再关桥」这种顺序：**关桥本身就是验证** —— 关掉后第一次进入就能看到 `101`；
若拿不到（说明原生 WS 那侧还有问题），按下面反向操作回滚即可。

```bash
# 位置：server/.env（该变量原本未出现 → 走默认值 1 = 开；定义见
#       server/src/workspace/workspace.config.ts:32）
echo 'WORKSPACE_WS_BRIDGE=0' >> /home/ubuntu/nju-lab/server/.env
sudo systemctl restart nju-lab
# 回滚：sed -i '/WORKSPACE_WS_BRIDGE=0/d' server/.env && sudo systemctl restart nju-lab
```

**为什么只需要这一步、不用动前端和 nginx**：

1. 后端在 `WORKSPACE_WS_BRIDGE=0` 时**不再下发** `X-Workspace-Bridge-Upstream`
   （`server/src/workspace/workspace.controller.ts:115`）；
2. nginx 的 `map $ws_up_bridge $ws_final_bridge`（`medai-workspace-http.conf:23-27`）收到空值
   → 落到 `127.0.0.1:8089` → 返回 **403**；
3. 页面注入的 `ws-bridge-client.js` 会先 `fetch('/wsbridge/ping')`
   （`server/workspace-image/ws-bridge-client.js:119`），非 200 → `catch` → `_useNative(url)`
   **自动退回原生 WebSocket**（`:121`）；
4. ⇒ **容器里那个桥进程即使还活着也无所谓**，只要后端不认它就行。
   容器内的 `bridge.mjs` 要到**下次容器重建**时才不再启动（`entrypoint.mjs:89` 打印 `WS bridge disabled`）。

**回滚**：把 `WORKSPACE_WS_BRIDGE=0` 删掉（或改回 `1`）重启后端，立刻回到当前可用状态。
桥的代码与 SSE 端点都保留着，`/wsbridge/` 的 nginx location 也保留（无会话时 403，客户端自动降级）。

**要盯的另一个坑（HANDOFF §8.3 第 8 条）**：该网关对**流式响应**有约 20 秒硬时限
（2026-09-29 实测：宿主直连的 SSE 能活 50s，经网关只活 16-24s，且心跳无效 —— 这正是桥改成
1 秒短轮询的原因）。WebSocket 升级后是另一条处理路径，理论上不受这条限制，但**必须实测**：
若网关对 WS 也掐，表现是 dsh 每隔约 20s 报一次 `connection lost, retry #N`，那就回滚。
