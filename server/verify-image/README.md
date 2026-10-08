# server/verify-image — 复验镜像与出栈白名单代理

复验（EvaluationRunner=docker）的全部容器侧构件。

## 构成

- `Dockerfile` → 镜像 `nju-lab-verify:0.2.0-rc.2-pkg3`（node:22-slim + 锁定
  `@deepseek-ai/dsh@0.2.0-rc.2` + zstd/unzip/**jq**/python3 + 驱动 + profile
  + **预装教学依赖集**，见下）
- `run-eval.mjs` — 复验驱动（**包驱动**）：解包 skill.zip/dataset.zip（resolveSkillRoot /
  resolveDatasetRoot 语义）→ 读数据集包的 `manifest.json` / `task.md` / `judge.md`
  → 依赖自检 → 逐 case 跑一轮 dsh headless（题干 + 学生的 Skill；
  approval=never + workspace-write）→ LLM judge（默认，`--judge-mode exact` 可切）
  → 输出单个结果 JSON。包内无声明时**逐字回落**内置「CSV 数据清洗」语义。
  `--check` 只解析与校验包（结构 + 依赖），不跑模型、不烧 token。
  > 2026-10-06 起**取消 baseline（"只给题干"）轮**：`--skill` 成为必需输入，结果 JSON 不再有
  > `summary.baseline` / `cases[].rounds`（`evalVersion: docker-3`）。
- `profile/nju-lab-verify/` — 从 `dsh/profiles/` 同步（改 profile 后需重新同步 + 重建镜像）
- `egress-proxy/nginx.conf` — 出栈白名单代理配置（见下）

构建：`docker build -t nju-lab-verify:<tag> .`
（本机 `node:22.23.2-slim` 是等效基底，见 UPGRADE-playbook §4.4；跨机部署走 `docker save | load`。
**只改驱动（如本 pkg3 取消 baseline 轮）时**走 UPGRADE-playbook §5 的变通：`FROM` 上一版镜像 +
覆盖 `run-eval.mjs`，再 `docker export | import` 压平，省掉整层依赖重装。）

## 包驱动：题目与判据随数据集包走

**为什么**：任务类型的知识原先写死在驱动代码里，于是「加一个实验类型 = 改驱动 + 重建镜像 +
部署」；现在搬到数据集包，加类型只需重新上传数据集包（平台零动作）。

| 文件（数据集 ZIP 根，全部可选） | 作用 |
|---|---|
| `manifest.json` | `outputFile` / `inputs` / `judgeMode` / `maxCases` / `requires` |
| `task.md` | 题干：复验唯一的事实源；支持 `{{input}}`/`{{inputs}}`/`{{output}}`/`{{skill}}` |
| `judge.md` | 评分细则，填进平台固定的判分外壳（外壳只钉 JSON 形状与差异容忍口径） |

优先级：命令行（项目 `evalConfig`）> 包内 manifest > 内置默认。
无以上三文件 → `source=builtin`，行为与改造前逐字一致（`server/fixtures/dataset/` 实测通过）。

面向教师的完整规范见 **`docs/EXPERIMENT-PACKAGE-SPEC.md`**。

## 预装依赖集（为什么必须预装）

复验容器在 `--internal` 网络里、**无外网**（只放行模型 API 的 SNI 白名单），镜像层只读 ——
容器内 `pip install` 不可能成功。所以：**依赖烘进镜像，包内 `manifest.requires` 声明，
驱动开跑前自检**，缺失就明确失败（不静默降级）。

当前预装（`PYTHON-PACKAGES.txt` 冻结清单在镜像 `/opt/verify/`）：

```
pandas numpy openpyxl python-dateutil requests beautifulsoup4 lxml PyYAML tabulate pytest
scikit-learn scipy statsmodels matplotlib
torch==2.14.1+cpu        ← CPU 版：PyPI 上 linux wheel 是 CUDA 版（+nvidia-*/triton，数 GB），
                           不可用；官方 download.pytorch.org 本机不通 → 走镜像站 CPU 索引
系统命令：python3(含标准库) jq unzip zstd
```

⚠️ 体积与资源：`torch` 约 800MB，本镜像约 **2.3GB**；ML 实验建议把 `VERIFY_DOCKER_MEMORY`
从默认 `1g` 调到 `2g`（njuserver 内存充足；本机内存紧张，慎调）。

包内 `requires.python` 按 **import 名**校验，同时认常见 pip 包名（`PyYAML`→`yaml`、
`beautifulsoup4`→`bs4`、`python-dateutil`→`dateutil`、`Pillow`→`PIL`、`scikit-learn`→`sklearn` …）。

加库 = 改 `Dockerfile` 的「预装依赖集」+ 重建镜像（一学期一两次）；**不要**指望容器联网装包。

## 本地验证（不烧 token）

```sh
# 结构 + 依赖自检（宿主有 docker 即可）
docker run --rm -v "$PWD/server/fixtures/sales-report:/p:ro" \
  nju-lab-verify:0.2.0-rc.2-pkg3 --check --skill /p/template.zip --dataset /p/dataset.zip

# 端到端（要 key，走默认 bridge 网络即可；平台内由 container-runtime 提供 internal + 代理）
docker run --rm -e DEEPSEEK_API_KEY=<key> \
  -v "$PWD/server/fixtures/sales-report:/p:ro" -v /tmp/out:/outputs \
  nju-lab-verify:0.2.0-rc.2-pkg3 \
  --skill /p/template.zip --dataset /p/dataset.zip --out /outputs/result.json --max-cases 1
```

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
