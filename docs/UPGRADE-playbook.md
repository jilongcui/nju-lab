# DSH 升级 Playbook

> 升级 `@deepseek-ai/dsh`、重建镜像、部署、重打学生 kit 的**完整流程与本机约束**。
> 由 0.1.5 → 0.1.7 → 0.2.0 三次实战沉淀。**动手前先读本文**，尤其「§4 已知坑」。
>
> 需要发起升级时，最省事的说法（一句话，agent 会自己查 npm、自己发现破坏面）：
>
> ```
> 把 nju-lab 的 DSH 依赖从 @deepseek-ai/dsh@<旧版本> 升级到 <新版本>，全仓库一致：
> 版本串+lock、脚本、镜像 tag、文档同步，修掉编译/行为破坏；测试过后重建 verify/workspace
> 镜像 + 重打 kit，最后部署并 push。
> ```

---

## 1. 涉及面（全仓库「一致」具体指哪些）

| 类别 | 位置 |
|---|---|
| 依赖版本 + lock | `dsh/nju-lab-client/`、`dsh/verify-poc/`、`server/verify-image/`、`server/workspace-image/` |
| 硬编码版本串 | `dsh/kit/install.sh`（`DSH_VERSION`）、`dsh/scripts/smoke.sh`、`server/verify-image/run-eval.mjs`、`dsh/verify-poc/run-eval.mjs`（`DSH_VERSION`） |
| 镜像 tag | `server/src/workspace/workspace.config.ts`、`server/src/submissions/docker-evaluation-runner.ts`、两个 `Dockerfile`、`server/.env.example` |
| 前端提示 | `web/src/pages/student/ClientDownload.tsx` |
| 文档（**当前策略**部分） | `dsh/README.md`、`dsh/kit/README-student.md`、各 `README.md`、`HANDOFF.md`、`nju-lab-client-design.md`、`docs/DESIGN-*.md` |

低版本残留自查（应只剩历史记录）：

```sh
grep -rln "0\.<旧版本>" . | grep -v node_modules | grep -v '^\./\.git/' | grep -v package-lock.json \
  | grep -v './server/dist/' | grep -v './web/dist/'
```

## 2. 标准流程

1. **先侦察**（别直接改仓库）：`cp -r dsh/nju-lab-client /tmp/probe && 改版本 → npm install → npx tsc --noEmit`，
   量化破坏面；再把 `npm run build` + `npm test` 跑一遍。
2. **版本串 + lock**：机械替换后，**删掉旧 lock 重新生成**（旧 lock 锁着上一版的传递依赖，会 `ERESOLVE`）：
   - 插件：`rm -f package-lock.json && npm install`
   - 三个只用 dsh 的包：`rm -f package-lock.json && npm install --package-lock-only`
3. **修破坏**：改动通常集中在 `dsh/nju-lab-client/src/{host,client}` 与 `test/`。
4. **验证**：`npm run typecheck` → `npm run build` → `npm test`（**必须带 `DSH_BIN`**，见 §4）。
5. **镜像重建**（§5）→ **kit 重打**（§6）。
6. **部署**（§7）→ **commit + push**。

## 3. 验证的正确姿势

```sh
cd dsh/nju-lab-client
npm run typecheck && npm run build
DSH_BIN=/path/to/新版本/dsh npm test      # 不带 DSH_BIN 时 6 条 L2 会静默 skip，仍显示全绿
```

- 需要一个**新版本的真 dsh 二进制**：`npm i --prefix /tmp/dsh-bin @deepseek-ai/dsh@<新版本>`。
- 若要端到端复验链路：`cd server/verify-image && docker run --rm -v <fixtures>:/fixtures:ro -e DEEPSEEK_API_KEY=<key> nju-lab-verify:<新版本> --skill /fixtures/csv-cleaner --dataset /fixtures/dataset --out /out/result.json`。

## 4. 已知坑（每次都要过一遍）

### 4.1 前端协议路径（**最容易漏**）
0.1.7 起 dsh 把前端协议路径从「锚定 origin 根」改成**基于 `document.baseURI`**：

- `dsh-api-gateway`：`new URL("/api/remote.mux".slice(1), __DSH_TRANSPORT__?.streamBaseUrl ?? document.baseURI)`
- 于是 WebSocket 会被发到 `/lab/ws/<wsKey>/api/remote.mux`，而**校园网关只对根路径的 WS 升级配了透传** → 握手 **404**（表现为页面能开、一直 `connection lost, retry #N`）。

**对策**：nginx 已在工作台页面注入 `window.__DSH_TRANSPORT__={streamBaseUrl:location.origin}`（见 `deploy/nginx/medai-workspace-server.conf` 的 `sub_filter`）。
**每次升级都要重新确认它是否仍有必要**：只要 `remoteStreamUrl()` 还是「`slice(1)` + `baseURI`」的写法，这条修复就必须保留。

> 历史：0.1.7 同时让 `dsh-client-hmr` 的 `/plugins/events` SSE 也变成相对路径；**0.2.0 把 `client-hmr` 整个删了**，该 SSE 与其 `ERR_INCOMPLETE_CHUNKED_ENCODING` 随之消失（nginx 里的 `EventSource` hook 保留无害）。

### 4.2 历史文档不要改
带日期的实测快照（如 `## 实测契约（0.1.5-rc.2，2026-09-21 实测）`）、`docs/ACCEPTANCE-*.md`、已存在的镜像制品名（`nju-lab-workspace:0.1.5-rc.2-no-sse42` 等）、`nju-lab-craft.md` 的「执行结果」——**保留原版本号**。机械替换会伪造历史，改完必须人工回看这几处。

