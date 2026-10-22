#!/usr/bin/env node
/**
 * NJU-Lab 平台侧实验工作台 —— 容器入口。
 *
 * 做三件事：
 *   1. **容器内 TCP 转发**：`0.0.0.0:<PROXY_PORT>` → `127.0.0.1:<DSH_PORT>`。
 *      dsh web 硬禁 `--host 0.0.0.0`（理由："会把远程代码执行暴露到网络"），
 *      所以"对外暴露"这件事由我们这一层显式负责 —— 这正是 dsh 期望的边界划分：
 *      它自己只绑 loopback，网络可达性是调用方的决定。
 *   2. 启动 dsh web（绑 127.0.0.1，遵守 dsh 的安全约束）。
 *   3. 把 dsh 生成的访问 token 以 `WORKSPACE_TOKEN=` 打到 stdout，
 *      供平台后端拼对外 URL。
 *
 * 环境变量：
 *   WORKSPACE_PROFILE       要启动的 profile（默认 `nju-lab-workspace`）
 *   WORKSPACE_PORT          dsh web 监听端口（默认 `8080`，绑 127.0.0.1）
 *   WORKSPACE_PROXY_PORT    转发监听端口（默认 `9090`，绑 0.0.0.0）
 *   WORKSPACE_TRUSTED_HOST  外部访问的 authority，须传给 `--trusted-host`
 *
 * ⚠️ `WORKSPACE_TRUSTED_HOST` 不传会导致**所有外部请求 401**：dsh 的 browser-trust
 * fence 只信任显式声明的 authority，连它自己绑定的 `127.0.0.1:<port>` 都不默认信任。
 * 经 nginx 反代时，这里要填**浏览器地址栏里的那个 authority**（如 `lab.xiaohe.biz`
 * 或 `medai.nju.edu.cn`，带端口时写 `host:port`）。
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer, connect } from 'node:net';
import { networkInterfaces } from 'node:os';

const PROFILE = process.env.WORKSPACE_PROFILE || 'nju-lab-workspace';
const DSH_PORT = Number(process.env.WORKSPACE_PORT || 8080);
const PROXY_PORT = Number(process.env.WORKSPACE_PROXY_PORT || 9090);
/** WS→HTTPS 桥的监听端口（与 bridge.mjs 约定一致） */
const BRIDGE_PORT = Number(process.env.WORKSPACE_BRIDGE_PORT || 9091);
/**
 * 是否启动 WS 桥：校园网关（TLS 终止那层）不透传 WebSocket 升级时，
 * dsh 的实时通道（`/api/remote.mux`）只能改走"普通 HTTPS" —— 见 bridge.mjs。
 * 默认**开启**；网关侧开放 WS 之后，平台只需注入 `WORKSPACE_WS_BRIDGE=0` 即切回原生 WebSocket
 * （页面适配脚本探测不到桥就自动退回原生，不需要改前端/nginx）。
 */
const BRIDGE_ON = !/^(0|false|no|off)$/i.test(process.env.WORKSPACE_WS_BRIDGE ?? '1');
/** dsh launch token 的落盘位置（桥读它换自己的 cookie） */
const TOKEN_FILE = process.env.WORKSPACE_TOKEN_FILE || '/tmp/dsh-launch-token';
/**
 * 学生的工作目录：持久卷挂在这里（`<数据根>/<userId>` → `/workspace`）。
 *
 * ⚠️ 光设 dsh 进程的 cwd（下面的 `spawn(..., { cwd: WORKDIR })`）**不够**：
 * dsh web 给会话选的「工作区」来自 `os.homedir()`，而容器内 `HOME=/root` ——
 * 于是学生在 dsh 里的产物全落容器可写层，空闲回收/镜像升级一删就没
 * （2026-10-23 实测，见 `docs/DESIGN-2026-09-28-platform-workspace.md` §4.8）。所以 HOME 也指到这里。
 */
const WORKDIR = process.env.WORKSPACE_WORKDIR || '/workspace';
/** HOME 指向哪里（dsh 的「工作区」与目录选择器起点都取它） */
const HOME_DIR = process.env.WORKSPACE_HOME || WORKDIR;
/**
 * 旧路径（2026-09-29 ～ 2026-10-22 的 `/work`）：做成指向 `WORKDIR` 的符号链接。
 * 宿主目录结构不变，所以老容器留下的老文件照旧可见，老文档/老习惯里的 `/work` 也不会失效。
 */
