/* 零依赖前端。自定义页面时保留 __APP_API_BASE__ 约定即可继续走平台对话接口。 */
(function () {
  const api = (typeof window !== 'undefined' && window.__APP_API_BASE__) || '';
  const state = { sessionId: null, attachments: [], busy: false };
  const $ = (id) => document.getElementById(id);
  const welcome = $('welcome');

  const icons = {
    bot: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3l1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7L12 3Z" fill="currentColor"/><path d="M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8L18 15Z" fill="currentColor" opacity=".7"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="8" r="3.5" stroke="currentColor" stroke-width="1.6"/><path d="M5 20c.7-4 3.1-6 7-6s6.3 2 7 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  };

  function scrollToLatest() {
    $('chat').scrollTo({ top: $('chat').scrollHeight, behavior: 'smooth' });
  }

  function addMessage(role, text, attachments) {
    welcome.hidden = true;
    const row = document.createElement('div');
    row.className = 'message-row ' + role;
    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.innerHTML = icons[role] || icons.bot;
    const bubble = document.createElement('div');
    bubble.className = 'msg';
    bubble.textContent = text;
    if (attachments && attachments.length) {
      const files = document.createElement('div');
      files.className = 'message-attachments';
      files.textContent = attachments.length + ' 个附件：' + attachments.map((file) => file.name).join('、');
      bubble.appendChild(files);
    }
    row.appendChild(avatar);
    row.appendChild(bubble);
    $('chat').appendChild(row);
    scrollToLatest();
    return row;
  }

  function addTyping() {
    const row = addMessage('bot', '');
    const bubble = row.querySelector('.msg');
    bubble.textContent = '';
    const typing = document.createElement('span');
    typing.className = 'typing';
    typing.setAttribute('aria-label', '正在思考');
    typing.innerHTML = '<i></i><i></i><i></i>';
    bubble.appendChild(typing);
    return row;
  }

  function renderReport(report) {
    const host = $('report');
    host.textContent = '';
    const sections = report && Array.isArray(report.sections) ? report.sections : [];
    sections.forEach((section) => {
      const box = document.createElement('div');
      box.className = 'section';
      const title = document.createElement('strong');
      title.textContent = section.name || '结果';
      box.appendChild(title);
      box.appendChild(document.createTextNode(section.content || ''));
      host.appendChild(box);
    });
    $('report-section').hidden = sections.length === 0;
    return sections.length > 0;
  }

  function renderAttachments(items) {
    const host = $('attachment-list');
    host.textContent = '';
    items.forEach((item) => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = item.name;
      const kind = document.createElement('span');
      kind.className = 'file-kind';
      kind.textContent = item.kind || 'file';
      li.appendChild(name);
      li.appendChild(kind);
      host.appendChild(li);
    });
    $('attachments-section').hidden = items.length === 0;
    return items.length > 0;
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
    const visible = host.children.length > 0;
    $('safety-section').hidden = !visible;
    return visible;
  }

  function showResults(data) {
    const hasReport = renderReport(data.report);
    const hasAttachments = renderAttachments(data.attachments || []);
    const hasSafety = renderSafety(data.safety || {});
    if (hasReport || hasAttachments || hasSafety) $('app-main').classList.add('has-results');
  }

  function setTheme(mode) {
    const next = mode === 'dark' ? 'dark' : 'light';
    $('app').dataset.theme = next;
    $('theme-label').textContent = next === 'dark' ? '浅色模式' : '深色模式';
  }

  function applyMeta(info) {
    if (!info) return;
    if (info.title) {
      $('app-title').textContent = info.title;
      document.title = info.title;
    }
    $('app-subtitle').textContent = info.subtitle || '你的专属智能助手';
    if (info.subtitle) $('welcome-description').textContent = info.subtitle;
    if (info.theme && info.theme.mode) setTheme(info.theme.mode);
    if (info.theme && info.theme.accent) {
      document.documentElement.style.setProperty('--accent', info.theme.accent);
    }
  }

  async function refreshAppInfo() {
    const injected = window.__APP_META__;
    if (injected) { applyMeta(injected); return; }
    try {
      const res = await fetch(api + '/api/app');
      if (!res.ok) return;
      applyMeta(await res.json());
    } catch (err) {
      /* 直接打开静态 HTML 时没有后端，保留默认文案。 */
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

  function setBusy(busy) {
    state.busy = busy;
    $('send-button').disabled = busy;
    $('new-chat').disabled = busy;
  }

  function resizeInput() {
    const input = $('message-input');
    input.style.height = '38px';
    input.style.height = Math.min(input.scrollHeight, 150) + 'px';
  }

  function renderPendingFiles() {
    const files = Array.from($('file-input').files || []);
    const host = $('pending-files');
    host.hidden = files.length === 0;
    host.textContent = files.length
      ? '已选择 ' + files.length + ' 个附件：' + files.map((file) => file.name).join('、')
      : '';
  }

  $('theme-toggle').addEventListener('click', () => {
    setTheme($('app').dataset.theme === 'dark' ? 'light' : 'dark');
  });

  $('results-close').addEventListener('click', () => $('app-main').classList.remove('has-results'));

  $('new-chat').addEventListener('click', () => {
    if (state.busy) return;
    state.sessionId = null;
    state.attachments = [];
    $('chat').replaceChildren(welcome);
    welcome.hidden = false;
    $('file-input').value = '';
    $('message-input').value = '';
    resizeInput();
    renderPendingFiles();
    renderReport(null);
    renderAttachments([]);
    renderSafety({});
    $('app-main').classList.remove('has-results');
    $('message-input').focus();
  });

  $('file-input').addEventListener('change', renderPendingFiles);
  $('message-input').addEventListener('input', resizeInput);
  $('message-input').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      if (!state.busy) $('composer').requestSubmit();
    }
  });

  document.querySelectorAll('[data-prompt]').forEach((button) => {
    button.addEventListener('click', () => {
      if (state.busy) return;
      $('message-input').value = button.dataset.prompt || '';
      resizeInput();
      $('composer').requestSubmit();
    });
  });

  $('composer').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (state.busy) return;
    const text = $('message-input').value.trim();
    const files = Array.from($('file-input').files || []);
    if (!text && files.length === 0) return;

    addMessage('user', text || '请分析这些附件。', files);
    $('message-input').value = '';
    resizeInput();
    setBusy(true);
    const typing = addTyping();

    try {
      const attachments = [];
      for (const file of files) {
        attachments.push({ name: file.name, data: await fileToBase64(file) });
      }
      const res = await fetch(api + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, session: state.sessionId, attachments }),
      });
      const raw = await res.json().catch(() => null);
      if (!res.ok) {
        const detail = raw && (raw.message || raw.error);
        throw new Error(detail || 'HTTP ' + res.status);
      }
      const data = raw && raw.data && typeof raw.data === 'object' ? raw.data : raw;
      if (!data) throw new Error('服务返回了空响应');
      if (data.session) state.sessionId = data.session;
      typing.remove();
      addMessage('bot', data.reply || '（没有回复）');
      showResults(data);
      if (data.attachments) state.attachments = data.attachments;
      $('file-input').value = '';
      renderPendingFiles();
    } catch (err) {
      typing.remove();
      addMessage('bot', '请求失败：' + (err instanceof Error ? err.message : String(err)) + '。请稍后重试。');
    } finally {
      setBusy(false);
      $('message-input').focus();
      scrollToLatest();
    }
  });

  refreshAppInfo();
  resizeInput();
})();
