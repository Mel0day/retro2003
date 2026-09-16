/* 聊天室：SSE 实时接收，断线重连后按最后一条 ID 补拉。所有用户内容只用 textContent 渲染。 */
(function () {
  'use strict';
  var app = document.getElementById('chat-app');
  if (!app) return;
  var slug = app.getAttribute('data-slug');
  var tz = app.getAttribute('data-tz') || undefined;
  var me = app.getAttribute('data-me') || '';
  var lastId = parseInt(app.getAttribute('data-last-id'), 10) || 0;
  var log = document.getElementById('chat-log');
  var statusEl = document.getElementById('chat-status');
  var onlineList = document.getElementById('online-list');
  var onlineCount = document.getElementById('online-count');
  var form = document.getElementById('chat-form');
  var input = document.getElementById('chat-input');
  var toSel = document.getElementById('chat-to');
  var colorSel = document.getElementById('chat-color');
  var autoScroll = document.getElementById('chat-autoscroll');
  var tip = document.getElementById('chat-tip');

  function el(tag, text, attrs) {
    var e = document.createElement(tag);
    if (text !== undefined && text !== null) e.textContent = text;
    if (attrs) for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) e.setAttribute(k, attrs[k]);
    return e;
  }

  var COLOR_RE = /^#[0-9a-f]{6}$/i;
  function fmtTime(ts) {
    try {
      return new Date(ts * 1000).toLocaleTimeString('zh-CN', { hour12: false, timeZone: tz });
    } catch (e) {
      return new Date(ts * 1000).toLocaleTimeString('zh-CN', { hour12: false });
    }
  }

  function scrollDown(force) {
    if (force || !autoScroll || autoScroll.checked) log.scrollTop = log.scrollHeight;
  }

  function render(m) {
    if (!m || m.id <= lastId) return;
    lastId = m.id;
    var line = el('div', null, { class: 'chat-line', 'data-id': String(m.id) });
    line.appendChild(el('span', '[' + fmtTime(m.created_at) + '] ', { class: 'time' }));
    if (m.kind === 'system') {
      line.className += ' sys';
      line.appendChild(el('span', '【系统】' + m.content));
    } else {
      var color = COLOR_RE.test(m.color) ? m.color : '#000000';
      var body = el('span');
      body.style.color = color;
      var name = m.user_id ? el('a', m.username, { href: '/u/' + m.user_id, class: 'chat-name' }) : el('b', m.username);
      name.style.color = color;
      body.appendChild(name);
      var rest = ' ';
      if (m.action) rest += m.action;
      body.appendChild(document.createTextNode(rest));
      if (m.to_name) {
        body.appendChild(document.createTextNode(' 对 '));
        body.appendChild(el('b', m.to_name));
      }
      body.appendChild(document.createTextNode(' 说：' + m.content));
      line.appendChild(body);
      if (me && m.username === me) line.className += ' mine';
      else if (me && m.to_name === me) line.className += ' to-me';
    }
    log.appendChild(line);
    while (log.children.length > 300) log.removeChild(log.firstChild);
    scrollDown(false);
  }

  function renderPresence(p) {
    if (!p) return;
    while (onlineList.firstChild) onlineList.removeChild(onlineList.firstChild);
    (p.members || []).forEach(function (m) {
      var d = el('div', '👤 ' + m.name, { 'data-name': m.name, title: '对 ' + m.name + ' 说' });
      if (toSel && toSel.value === m.name) d.className = 'on';
      onlineList.appendChild(d);
    });
    onlineList.appendChild(el('div', '游客 ' + (p.guests || 0) + ' 人', { class: 'gray', 'data-guests': '' }));
    onlineCount.textContent = String((p.members || []).length + (p.guests || 0));
  }

  function setStatus(text, cls) {
    statusEl.textContent = text;
    statusEl.className = 'nb ' + (cls || '');
  }

  function catchUp() {
    fetch('/api/chat/' + encodeURIComponent(slug) + '/messages?after=' + lastId, { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok) return;
        j.messages.forEach(render);
        renderPresence(j.presence);
      }).catch(function () { /* 下次重连再补 */ });
  }

  var es = null;
  var pollTimer = null;
  function connect() {
    if (!window.EventSource) { startPolling(); return; }
    es = new EventSource('/api/chat/' + encodeURIComponent(slug) + '/stream');
    es.addEventListener('open', function () {
      setStatus('● 已连接', 'ok');
      catchUp();
    });
    es.addEventListener('message', function (e) {
      try { render(JSON.parse(e.data)); } catch (err) { /* 忽略坏数据 */ }
    });
    es.addEventListener('presence', function (e) {
      try { renderPresence(JSON.parse(e.data)); } catch (err) { /* 忽略 */ }
    });
    es.addEventListener('error', function () {
      setStatus('○ 连接断开，正在重连…', 'err');
      // EventSource 会自动重连；若被浏览器彻底关闭则手动重建
      if (es.readyState === 2) { es.close(); setTimeout(connect, 3000); }
    });
  }
  function startPolling() {
    setStatus('● 已连接（轮询模式）', 'ok');
    pollTimer = setInterval(catchUp, 3000);
  }

  // 点名单里的名字设为说话对象
  onlineList.addEventListener('click', function (e) {
    var d = e.target.closest('[data-name]');
    if (!d || !toSel) return;
    var name = d.getAttribute('data-name');
    if (name === me) return;
    var exists = false;
    for (var i = 0; i < toSel.options.length; i++) if (toSel.options[i].value === name) exists = true;
    if (!exists) toSel.appendChild(el('option', name, { value: name }));
    toSel.value = name;
    var all = onlineList.querySelectorAll('[data-name]');
    for (var j = 0; j < all.length; j++) all[j].className = all[j].getAttribute('data-name') === name ? 'on' : '';
    input && input.focus();
  });

  if (form) {
    try {
      var savedColor = localStorage.getItem('xhs-chat-color');
      if (savedColor) colorSel.value = savedColor;
    } catch (e) { /* 忽略 */ }
    colorSel.addEventListener('change', function () {
      try { localStorage.setItem('xhs-chat-color', colorSel.value); } catch (e) { /* 忽略 */ }
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var text = input.value.trim();
      if (!text) return;
      var data = { content: text, color: colorSel.value, to: toSel.value, action: form.elements.action.value };
      var btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      window.XHS.api('/api/chat/' + encodeURIComponent(slug) + '/send', data).then(function (res) {
        btn.disabled = false;
        if (!res.ok) { tip.textContent = res.error || '发送失败'; return; }
        tip.textContent = '';
        input.value = '';
        render(res.message);
        scrollDown(true);
        input.focus();
      }).catch(function () { btn.disabled = false; tip.textContent = '网络错误，发送失败'; });
    });
    document.getElementById('chat-clear').addEventListener('click', function () {
      while (log.firstChild) log.removeChild(log.firstChild);
    });
  }

  scrollDown(true);
  connect();
})();
