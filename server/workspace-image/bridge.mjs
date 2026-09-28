#!/usr/bin/env node
/**
 * NJU-Lab 平台侧工作台 —— 「WebSocket → 普通 HTTPS」桥
 *
 * 为什么存在：校园网关（TLS 终止那层）不透传 WebSocket 升级，而 dsh 的实时通道只有
 * `wss://<origin>/api/remote.mux` 一条。本桥在**容器内**把一条真实的 dsh WS 暴露成
 * 「下行 SSE + 上行 POST」——两者都是网关一定放行的普通 HTTPS 请求。
 * 设计背景与切换方式：docs/DESIGN-2026-09-28-platform-workspace.md（§4.6.1）
 *
 * 协议（由 nginx 的 `location ^~ /wsbridge/` 分流到本进程）：
 *   GET  /wsbridge/ping                 → 200 `ok`（客户端用它判断"桥是否启用"）
 *   GET  /wsbridge/events               → 新建会话：连 dsh WS，返回 SSE 流（首个事件带会话 id）
 *   GET  /wsbridge/events?id=<id>       → 复用会话（SSE 重连用，不重建 WS）
 *   POST /wsbridge/send?id=<id>         → 把 body 原样写进该会话的 WS（上行帧）
 *
 * SSE 事件：
 *   event: ready   data: {"id":"..."}
 *   event: text    data: <原样文本帧>
 *   event: bin     data: {"b64":"..."}
 *   event: closed  data: {"code":N,"reason":"..."}
 *
 * 关键设计：
 *   · **透明转发**：不解析 dsh 的 mux 协议，只搬运消息，因此不受其内部协议变化影响。
 *   · **鉴权零新增**：把浏览器请求里的 Cookie 原样带给 dsh 的 WS 握手，
 *     dsh 自己的 cookie/authority 校验照旧生效（它不是我们绕过的东西）。
 *   · **同源直连**：连的是 `ws://<容器IP>:9090/api/remote.mux`（entrypoint 的转发口），
 *     这样 dsh 看到的 Host/Origin 正是它信任列表里的自己的 `IP:9090`。
 *   · **不做多租户**：一个容器一个学生，桥只服务本容器内的会话。
 */
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const require = createRequire(import.meta.url);
// ws 来自镜像里既有的 dsh 依赖（/opt/workspace/node_modules → /opt/verify/node_modules）
// 用它是因为 Node 内置 WebSocket 不支持自定义头（我们必须带 Cookie）。
const WebSocket = require('ws');

const PORT = Number(process.env.WORKSPACE_BRIDGE_PORT || 9091);
/** 轮询模式下每条会话保留多少条帧（超出的丢弃） */
const MAX_LOG = 2000;
/** 会话在 SSE 断开后保留多久（便于重连复用同一条 WS） */
const LINGER_MS = Number(process.env.WORKSPACE_BRIDGE_LINGER_MS || 60_000);
/* 心跳间隔：用**真实 SSE 事件**（不是注释行）——有些中间层只按"有数据"保活，
   而它不认识注释行；另外把间隔压到 10s，抢在网关的空闲超时之前（实测 SSE 活不过 ~20s）。 */
const HEARTBEAT_MS = 10_000;
const MAX_UPLOAD = 2 * 1024 * 1024;

/**
 * 连 dsh 的方式：直连它绑定的 loopback（entrypoint 的 9090 只是给 nginx 用的 TCP 转发）。
 *
 * ⚠️ authority 必须自洽：dsh 的 auth cookie 是**按 authority 签发**的。
 * 浏览器那份 cookie 的 authority 是外部域名（nginx 传的 Host），而桥是按 `127.0.0.1:<dsh端口>`
 * 连它的 —— 用浏览器 cookie 必然 401（实测踩过）。所以桥**自己**用 launch token 换一份
 * 「authority = 127.0.0.1:<dsh端口>」的 cookie 自用。
 * 代价是 entrypoint 要把该地址加进 dsh 的 `--trusted-host`（只绑 loopback，不扩大攻击面）。
 */
const DSH_PORT = Number(process.env.WORKSPACE_PORT || 8080);
const DSH_AUTHORITY = `127.0.0.1:${DSH_PORT}`;
const DSH_WS_URL = `ws://${DSH_AUTHORITY}/api/remote.mux`;
const TOKEN_FILE = process.env.WORKSPACE_TOKEN_FILE || '/tmp/dsh-launch-token';