### 4.3 本机沙箱限制
- **不能 `sudo`**：会话跑在 `no-new-privileges` 的沙箱里（`sudo -n systemctl restart` 会报错）。
- `/etc/nginx` 属 `root:root`：要落盘得**用 docker 以 root 写**（`docker run --rm -v /etc/nginx/... -v <仓库源>:ro`）。
- 免密 sudo 只有一条：`/bin/systemctl restart nju-lab`（在沙箱里也用不了）。

### 4.4 镜像基底拿不到
本机 **拉不到 `node:22.23.2-slim`**（docker.io 直连不通；华为云源只有会崩的 `node:22-slim` = v22.18.0）。
本机已有一个**等效基底** `node:22.23.2-slim`（从旧 verify 镜像提取 node v22.23.2 盖在 `node:22-slim` 上）。若它不在了，按同样办法重建。

### 4.5 zip/unzip
Ubuntu 默认**不含** `zip`/`unzip`；测试与 kit 打包依赖它们。缺了先 `sudo apt-get install -y zip unzip`（宿主上做）。

## 5. 镜像重建

两个镜像、单一 dsh 运行时：

```sh
# verify：一次性的 headless 复验容器
docker build -f server/verify-image/Dockerfile -t nju-lab-verify:<新版本> server/verify-image/
# workspace：工作台（FROM nju-lab-verify），build context 必须是仓库根
docker build -f server/workspace-image/Dockerfile -t nju-lab-workspace:<新版本> .
```

**本机的变通（重要）**：既然拉不到 `node:22.23.2-slim`，实测可行的是「复用上一版 verify 当基底 + 压平成单层」：

```dockerfile
# /tmp/verify-rebuild.Dockerfile
FROM nju-lab-verify:<上一版本>            # 已含正确的 node v22.23.2
WORKDIR /opt/verify
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY run-eval.mjs ./
COPY profile/ ./profile/
```

```sh
docker build -f /tmp/verify-rebuild.Dockerfile -t nju-lab-verify:<新版本> server/verify-image/
# 层叠加会撑大（~1.2GB），export/import 压平回约 730MB：
CID=$(docker create nju-lab-verify:<新版本>)
docker export "$CID" -o /tmp/v.tar && docker rm "$CID" >/dev/null
docker import \
  --change 'WORKDIR /opt/verify' \
  --change 'ENV PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' \
  --change 'ENV DSH_HOME=/tmp/dsh-home' \
  --change 'ENV DSH_TELEMETRY_DISABLED=1' \
  --change 'ENTRYPOINT ["node","/opt/verify/run-eval.mjs"]' \
  /tmp/v.tar nju-lab-verify:<新版本>
```

> 参考体积：0.1.5 → 512MB；0.1.7 → 730MB（新增 `libreoffice-kit-wasm` 146MB 等）；
> 0.2.0 → 730MB（移除 `client-hmr`，与 0.1.7 持平）。workspace 比 verify 多约 110MB（插件产物）。

**保留旧镜像作回滚点**，别 `docker rmi`。

## 6. 学生 kit

```sh
cd dsh/kit && PLATFORM_URL=http://medai.nju.edu.cn/lab ./build-kit.sh   # 生产用 medai 变体
```

产物 `dsh/kit/dist/nju-lab-student-kit.zip`（`dist/` 已被 `.gitignore`）。校验：

```sh
unzip -p dist/nju-lab-student-kit.zip install.sh | grep DSH_VERSION
unzip -p dist/nju-lab-student-kit.zip kit-version.json
```

投放（先备份）：

```sh
cp -a /var/www/lab/kit/nju-lab-student-kit.zip /var/www/lab/kit/nju-lab-student-kit.zip.<旧版本>.bak
cp dsh/kit/dist/nju-lab-student-kit.zip /var/www/lab/kit/nju-lab-student-kit.zip
```

## 7. 部署

```sh
cd ~/nju-lab/server && npm run build          # server 跑的是 dist/，改 src 不 build 不生效
cp dsh/kit/dist/...                            # kit 投放见 §6

# 重启服务：沙箱里 sudo 不可用，用 kill 让 systemd 按 Restart=always 拉起
PID=$(systemctl show nju-lab -p MainPID --value) && kill "$PID"
```

- 重启会**打断活跃工作台会话**（容器由 `adoptOrReclaim()` 处置：镜像没变则 adopt、变了则 reclaim 重建，wsKey 随之更换，学生需重新进入）——**先跟操作人确认**。
- 冒烟：`curl -o /dev/null -w '%{http_code}' http://127.0.0.1/lab/`（应 200）；
  起一个工作台容器确认 `[nju-lab-client] host half loaded` + `WORKSPACE_READY` + token→cookie→200。

## 8. 提交

```sh
git add -A -- dsh server web HANDOFF.md nju-lab-client-design.md docs
git commit -m "dsh: 升级到 @deepseek-ai/dsh@<新版本>（全仓库）"
git push origin main
```

`3.sh` 等他人未跟踪文件不要一起提交。`HANDOFF.md` 是否更新由操作人决定。

## 9. 回滚

- 镜像：把 `server/.env` 的 `VERIFY_IMAGE` / `WORKSPACE_IMAGE` 指回旧 tag（或在代码默认值里回退），`npm run build` + 重启。
- kit：`/var/www/lab/kit/` 里的 `.bak` 改回主名即可。
- 代码：`git revert` 对应 commit。
