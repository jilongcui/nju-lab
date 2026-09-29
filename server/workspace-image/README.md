# NJU-Lab 平台侧实验工作台镜像

学生不装任何东西，用浏览器打开平台即可获得与本地一致的 dsh 实验环境。
设计与取舍见 `docs/DESIGN-2026-09-28-platform-workspace.md`。

## 与复验镜像（`server/verify-image/`）的关系

同基座、同钉版纪律，但 bundle / profile / 驱动三者完全不同——**不要合并成一个镜像**：

| 项 | 复验镜像 | 工作台镜像（本目录） |
|---|---|---|
| bundle | `dsh-base` + `dsh-headless` | `dsh-base` + `dsh-web-app` |
| profile | `nju-lab-verify` | `nju-lab-workspace` |
| 插件 | — | `nju-lab-client` |
| 驱动 | `run-eval.mjs`（跑一次即退） | `entrypoint.mjs`（长驻 + 容器内转发） |
| 基座 | `node:22.23.2-slim` | **同左，必须同样钉小版本** |

## 构建

build context 必须是**仓库根**（要 copy `dsh/nju-lab-client`）：

```bash
docker build -f server/workspace-image/Dockerfile -t nju-lab-workspace:0.1.7-rc.2 .
```

## 运行

```bash
docker run --rm -p 19090:9090 \
  -e WORKSPACE_TRUSTED_HOST=127.0.0.1:19090 \
  nju-lab-workspace:0.1.7-rc.2
```

容器会打印：

```
[workspace] proxy listening 0.0.0.0:9090 -> 127.0.0.1:8080
[workspace] starting: dsh --profile nju-lab-workspace --port 8080 --no-open --trusted-host 127.0.0.1:19090
dsh web: http://127.0.0.1:8080/?token=<xxx>
WORKSPACE_TOKEN=<xxx>
WORKSPACE_READY port=9090
```

浏览器打开 `http://127.0.0.1:19090/?token=<xxx>` 即可（**token 不可省**）。

⚠️ `WORKSPACE_TRUSTED_HOST` 必须填**浏览器地址栏里的那个 authority**，否则一律 401——
dsh 的 browser-trust fence 只信任显式声明的 authority。

## 容器内约束（上线前必须补齐）

| 项 | 现状 | 上线要求 |
|---|---|---|
| 资源限额 | 本目录不设，由调用方（`ContainerRuntime`）加 `--memory` / `--cpus` | 必须 |
| 出栈隔离 | 同上，由调用方挂 `--network <internal>` + SNI 白名单 | 必须 |
| 一次性 | `--rm`；**不复用容器** | 必须 |
| 非 root 运行 | ❌ **尚未实现**（当前以 root 跑） | 建议补齐 |

**不要直接用 `docker run` 上生产**——上面的命令只用于本地验证。生产路径是后端
`ContainerRuntime` 起容器，隔离策略集中在那里（见设计文档 §6 改造点）。

## 路径 A 已退役（2026-09-28）

原先 njuserver 的 QEMU vCPU 无 SSE4.2/POPCNT，`sharp` 加载失败会让 `dsh web` 启动即崩，
因此 profile 里禁用了 `attachment-local` 及其**消费者**（必须一起禁，否则消费者 pending）。

**2026-09-28 该 VM 的 CPU 改为 host-passthrough（Xeon Gold 6530，SSE4.2/POPCNT/AVX2），
sharp 恢复 → 禁用段已从 `profile/nju-lab-workspace/cordis.patch.yml` 删除，镜像已重建，
本镜像现在是完整功能版**（含 UI 文件上传 / 附件显示 / 交付物面板 / 会话控制器）。

⚠️ 只有在把工作台部署到**无 SSE4.2/POPCNT** 的机器时才需要恢复那段禁用
（`cordis.patch.yml` 里以注释形式保留了内容与原因）。
