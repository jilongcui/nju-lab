# server/verify-image — 复验镜像与出栈白名单代理

复验（EvaluationRunner=docker）的全部容器侧构件。

## 构成

- `Dockerfile` → 镜像 `nju-lab-verify:0.1.7-rc.2`（node:22-slim + 锁定
  `@deepseek-ai/dsh@0.1.7-rc.2` + zstd/unzip/python3 + 驱动 + profile，约 512MB）
- `run-eval.mjs` — 复验驱动：解包 skill.zip/dataset.zip（resolveSkillRoot 语义）→
  逐 case 跑 baseline/treatment 两轮 dsh headless（approval=never + workspace-write）→
  LLM judge（默认，`--judge-mode exact` 可切）→ 输出单个结果 JSON
- `profile/nju-lab-verify/` — 从 `dsh/profiles/` 同步（改 profile 后需重新同步 + 重建镜像）
- `egress-proxy/nginx.conf` — 出栈白名单代理配置（见下）

构建：`docker build -t nju-lab-verify:0.1.7-rc.2 .`

## 出栈白名单隔离（SNI 代理）

学生 Skill 的 `scripts/` 是任意代码，复验容器**不能有自由网络**。拓扑：

```
复验容器 --[nju-verify-egress（--internal，无外网路由）]--> 代理容器 --> 公网
           DNS 仅 --add-host 钉的白名单域名 → 代理 IP            （双宿主：internal + 默认 bridge）
           直连 IP 无路由；非白名单域名解析失败                    nginx stream + ssl_preread 按 SNI 转发
```

- **internal 网络** `nju-verify-egress`：`docker network create --internal`——
  无外网路由，容器在其中的 DNS 查询无上游（黑洞）、直连 IP（如 1.1.1.1）无路由，两个绕过洞都堵死。
- **代理容器** `nju-verify-egress-proxy`：nginx:alpine，`stream` 块 `ssl_preread on`
  读出 TLS ClientHello 的 SNI，`map` 白名单（`api.deepseek.com`、`api.moonshot.cn`）转发到
  真实域名:443，其余丢到不可达地址。纯 TCP 转发——客户端零改造、无需装 CA 证书、
  对任意 HTTP 客户端有效。`resolver 127.0.0.11 valid=30s` 用 docker 内嵌 DNS 解析白名单域名。
- **复验容器**：`--network nju-verify-egress` + 每个白名单域名一条
  `--add-host <域名>:<代理在 internal 网络的 IP>`。
- 网络与代理由 `DockerEvaluationRunner.ensureEgressProxy()` 在每次复验前**幂等确保**
  （不存在则创建，停了则启动，未挂 internal 网络则补挂）；代理不可用时报错失败
  （fail-closed，不回退开放网络）。

## 运维

- **代理挂了会怎样**：复验容器内所有白名单域名指向代理 IP，代理停止则 LLM 调用
  全部连接失败 → 该次复验报错（submission 转 failed，可重试）。ensureEgressProxy
  下次复验时会自动 `docker start` 拉起；容器配了 `--restart unless-stopped`，
  dockerd 重启后也会自动恢复。
- **重建代理**：`docker rm -f nju-verify-egress-proxy`，下次复验自动重建（挂最新
  nginx.conf）。改 nginx.conf 后必须删容器重建（配置是只读挂载，重启即生效，
  `docker restart nju-verify-egress-proxy` 亦可）。
- **加白名单域名**：三处保持一致——`egress-proxy/nginx.conf` 的 map、runner 的
  `VERIFY_EGRESS_DOMAINS`（默认 `api.deepseek.com,api.moonshot.cn`）、驱动实际用的
  `VERIFY_BASE_URL` 主机。改完删代理容器重建。
- **删网络**：`docker network rm nju-verify-egress`（需先删代理容器），下次复验自动重建。
- 相关 env（server/.env，均有默认）：`VERIFY_EGRESS_NETWORK` / `VERIFY_EGRESS_PROXY` /
  `VERIFY_EGRESS_PROXY_IMAGE` / `VERIFY_EGRESS_PROXY_CONF` / `VERIFY_EGRESS_DOMAINS`。

## 已知边界

- SNI 白名单只挡 **TLS**；白名单域名本身的 HTTP(80) 也会经 443 代理失败——
  但复验只用 HTTPS API，够用。明文 HTTP 出站在 internal 网络里本就走不通。
- 白名单是按域名不是按路径：学生代码理论上也能调 `api.deepseek.com`（花平台的 key
  以外的自己的 key）。要堵这个洞需要 MITM 代理解密检查 Authorization，复杂度收益比
  不划算，留作更后期加固。
