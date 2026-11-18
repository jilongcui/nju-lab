/* 零依赖三栏前端：左侧历史对话，中间聊天，右侧展示 Skill 生成的实验页面。 */
(function () {
  const api = (typeof window !== 'undefined' && window.__APP_API_BASE__) || '';
  const state = { sessionId: null, busy: false, conversationId: null };
  const $ = (id) => document.getElementById(id);
  const welcome = $('welcome');
  const historyHost = $('history-list');

  const icons = {
    bot: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3l1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7L12 3Z" fill="currentColor"/><path d="M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8L18 15Z" fill="currentColor" opacity=".7"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="8" r="3.5" stroke="currentColor" stroke-width="1.6"/><path d="M5 20c.7-4 3.1-6 7-6s6.3 2 7 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    delete: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M8 7l.6 13h6.8L16 7M10.5 11v5M13.5 11v5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };

  const memoryStorage = new Map();
  const storage = {
    get(key) {
      try { return window.localStorage.getItem(key); } catch { return memoryStorage.get(key) ?? null; }
    },
    set(key, value) {
      memoryStorage.set(key, value);
      try { window.localStorage.setItem(key, value); } catch { /* iframe sandbox 等场景退回内存历史 */ }
    },
  };

  const historyKey = (() => {
    const base = api || window.location.href;
    const scope = String(base).split('/').filter(Boolean).pop() || window.location.host || 'default';
    return `nju-agent-app-history:${scope}`;
  })();

  function uid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function sanitizeConversations(list) {
    if (!Array.isArray(list)) return [];
    return list
      .filter((item) => item && typeof item === 'object' && item.id)
      .map((item) => ({
        id: String(item.id),
        sessionId: typeof item.sessionId === 'string' ? item.sessionId : null,
        title: typeof item.title === 'string' && item.title.trim() ? item.title : '新的对话',
        createdAt: Number(item.createdAt) || Date.now(),
        updatedAt: Number(item.updatedAt) || Date.now(),
        messages: Array.isArray(item.messages)
          ? item.messages
              .filter((message) => message && (message.role === 'user' || message.role === 'bot') && typeof message.text === 'string')
              .map((message) => ({
                role: message.role,
                text: message.text,
                attachments: Array.isArray(message.attachments)
                  ? message.attachments.filter((file) => file && typeof file.name === 'string').map((file) => ({ name: file.name }))
                  : [],
              }))
          : [],
        results: {
          report: item.results && typeof item.results === 'object' ? item.results.report ?? null : null,
          attachments: item.results && Array.isArray(item.results.attachments)
            ? item.results.attachments.filter((file) => file && typeof file.name === 'string').map((file) => ({ name: file.name, kind: file.kind || 'file' }))
            : [],
          safety: item.results && item.results.safety && typeof item.results.safety === 'object' ? item.results.safety : { escalations: [], refusals: [] },
        },
      }));
  }

  function loadConversations() {
    try {
      return sanitizeConversations(JSON.parse(storage.get(historyKey) || '[]'));
    } catch {
      return [];
    }
  }

  let conversations = loadConversations();

  function saveConversations() {
    conversations.sort((a, b) => b.updatedAt - a.updatedAt);
    conversations = conversations.slice(0, 50);
    storage.set(historyKey, JSON.stringify(conversations));
  }

  function createConversation() {
    const now = Date.now();
    return {
      id: uid(),
      sessionId: null,
      title: '新的对话',
      createdAt: now,
      updatedAt: now,
      messages: [],
      results: { report: null, attachments: [], safety: { escalations: [], refusals: [] } },
    };
  }

  function currentConversation() {
    let conversation = conversations.find((item) => item.id === state.conversationId);
    if (!conversation) {
      conversation = createConversation();
      conversations.unshift(conversation);
      state.conversationId = conversation.id;
      saveConversations();
    }
    return conversation;
  }

  function formatTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const sameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
    const hm = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    return sameDay ? hm : `${date.getMonth() + 1}/${date.getDate()} ${hm}`;
  }

  function conversationTitle(text, attachments) {
    const source = text || (attachments && attachments[0] ? attachments[0].name : '') || '新的对话';
    const compact = source.replace(/\s+/g, ' ').trim();
    return compact.length > 30 ? `${compact.slice(0, 30)}…` : compact;
  }

  function scrollToLatest() {
    $('chat').scrollTo({ top: $('chat').scrollHeight, behavior: 'smooth' });
  }

  function appendMessageElement(role, text, attachments) {
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

  function renderHistory() {
    conversations.sort((a, b) => b.updatedAt - a.updatedAt);
    $('history-count').textContent = String(conversations.length);
    historyHost.textContent = '';
    if (conversations.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'history-empty';
      empty.textContent = '暂无历史对话';
      historyHost.appendChild(empty);
      return;
    }
    conversations.forEach((conversation) => {
      const item = document.createElement('div');
      item.className = 'history-item' + (conversation.id === state.conversationId ? ' active' : '');
      item.dataset.id = conversation.id;

      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'history-open';
      const title = document.createElement('span');
      title.className = 'history-title';
      title.textContent = conversation.title;
      const time = document.createElement('span');
      time.className = 'history-time';
      time.textContent = formatTime(conversation.updatedAt);
      open.appendChild(title);
      open.appendChild(time);

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'history-delete';
      del.title = '删除对话';
      del.setAttribute('aria-label', '删除对话：' + conversation.title);
      del.innerHTML = icons.delete;

      item.appendChild(open);
      item.appendChild(del);
      historyHost.appendChild(item);
    });
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
    return sections;
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
    $('safety-section').hidden = host.children.length === 0;
  }

  function renderResults(results) {
    const current = results || { report: null, attachments: [], safety: { escalations: [], refusals: [] } };
    const sections = renderReport(current.report);
    renderAttachments(current.attachments || []);
    renderSafety(current.safety || {});
    const hasContent = sections.length > 0 || (current.attachments || []).length > 0 || ((current.safety || {}).escalations || []).length > 0 || ((current.safety || {}).refusals || []).length > 0;
    $('report-empty').hidden = hasContent;
    if (sections.length) $('display-title').textContent = sections[0].name || '应用展示';
    else if (hasContent) $('display-title').textContent = '附件与安全提示';
    else $('display-title').textContent = '等待生成结果';
  }

  function renderConversation(conversation) {
    state.conversationId = conversation.id;
    state.sessionId = conversation.sessionId || null;
    const chat = $('chat');
    chat.textContent = '';
    chat.appendChild(welcome);
    welcome.hidden = conversation.messages.length > 0;
    conversation.messages.forEach((message) => appendMessageElement(message.role, message.text, message.attachments));
    $('chat').scrollTop = $('chat').scrollHeight;
    renderResults(conversation.results);
    renderHistory();
    $('file-input').value = '';
    renderPendingFiles();
  }

  function addMessage(role, text, attachments) {
    const conversation = currentConversation();
    conversation.messages.push({
      role,
      text,
      attachments: (attachments || []).map((file) => ({ name: file.name })),
    });
    if (role === 'user' && conversation.messages.filter((message) => message.role === 'user').length === 1) {
      conversation.title = conversationTitle(text, attachments);
    }
    conversation.updatedAt = Date.now();
    saveConversations();
    renderHistory();
    return appendMessageElement(role, text, attachments);
  }

  function addTyping() {
    const row = appendMessageElement('bot', '');
    const bubble = row.querySelector('.msg');
    bubble.textContent = '';
    const typing = document.createElement('span');
    typing.className = 'typing';
    typing.setAttribute('aria-label', '正在思考');
    typing.innerHTML = '<i></i><i></i><i></i>';
    bubble.appendChild(typing);
    return row;
  }

  function startNewConversation() {
    if (state.busy) return;
    const current = currentConversation();
    if (current.messages.length === 0) {
      $('message-input').focus();
      return;
    }
    const conversation = createConversation();
    conversations.unshift(conversation);
    state.conversationId = conversation.id;
    saveConversations();
    renderConversation(conversation);
    $('app').classList.remove('panel-open');
    $('message-input').focus();
  }

  function selectConversation(id) {
    if (state.busy) return;
    const conversation = conversations.find((item) => item.id === id);
    if (!conversation) return;
    renderConversation(conversation);
    $('app').classList.remove('sidebar-open');
    $('message-input').focus();
  }

  function deleteConversation(id) {
    if (state.busy) return;
    conversations = conversations.filter((item) => item.id !== id);
    if (state.conversationId === id) {
      state.conversationId = null;
      renderConversation(conversations[0] || createConversation());
      if (!conversations.some((item) => item.id === state.conversationId)) {
        conversations.unshift(currentConversation());
      }
    }
    saveConversations();
    renderHistory();
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
      $('sidebar-title').textContent = info.title;
      document.title = info.title;
    }
    const subtitle = info.subtitle || '你的专属智能助手';
    $('app-subtitle').textContent = subtitle;
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
    input.style.height = '37px';
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

  historyHost.addEventListener('click', (event) => {
    const deleteButton = event.target.closest('.history-delete');
    if (deleteButton) {
      const item = deleteButton.closest('.history-item');
      if (item) deleteConversation(item.dataset.id);
      return;
    }
    const openButton = event.target.closest('.history-open');
    if (openButton) selectConversation(openButton.closest('.history-item').dataset.id);
  });

  $('theme-toggle').addEventListener('click', () => {
    setTheme($('app').dataset.theme === 'dark' ? 'light' : 'dark');
  });

  $('new-chat').addEventListener('click', startNewConversation);
  $('history-toggle').addEventListener('click', () => $('app').classList.toggle('sidebar-open'));
  $('panel-toggle').addEventListener('click', () => $('app').classList.toggle('panel-open'));
  $('results-close').addEventListener('click', () => $('app').classList.remove('panel-open'));

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

    const conversation = currentConversation();
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
        body: JSON.stringify({ message: text, session: conversation.sessionId, attachments }),
      });
      const raw = await res.json().catch(() => null);
      if (!res.ok) {
        const detail = raw && (raw.message || raw.error);
        throw new Error(detail || 'HTTP ' + res.status);
      }
      const data = raw && raw.data && typeof raw.data === 'object' ? raw.data : raw;
      if (!data) throw new Error('服务返回了空响应');
      typing.remove();
      addMessage('bot', data.reply || (data.report ? '已生成右侧展示结果。' : '（没有回复）'));
      conversation.sessionId = data.session || conversation.sessionId;
      conversation.results = {
        report: data.report || null,
        attachments: (data.attachments || []).map((item) => ({ name: item.name, kind: item.kind || 'file' })),
        safety: data.safety || { escalations: [], refusals: [] },
      };
      conversation.updatedAt = Date.now();
      saveConversations();
      renderHistory();
      renderResults(conversation.results);
      $('app').classList.add('panel-open');
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

  const initialConversation = conversations[0] || createConversation();
  if (!conversations.some((item) => item.id === initialConversation.id)) conversations.unshift(initialConversation);
  state.conversationId = initialConversation.id;
  saveConversations();
  renderConversation(initialConversation);
  refreshAppInfo();
  resizeInput();
})();