const LEGACY_WORKDIR = '/work';
/**
 * 额外信任的 authority（逗号分隔），来自平台配置；一般留空即可。
 * 容器会**自动**把自己的 `IP:PORT` 加进信任列表——因为对外访问走容器 IP
 * （`--internal` 网络下端口映射无效），届时 dsh 看到的 Host 正是它。
 */
const EXTRA_TRUSTED = (process.env.WORKSPACE_TRUSTED_HOSTS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// 1) 容器内转发：纯 TCP 层，不解析 HTTP —— 避免对 dsh 的 wire 协议做任何假设
createServer((client) => {
  const upstream = connect(DSH_PORT, '127.0.0.1');
  const teardown = () => {
    client.destroy();
    upstream.destroy();
  };
  client.on('error', teardown).on('close', teardown);
  upstream.on('error', teardown).on('close', teardown);
  client.pipe(upstream);
  upstream.pipe(client);
}).listen(PROXY_PORT, '0.0.0.0', () => {
  console.log(
    `[workspace] proxy listening 0.0.0.0:${PROXY_PORT} -> 127.0.0.1:${DSH_PORT}`,
  );
});

// 1.5) 可选：WS → 普通 HTTPS 桥（默认开；WORKSPACE_WS_BRIDGE=0 关闭）
if (BRIDGE_ON) {
  const bridge = spawn('node', [new URL('./bridge.mjs', import.meta.url).pathname], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, WORKSPACE_BRIDGE_PORT: String(BRIDGE_PORT) },
  });
  bridge.stdout.on('data', (d) => process.stdout.write(d));
  bridge.stderr.on('data', (d) => process.stderr.write(d));
  // 桥挂掉不影响 dsh（客户端探测不到桥会自动退回原生 WebSocket）
  bridge.on('exit', (code) =>
    console.warn(`[workspace] bridge exited (code=${code}); clients will fall back to native WebSocket`),
  );
} else {
  console.log('[workspace] WS bridge disabled (WORKSPACE_WS_BRIDGE=0)');
}

