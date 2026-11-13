/* 零依赖前端：只用 fetch + DOM。所有请求都打到同源 /api/*，由 app_host.py 转到你的 harness。 */
(function () {
  // 平台在页面里注入 __APP_API_BASE__（分享/预览是 /lab/api/apps/share/<key>），
  // 本地自测没有注入 → 空串，请求打到同源 /api/*。
  const api = (typeof window !== 'undefined' && window.__APP_API_BASE__) || '';
  const state = { sessionId: null, attachments: [] };
  const themeNames = ['light', 'dark'];
  let themeIndex = 0;

  const $ = (id) => document.getElementById(id);

  function addMessage(role, text) {
    const el = document.createElement('div');
    el.className = 'msg ' + role;
    el.textContent = text;
    $('chat').appendChild(el);
    $('chat').scrollTop = $('chat').scrollHeight;
  }

  function renderReport(report) {
    if (!report || !report.sections) return;
    const host = $('report');
    host.textContent = '';
    report.sections.forEach((section) => {
      const box = document.createElement('div');
      box.className = 'section';
      const title = document.createElement('strong');
      title.textContent = section.name + '：';
      box.appendChild(title);
      box.appendChild(document.createTextNode(section.content || ''));
      host.appendChild(box);
    });
  }

  function renderAttachments(items) {
    const host = $('attachment-list');
    host.textContent = '';
    items.forEach((item) => {
      const li = document.createElement('li');
      li.textContent = item.name + '（' + item.kind + '）';
      host.appendChild(li);
    });
  }

  function renderSafety(safety) {
    const host = $('safety');
    host.textContent = '';
    (safety.escalations || []).forEach((row) => {
      const li = document.createElement('li');
      li.textContent = row.item + ' = ' + row.value + '，' + row.message;
      host.appendChild(li);
    });
    (safety.refusals || []).forEach((row) => {
      const li = document.createElement('li');
      li.textContent = '拒答：' + row.reason;
      host.appendChild(li);
    });
  }

  async function refreshAppInfo() {
    // 平台在 HTML 里注入 __APP_META__（sandbox iframe 里 fetch /api/app 是跨域，会失败）
    const injected = window.__APP_META__;
    if (injected) { applyMeta(injected); return; }
    try {
      const res = await fetch(api + '/api/app');
      const info = await res.json();
      applyMeta(info);
    } catch (err) {
      /* 本地直接打开 html 时没有后端，忽略即可 */
    }
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function applyMeta(info) {
    if (!info) return;
    if (info.title) $('app-title').textContent = info.title;
    if (info.subtitle) $('app-subtitle').textContent = info.subtitle;
    if (info.theme && info.theme.mode) $('app').dataset.theme = info.theme.mode;
    if (info.theme && info.theme.accent) {
      document.documentElement.style.setProperty('--accent', info.theme.accent);
    }
  }

  $('theme-toggle').addEventListener('click', () => {
    themeIndex = (themeIndex + 1) % themeNames.length;
    $('app').dataset.theme = themeNames[themeIndex];
  });

  $('composer').addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = $('message-input').value.trim();
    const files = Array.from($('file-input').files || []);
    if (!text && files.length === 0) return;

    addMessage('user', text || '（只上传了附件）');
    $('message-input').value = '';

    // 统一发 JSON + base64：平台分享端点与本地 app_host 都按这个契约收
    const attachments = [];
    for (const file of files) {
      attachments.push({ name: file.name, data: await fileToBase64(file) });
    }
    const payload = { message: text, session: state.sessionId, attachments };

    try {
      const res = await fetch(api + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const raw = await res.json();
      // 平台侧响应被包成 {code,data,message}；本地 app_host 返回裸对象 —— 两种都兼容
      const data = raw && raw.data && typeof raw.data === 'object' ? raw.data : raw;
      if (data.session) state.sessionId = data.session;
      addMessage('bot', data.reply || '（没有回复）');
      renderReport(data.report);
      renderSafety(data.safety || {});
      if (data.attachments) {
        state.attachments = data.attachments;
        renderAttachments(state.attachments);
      }
      $('file-input').value = '';
    } catch (err) {
      addMessage('bot', '请求失败：' + err);
    }
  });

  refreshAppInfo();
})();