/** 缓存"桥自己那份" dsh cookie（onwership 在桥内，不涉及学生凭证） */
let dshCookie = null;
async function ensureDshCookie(force = false) {
  if (dshCookie && !force) return dshCookie;
  let token = '';
  try {
    token = readFileSync(TOKEN_FILE, 'utf8').trim();
  } catch {
    /* 还没写（dsh 未就绪） */
  }
  if (!token) throw new Error('dsh launch token 不可用（entrypoint 尚未写入）');
  const res = await fetch(`http://${DSH_AUTHORITY}/?token=${encodeURIComponent(token)}`, {
    redirect: 'manual',
  });
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  const pair = list.map((c) => c.split(';')[0]).find((c) => c.startsWith('dsh-auth-'));
  if (!pair) throw new Error(`换 dsh cookie 失败：HTTP ${res.status}`);
  dshCookie = pair;
  console.log('[bridge] 已取得桥自身的 dsh cookie（authority=' + DSH_AUTHORITY + '）');
  return dshCookie;
}

/**
 * id → { ws, res, lingerTimer, log, seq }
 *
 * `log` 是**帧历史**（`[event, payload, seq]`），供短轮询按游标读取 ——
 * 因为校园网关会在 ~20 秒后掐掉任何流式响应（2026-09-29 实测：宿主直连能活 50s，
 * 经网关只活 16-24s，且心跳无效），所以**下行不能依赖长连接**。
 */
const sessions = new Map();


function sseWrite(res, event, data) {
  res.write(`event: ${event}\ndata: ${data}\n\n`);
}

function closeSession(id, code = 1000, reason = 'disposed') {
  const s = sessions.get(id);
  if (!s) return;
  clearTimeout(s.lingerTimer);

  // ⚠️ 关闭事件**也要进帧历史**：轮询客户端靠它知道上游断了。
  //    只发给 SSE 是不够的 —— 轮询模式下客户端会一直轮询一个死会话（2026-09-29 实测踩过）。
  s.seq += 1;
  s.log.push(['closed', JSON.stringify({ code, reason }), s.seq]);
  if (s.log.length > MAX_LOG) s.log.shift();

  if (s.res) {
    try {
      sseWrite(s.res, 'closed', JSON.stringify({ code, reason }));
      s.res.end();
    } catch {
      /* 已断开 */
    }
    s.res = undefined;
  }
  try {
    s.ws?.close();
  } catch {
    /* ignore */
  }

  // 会话**不立刻删**：留 LINGER_MS 让客户端把那条 closed 取走；
  // 这期间带 id 的请求仍能复用/读取（拿不到就新建）。
  s.lingerTimer = setTimeout(() => sessions.delete(id), LINGER_MS);
  s.lingerTimer.unref?.();
  console.log(`[bridge] session ${id} closed (${code} ${reason})`);
}

function attachSse(id, s, res) {
  // 同一会话只保留一个活跃 SSE：新连接顶掉旧的
  if (s.res && s.res !== res) {
    try {
      s.res.end();
    } catch {
      /* ignore */
    }
  }
  clearTimeout(s.lingerTimer);
  s.lingerTimer = undefined;
  s.res = res;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // 让 nginx 不要缓冲这条流（本地也设了 proxy_buffering off，双保险）
    'X-Accel-Buffering': 'no',
  });
  sseWrite(res, 'ready', JSON.stringify({ id }));

  // 把已经攒下的帧补发出去（SSE 只是可选快速路径；轮询模式下走 log 游标）
  if (s.log && s.log.length) {
    for (const [ev, payload] of s.log) sseWrite(res, ev, payload);
    s.log = [];
  }

  const hb = setInterval(() => {
    // 用真实事件（客户端适配层会忽略 ka）
    try {
      sseWrite(res, 'ka', '{}');
    } catch {
      /* ignore */
    }
  }, HEARTBEAT_MS);

  const cleanup = () => {
    clearInterval(hb);
    if (s.res === res) s.res = undefined;
    // 不立刻关 WS：留一段时间给客户端重连复用（避免丢掉 dsh 的会话状态）
    if (sessions.has(id) && !s.lingerTimer) {
      s.lingerTimer = setTimeout(() => closeSession(id, 1000, 'idle'), LINGER_MS);
      s.lingerTimer.unref?.();
    }
  };
  res.on('close', () => {
    console.log(
      `[bridge] session ${id} SSE disconnected${res.writableEnded ? ' (ended)' : ' (client aborted)'}`,
    );
    cleanup();
  });
  res.on('error', cleanup);
}