// 2) dsh web（绑 loopback；对外可达性由上面的转发层负责）
//
// dsh 的 browser-trust fence 只信任显式声明的 authority，所以必须把
// **本容器的 `IP:PROXY_PORT`** 传进去（外部经容器 IP 访问，Host 就是它）。
const selfAuthorities = [];
for (const addr of Object.values(networkInterfaces())) {
  for (const info of addr ?? []) {
    if (info.family === 'IPv4' && !info.internal) {
      selfAuthorities.push(`${info.address}:${PROXY_PORT}`);
    }
  }
}
// ⚠️ 额外信任 loopback：WS 桥直连 dsh 时用的就是它（与它换到的 cookie 的 authority 一致）。
//    不暴露到网络（dsh 只绑 127.0.0.1），所以加进来没有安全面。
const trusted = [...new Set([...selfAuthorities, `127.0.0.1:${DSH_PORT}`, ...EXTRA_TRUSTED])];
const args = ['--profile', PROFILE, '--port', String(DSH_PORT), '--no-open'];
for (const host of trusted) args.push('--trusted-host', host);
console.log(`[workspace] trusted-host: ${trusted.join(' ')}`);
console.log(`[workspace] starting: dsh ${args.join(' ')}`);
try {
  mkdirSync(WORKDIR, { recursive: true }); // 没挂持久卷时的兜底
} catch (e) {
  console.warn(`[workspace] 创建 ${WORKDIR} 失败：${e.message}`);
}
// 旧路径兼容：/work → WORKDIR（老文档、老会话记录里的路径继续可用）
if (LEGACY_WORKDIR !== WORKDIR) {
  try {
    if (!existsSync(LEGACY_WORKDIR)) symlinkSync(WORKDIR, LEGACY_WORKDIR);
  } catch (e) {
    console.warn(`[workspace] 建 ${LEGACY_WORKDIR} → ${WORKDIR} 符号链接失败：${e.message}`);
  }
}
// 首次使用：dsh 的 storages 里预置一个**指向 WORKDIR 的工作区**，学生进来直接可用，
// 不必先在目录选择器里点一次（选择器起点也是 WORKDIR，见上面的 HOME）。
// - store 不存在，或存在但一个工作区都没有（本机容器内 xdg-user-dir 不可用 → dsh 只会写一个
//   空 store）时补一条；学生已经选过工作区就**不动它**；
// - 记录形状取自真实运行样本（version 2），dsh 升级 storages 格式时由它自己的迁移逻辑接管；
//   万一这份预置不被接受，dsh 会重建 store —— 学生重选一次目录即可，文件本身不丢。
seedDefaultWorkspace();
function seedDefaultWorkspace() {
  const home = process.env.DSH_HOME;
  if (!home) return;
  const store = `${home}/storages/workspace.json`;
  const id = randomUUID();
  const now = new Date().toISOString();
  const entry = {
    path: WORKDIR,
    title: 'workspace',
    sessionIds: [],
    createdAt: now,
    updatedAt: now,
  };
  let record;
  if (existsSync(store)) {
    // 已有 store：只在"一个工作区都没有"时补一条（解析不了就交给 dsh 自己处理）
    try {
      const existing = JSON.parse(readFileSync(store, 'utf8'));
      const ids = existing?.global?.workspaceIds;
      const tables = existing?.tables?.workspaces;
      if (!Array.isArray(ids) || ids.length > 0) return;
      if (tables && Object.keys(tables).length > 0) return;
      record = {
        ...existing,
        global: { ...existing.global, initialized: true, workspaceIds: [id] },
        tables: { ...existing.tables, workspaces: { ...(tables ?? {}), [id]: entry } },
      };
    } catch (e) {
      console.warn(`[workspace] 读取 ${store} 失败，跳过预置工作区：${e.message}`);
      return;
    }
  } else {
    record = {
      unit: { name: 'workspace', version: 2 },
      global: { initialized: true, workspaceIds: [id], archivedSessionIds: [], pinnedSessionIds: [] },
      tables: { workspaces: { [id]: entry } },
    };
  }
  try {
    mkdirSync(`${home}/storages`, { recursive: true });
    writeFileSync(store, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
    console.log(`[workspace] seeded default workspace: ${WORKDIR}`);
  } catch (e) {
    console.warn(`[workspace] 预置工作区失败（不影响使用）：${e.message}`);
  }
}

// HOME 指到工作目录：dsh 的「工作区」/目录选择器起点都取 homedir（见文件头 WORKDIR 注释）
const child = spawn('dsh', args, {
  stdio: ['ignore', 'pipe', 'pipe'],
  cwd: WORKDIR,
  env: { ...process.env, HOME: HOME_DIR },
});

// 3) 捕获 launch token（dsh 打印形如 `http://127.0.0.1:<port>/?token=<xxx>`）
let announced = false;
const scanToken = (chunk) => {
  if (announced) return;
  const m = /[?&]token=([A-Za-z0-9_-]+)/.exec(chunk);
  if (!m) return;
  announced = true;
  console.log(`WORKSPACE_TOKEN=${m[1]}`);
  // 给 WS 桥用：它拿这个 token 换一份"authority = 127.0.0.1:<dsh 端口>"的 cookie，
  // 从而不依赖浏览器那份（后者的 authority 是外部域名，桥直连 dsh 时对不上）。
  try {
    writeFileSync(TOKEN_FILE, `${m[1]}\n`, { mode: 0o600 });
  } catch (e) {
    console.warn(`[workspace] 写 ${TOKEN_FILE} 失败：${e.message}`);
  }
  console.log(`WORKSPACE_READY port=${PROXY_PORT}`);
};
child.stdout.on('data', (d) => {
  process.stdout.write(d);
  scanToken(String(d));
});
child.stderr.on('data', (d) => process.stderr.write(d));

// dsh 退出即容器退出 —— 否则转发层会吊住 event loop，容器变成"活着但不可用"
child.on('exit', (code, signal) => {
  console.error(`[workspace] dsh exited (code=${code} signal=${signal}); shutting down`);
  process.exit(code ?? 1);
});
