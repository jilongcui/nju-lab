/* 零依赖前端：只用 fetch + DOM。所有请求都打到同源 /api/*，由 app_host.py 转到你的 harness。 */
(function () {
  const api = '';
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
    try {
      const res = await fetch(api + '/api/app');
      const info = await res.json();
      if (info.title) $('app-title').textContent = info.title;
      if (info.subtitle) $('app-subtitle').textContent = info.subtitle;
      if (info.theme && info.theme.mode) $('app').dataset.theme = info.theme.mode;
      if (info.theme && info.theme.accent) {
        document.documentElement.style.setProperty('--accent', info.theme.accent);
      }
    } catch (err) {
      /* 本地直接打开 html 时没有后端，忽略即可 */
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

    const form = new FormData();
    form.append('message', text);
    if (state.sessionId) form.append('session', state.sessionId);
    files.forEach((file) => form.append('attachments', file, file.name));

    try {
      const res = await fetch(api + '/api/chat', { method: 'POST', body: form });
      const data = await res.json();
      if (data.session) state.sessionId = data.session;
      addMessage('bot', data.reply || '（没有回复）');
      lastReport = data.report;
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

  let lastReport = null;

  document.getElementById('download-report').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(lastReport || {}, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'report.json';
    a.click();
    URL.revokeObjectURL(url);
  });

  refreshAppInfo();
})();