async function newSession(res) {
  const id = randomBytes(9).toString('hex');
  let cookie;
  try {
    cookie = await ensureDshCookie();
  } catch (e) {
    if (res) {
      res.writeHead(503, { 'Content-Type': 'text/plain' });
      res.end(`bridge: ${e.message}`);
    }
    throw e;
  }
  const ws = new WebSocket(DSH_WS_URL, {
    headers: {
      Origin: `http://${DSH_AUTHORITY}`,
      Cookie: cookie,
    },
  });
  const s = { ws, res: undefined, lingerTimer: undefined, log: [], seq: 0 };
  sessions.set(id, s);
  // 轮询模式（res 为 null）时不会挂 SSE，帧只进 log，由 /poll 按游标取走

  ws.on('open', () => {
    console.log(`[bridge] session ${id} upstream open (${DSH_WS_URL})`);
    if (s.res) sseWrite(s.res, 'open', '{}');
  });
  ws.on('message', (data, isBinary) => {
    const ev = isBinary ? 'bin' : 'text';
    const payload = isBinary
      ? JSON.stringify({ b64: Buffer.from(data).toString('base64') })
      : String(data);
    // 1) 进帧历史（轮询读它）——**绝不丢帧**
    s.seq += 1;
    s.log.push([ev, payload, s.seq]);
    if (s.log.length > MAX_LOG) s.log.shift();
    // 2) 若挂了 SSE（可选路径），同时推一份
    if (s.res) {
      try {
        sseWrite(s.res, ev, payload);
      } catch {
        /* ignore */
      }
    }
  });
  ws.on('close', (code, reason) => {
    const text = String(reason ?? '');
    if (code === 1006 || code === 1008) dshCookie = null; // 可能是 cookie 失效，下次重建时重换
    console.log(`[bridge] session ${id} upstream closed (${code} ${text})`);
    closeSession(id, code || 1000, text || 'upstream closed');
  });
  ws.on('error', (err) => {
    console.log(`[bridge] session ${id} upstream error: ${err.message}`);
    // 上游连不上（例如 dsh 还没起来 / cookie 无效）→ 明确告知客户端
    if (s.res) {
      try {
        sseWrite(s.res, 'closed', JSON.stringify({ code: 1011, reason: err.message }));
        s.res.end();
      } catch {
        /* ignore */
      }
    }
    if (!s.ws) sessions.delete(id);
  });
  return { id, s };
}

/** 按游标取出帧并回给轮询客户端 */
function respondPoll(s, id, since, res) {
  const frames = [];
  for (const [ev, payload, seq] of s.log) {
    if (seq > since) frames.push([ev, payload]);
  }
  const next = s.log.length ? s.log[s.log.length - 1][2] : since;
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify({ id, next, frames }));
}

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://bridge.local');
  const id = url.searchParams.get('id') ?? '';

  if (req.method === 'GET' && url.pathname === '/wsbridge/ping') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }

  // 客户端适配脚本（页面用 <script src="/wsbridge/client.js"> 加载）
  if (req.method === 'GET' && url.pathname === '/wsbridge/client.js') {
    try {
      const js = readFileSync(new URL('./ws-bridge-client.js', import.meta.url));
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-cache',
      });
      res.end(js);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(`client script unavailable: ${e.message}`);
    }
    return;
  }

  // **短轮询**（下行主路径）：GET /wsbridge/poll?id=<id>&since=<seq>
  // 返回 { id, next, frames: [[event,payload],...] }；不带 id 时新建会话。
  if (req.method === 'GET' && url.pathname === '/wsbridge/poll') {
    const since = Number(url.searchParams.get('since') ?? 0) || 0;
    const existing = id ? sessions.get(id) : undefined;
    if (existing) {
      respondPoll(existing, id, since, res);
      return;
    }
    newSession(null)
      .then((created) => respondPoll(created.s, created.id, since, res))
      .catch((e) => {
        res.writeHead(503, { 'Content-Type': 'text/plain' });
        res.end(`bridge: ${e.message}`);
      });
    return;
  }

  // 客户端主动关闭（不等 linger，立即回收上游 WS）
  if (req.method === 'POST' && url.pathname === '/wsbridge/close') {
    closeSession(id, 1000, 'client closed');
    res.writeHead(204).end();
    return;
  }

  if (req.method === 'GET' && url.pathname === '/wsbridge/events') {
    if (id && sessions.has(id)) {
      attachSse(id, sessions.get(id), res);
      return;
    }
    newSession(res)
      .then((created) => attachSse(created.id, created.s, res))
      .catch((e) => console.log(`[bridge] 新建会话失败：${e.message}`));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/wsbridge/send') {
    let body = '';
    let tooBig = false;
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_UPLOAD) {
        tooBig = true;
        req.destroy();
      }
    });
    req.on('end', () => {
      if (tooBig) {
        res.writeHead(413).end('too large');
        return;
      }
      const s = sessions.get(id);
      if (!s || s.ws.readyState !== WebSocket.OPEN) {
        res.writeHead(409).end('no such session (or upstream not open)');
        return;
      }
      s.ws.send(body);
      res.writeHead(204).end();
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[bridge] listening 0.0.0.0:${PORT} → ${DSH_WS_URL}（Host 取请求里的 authority）`);
});
