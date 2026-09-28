/*
 * NJU-Lab 平台侧工作台 —— WebSocket → 普通 HTTPS 适配层（客户端）
 *
 * 由容器内的桥托管（GET /wsbridge/client.js），页面在 <base> 之后、dsh 的 boot 脚本
 * 之前同步加载。它只做一件事：把 `new WebSocket('…/api/remote.mux')` 换成"走桥"的实现，
 * 其余 WebSocket 一律**原样交给原生实现**。
 *
 * 自动降级：桥不可用（/wsbridge/ping 失败）时，内部直接回退到原生 WebSocket ——
 * 所以"明天网关开好 WS 后切回 A"只需让桥不启动（容器环境变量），页面无需改动。
 *
 * 与原生 WebSocket 的差异（有意为之）：
 *   · binaryType 固定按 'arraybuffer' 投递（桥用 base64 传二进制帧）
 *   · close(code, reason) 会通知桥立即回收上游连接（不等 linger）
 *   · 不做"协议协商"（dsh 也不传子协议）
 */
(function () {
  'use strict';
  if (window.__njuWsBridgeInstalled) return;
  window.__njuWsBridgeInstalled = true;

  var Native = window.WebSocket;
  if (!Native) return;

  var EP = '/wsbridge';
  // 跨 new WebSocket 记住上一次的会话 id：重连时复用它，桥那边就能接着用**同一条上游 WS**，
  // dsh 侧的多路复用状态才不会每次重连都被重置（否则永远等不到 generation）。
  var LAST_SESSION_ID = null;
  var LAST_SESSION_URL = null;
  var MATCH = /\/api\/remote\.mux(?:[?#]|$)/;
  /**
   * 下行用**短轮询**而不是 SSE：校园网关会在 ~20 秒后掐掉任何流式响应
   * （2026-09-29 实测：宿主直连的 SSE 能活 50s，经网关只活 16-24s，且心跳无效）。
   * 轮询对长连接零假设。1 秒一轮：延迟可接受，请求量 1 人 1 req/s。
   */
  var POLL_MS = 1000;
  var CONNECTING = 0, OPEN = 1, CLOSING = 2, CLOSED = 3;

  function decode(b64) {
    var bin = atob(b64), len = bin.length, out = new Uint8Array(len);
    for (var i = 0; i < len; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  }

  function Bridged(url, protocols) {
    var self = this;
    this.url = String(url);
    this.readyState = CONNECTING;
    this.binaryType = 'arraybuffer';
    this.bufferedAmount = 0;
    this.protocol = '';
    this.extensions = '';
    this.onopen = this.onmessage = this.onclose = this.onerror = null;

    this._native = null;
    this._id = null;
    this._abort = new AbortController();
    this._sseAbort = null;
    this._pollTimer = null;
    this._closed = false;
    this._queue = [];

    if (!MATCH.test(this.url)) {
      this._useNative(url, protocols);
      return;
    }
    this._start(url);
  }

  Bridged.prototype._emit = function (type, init, handlerName) {
    var ev;
    try {
      ev = new Event(type);
      for (var k in init) ev[k] = init[k];
    } catch (e) {
      ev = init;
    }
    var h = this[handlerName];
    if (typeof h === 'function') {
      try { h.call(this, ev); } catch (e) { /* 监听器异常不影响连接 */ }
    }
    var list = this._listeners && this._listeners[type];
    if (list) for (var i = 0; i < list.length; i++) {
      try { list[i].call(this, ev); } catch (e) { /* ignore */ }
    }
  };

  Bridged.prototype.addEventListener = function (type, fn) {
    (this._listeners = this._listeners || {});
    (this._listeners[type] = this._listeners[type] || []).push(fn);
    if (this._native) this._native.addEventListener(type, fn);
  };
  Bridged.prototype.removeEventListener = function (type, fn) {
    var list = this._listeners && this._listeners[type];
    if (!list) return;
    var i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  };
  Bridged.prototype.dispatchEvent = function (ev) { this._emit(ev.type, ev, 'on' + ev.type); return true; };

  /** 桥不可用（或 URL 不该走桥）→ 完全退回原生 WebSocket */
  Bridged.prototype._useNative = function (url, protocols) {
    var self = this;
    this._native = protocols === undefined ? new Native(url) : new Native(url, protocols);
    var n = this._native;
    n.binaryType = this.binaryType;
    n.onopen = function (e) { self.readyState = OPEN; self._emit('open', { type: 'open' }, 'onopen'); };
    n.onmessage = function (e) { self._emit('message', { type: 'message', data: e.data }, 'onmessage'); };
    n.onclose = function (e) {
      self.readyState = CLOSED;
      self._emit('close', { type: 'close', code: e.code, reason: e.reason, wasClean: e.wasClean }, 'onclose');
    };
    n.onerror = function (e) { self._emit('error', { type: 'error', message: e.message || 'websocket error' }, 'onerror'); };
  };

  Bridged.prototype._start = function (url) {
    var self = this;
    var pingTimeout = (typeof AbortSignal !== 'undefined' && AbortSignal.timeout)
      ? AbortSignal.timeout(2000) : undefined;
    fetch(EP + '/ping', { signal: pingTimeout, cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('bridge disabled'); self._startPolling(url); })
      .catch(function () { self._useNative(url); });
  };

  /** 下行主路径：短轮询（`GET /wsbridge/poll?id=&since=`） */
  Bridged.prototype._startPolling = function (url) {
    var self = this;
    var since = 0;
    var wait = POLL_MS;
    var tick = function () {
      if (self._closed) return;
      var q = '?since=' + since + (self._id ? '&id=' + encodeURIComponent(self._id) : '');
      fetch(EP + '/poll' + q, { cache: 'no-store' })
        .then(function (r) {
          if (!r.ok) throw new Error('poll HTTP ' + r.status);
          return r.json();
        })
        .then(function (body) {
          wait = POLL_MS;
          if (body.id) {
            self._id = body.id;
            LAST_SESSION_ID = body.id;
            LAST_SESSION_URL = self.url;
            if (self.readyState === CONNECTING) {
              self.readyState = OPEN;
              self._emit('open', { type: 'open' }, 'onopen');
              var q0 = self._queue;
              self._queue = [];
              for (var i = 0; i < q0.length; i++) self.send(q0[i]);
            }
          }
          (body.frames || []).forEach(function (f) {
            if (f[0] === 'text') {
              self._emit('message', { type: 'message', data: f[1] }, 'onmessage');
            } else if (f[0] === 'bin') {
              var buf;
              try { buf = decode(JSON.parse(f[1]).b64); } catch (e) { buf = new ArrayBuffer(0); }
              self._emit('message', { type: 'message', data: buf }, 'onmessage');
            } else if (f[0] === 'closed') {
              // 上游（dsh）把这条会话关了：忘掉它，下次重连要**新建**，
              // 否则每个新对象都会取到同一条 closed 反复重连（死循环）。
              var code = 1000, reason = 'closed';
              try { var j = JSON.parse(f[1]); code = j.code || 1000; reason = j.reason || ''; } catch (e) { /* ignore */ }
              if (LAST_SESSION_ID === self._id) { LAST_SESSION_ID = null; LAST_SESSION_URL = null; }
              self._id = null;
              self.readyState = CLOSED;
              self._closed = true;
              if (self._pollTimer) clearTimeout(self._pollTimer);
              self._emit('close', { type: 'close', code: code, reason: reason, wasClean: code === 1000 }, 'onclose');
            }
          });
          if (typeof body.next === 'number') since = body.next;
        })
        .catch(function () { wait = Math.min(wait * 2, 5000); })
        .then(function () { if (!self._closed) self._pollTimer = setTimeout(tick, wait); });
    };
    tick();
  };

  /** 备选路径：SSE 长连接（当前不用 —— 网关会掐；将来网关支持长连接可切回） */
  Bridged.prototype._openStream = function (url) {
    var self = this;
    this._sseAbort = new AbortController();
    var reuse = (LAST_SESSION_URL === url && LAST_SESSION_ID)
      ? '?id=' + encodeURIComponent(LAST_SESSION_ID)
      : '';
    return fetch(EP + '/events' + reuse, { signal: this._sseAbort.signal, cache: 'no-store' })
      .then(function (res) {
        if (!res.ok || !res.body) throw new Error('bridge unavailable');
        var reader = res.body.getReader();
        var dec = new TextDecoder();
        var buf = '';
        var pump = function () {
          return reader.read().then(function (r) {
            if (r.done) throw new Error('stream ended');
            buf += dec.decode(r.value, { stream: true });
            var idx;
            while ((idx = buf.indexOf('\n\n')) >= 0) {
              var raw = buf.slice(0, idx);
              buf = buf.slice(idx + 2);
              self._handleEvent(raw);
            }
            return pump();
          });
        };
        return pump();
      })
      .catch(function (err) {
        if (self._closed) return;
        if (self.readyState === CONNECTING || self.readyState === OPEN) {
          self.readyState = CLOSED;
          self._emit('close', { type: 'close', code: 1006, reason: String(err && err.message || 'bridge stream ended'), wasClean: false }, 'onclose');
        }
      });
  };

  Bridged.prototype._handleEvent = function (raw) {
    var lines = raw.split('\n');
    var event = 'message', data = '';
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line.indexOf('event: ') === 0) event = line.slice(7).trim();
      else if (line.indexOf('data: ') === 0) data += line.slice(6);
      else if (line.charAt(0) === ':') return; // 心跳/注释
    }
    var self = this;
    if (event === 'ka') return; // 心跳（保活用的空事件）
    if (event === 'ready') {
      try {
        this._id = JSON.parse(data).id;
        LAST_SESSION_ID = this._id;
        LAST_SESSION_URL = this.url;
      } catch (e) { /* ignore */ }
      if (this.readyState === CONNECTING) {
        this.readyState = OPEN;
        this._emit('open', { type: 'open' }, 'onopen');
      }
      var q = this._queue; this._queue = [];
      for (var j = 0; j < q.length; j++) this.send(q[j]);
      return;
    }
    if (event === 'open') {
      if (this.readyState === CONNECTING) {
        this.readyState = OPEN;
        this._emit('open', { type: 'open' }, 'onopen');
      }
      return;
    }
    if (event === 'text') {
      this._emit('message', { type: 'message', data: data }, 'onmessage');
      return;
    }
    if (event === 'bin') {
      var payload;
      try { payload = decode(JSON.parse(data).b64); } catch (e) { payload = new ArrayBuffer(0); }
      this._emit('message', { type: 'message', data: payload }, 'onmessage');
      return;
    }
    if (event === 'closed') {
      var code = 1000, reason = 'closed';
      try { var j = JSON.parse(data); code = j.code || 1000; reason = j.reason || ''; } catch (e) { /* ignore */ }
      this.readyState = CLOSED;
      this._emit('close', { type: 'close', code: code, reason: reason, wasClean: code === 1000 }, 'onclose');
      return;
    }
  };

  Bridged.prototype.send = function (data) {
    if (this._native) return this._native.send(data);
    if (this.readyState === CONNECTING) { this._queue.push(data); return; }
    if (this.readyState !== OPEN || !this._id) throw new Error('websocket is not open');
    fetch(EP + '/send?id=' + encodeURIComponent(this._id), {
      method: 'POST',
      body: data,
      cache: 'no-store',
      keepalive: true,
    }).catch(function () { /* 上行失败由 SSE 断开/重连逻辑兜底 */ });
  };

  Bridged.prototype.close = function (code, reason) {
    if (this._native) return this._native.close(code, reason);
    if (this._closed) return;
    this._closed = true;
    this.readyState = CLOSING;
    var id = this._id;
    if (this._pollTimer) clearTimeout(this._pollTimer);
    try { this._sseAbort && this._sseAbort.abort(); } catch (e) { /* ignore */ }
    if (id) {
      fetch(EP + '/close?id=' + encodeURIComponent(id), { method: 'POST', keepalive: true })
        .catch(function () { /* ignore */ });
    }
    var self = this;
    setTimeout(function () {
      self.readyState = CLOSED;
      self._emit('close', { type: 'close', code: code || 1000, reason: reason || '', wasClean: true }, 'onclose');
    }, 0);
  };

  Bridged.CONNECTING = CONNECTING;
  Bridged.OPEN = OPEN;
  Bridged.CLOSING = CLOSING;
  Bridged.CLOSED = CLOSED;

  window.WebSocket = Bridged;
})();
