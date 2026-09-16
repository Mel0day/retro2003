/* 小红书 2003 · 前端交互（渐进增强，不依赖任何库） */
(function () {
  'use strict';
  var CSRF = document.body.getAttribute('data-csrf') || '';

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function api(url, data, opts) {
    opts = opts || {};
    var init = {
      method: opts.method || 'POST',
      headers: { 'X-CSRF-Token': CSRF, 'X-Requested-With': 'fetch', Accept: 'application/json' },
      credentials: 'same-origin'
    };
    if (data instanceof FormData) init.body = data;
    else if (data !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(data); }
    return fetch(url, init).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: '服务器返回异常（' + r.status + '）' }; })
        .then(function (j) { if (r.status === 401 && !j.error) j.error = '请先登录'; return j; });
    });
  }
  window.XHS = { api: api, csrf: CSRF };

  // 验证码点击刷新
  document.addEventListener('click', function (e) {
    var img = e.target.closest && e.target.closest('img.captcha');
    if (img) img.src = '/captcha.svg?scope=' + encodeURIComponent(img.getAttribute('data-scope')) + '&t=' + Date.now();
  });
  $all('img.captcha').forEach(function (img) {
    // 每次打开页面都拿新验证码，避免浏览器缓存
    img.src = '/captcha.svg?scope=' + encodeURIComponent(img.getAttribute('data-scope')) + '&t=' + Date.now();
  });

  // 以 POST 方式提交的链接（退出、删除等）
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('[data-post-link]');
    if (!a) return;
    e.preventDefault();
    var msg = a.getAttribute('data-confirm');
    if (msg && !window.confirm(msg)) return;
    var f = document.createElement('form');
    f.method = 'post';
    f.action = a.getAttribute('href');
    var i = document.createElement('input');
    i.type = 'hidden'; i.name = '_csrf'; i.value = CSRF;
    f.appendChild(i);
    document.body.appendChild(f);
    f.submit();
  });

  // 表单提交前确认
  document.addEventListener('submit', function (e) {
    var msg = e.target.getAttribute('data-confirm');
    if (msg && !window.confirm(msg)) e.preventDefault();
  });
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('button[data-confirm]');
    if (b && !window.confirm(b.getAttribute('data-confirm'))) e.preventDefault();
  });

  // 设为首页 / 加入收藏（现代浏览器不支持脚本设置，给出提示）
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-sethome],[data-bookmark],[data-back]');
    if (!t) return;
    e.preventDefault();
    if (t.hasAttribute('data-back')) { history.length > 1 ? history.back() : (location.href = '/'); return; }
    var key = /Mac/i.test(navigator.platform) ? '⌘+D' : 'Ctrl+D';
    if (t.hasAttribute('data-bookmark')) alert('请按 ' + key + ' 把本站加入收藏夹，下次访问更方便！');
    else alert('请在浏览器「设置 → 启动时」中把 ' + location.origin + ' 设为首页。');
  });

  // 顶 / 收藏 / 送花 / 加好友等 AJAX 按钮
  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('[data-action]');
    if (!btn) return;
    e.preventDefault();
    if (btn.disabled) return;
    var confirmMsg = btn.getAttribute('data-ask');
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    btn.disabled = true;
    api(btn.getAttribute('data-action')).then(function (res) {
      btn.disabled = false;
      if (!res.ok) { alert(res.error || '操作失败'); if (res.login) location.href = '/login?next=' + encodeURIComponent(location.pathname); return; }
      if (res.count !== undefined) {
        $all('[data-count="' + btn.getAttribute('data-count-key') + '"]').forEach(function (el) { el.textContent = res.count; });
      }
      if (res.label) btn.textContent = res.label;
      if (res.message) alert(res.message);
      if (res.reload) location.reload();
    }).catch(function () { btn.disabled = false; alert('网络错误，请稍后再试'); });
  });

  // 插入文本到 textarea 光标处
  function insertAt(ta, before, after) {
    after = after || '';
    var s = ta.selectionStart || 0, en = ta.selectionEnd || 0;
    var sel = ta.value.slice(s, en);
    ta.value = ta.value.slice(0, s) + before + sel + after + ta.value.slice(en);
    var pos = s + before.length + sel.length + (sel ? after.length : 0);
    ta.focus();
    ta.setSelectionRange(pos, pos);
    ta.dispatchEvent(new Event('input'));
  }
  window.XHS.insertAt = insertAt;

  // 表情
  document.addEventListener('click', function (e) {
    var em = e.target.closest && e.target.closest('[data-emot]');
    if (!em) return;
    var form = em.closest('form');
    var ta = form && $('textarea', form);
    if (ta) insertAt(ta, em.getAttribute('data-emot') + ' ');
  });

  // 留言 [回复] [引用]
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-reply],[data-quote]');
    if (!b) return;
    e.preventDefault();
    var ta = document.getElementById(b.getAttribute('data-target') || 'reply-content');
    if (!ta) return;
    if (b.hasAttribute('data-reply')) {
      insertAt(ta, '回复 ' + b.getAttribute('data-reply') + '：');
    } else {
      var src = document.getElementById(b.getAttribute('data-quote'));
      var text = src ? (src.getAttribute('data-raw') || src.innerText) : '';
      text = text.replace(/\[quote[^\]]*\][\s\S]*?\[\/quote\]/g, '').trim();
      if (text.length > 200) text = text.slice(0, 200) + '……';
      insertAt(ta, '[quote=' + b.getAttribute('data-name') + ']' + text + '[/quote]\n');
    }
    ta.scrollIntoView({ block: 'center' });
  });

  // 正文字号 大 中 小
  document.addEventListener('click', function (e) {
    var f = e.target.closest && e.target.closest('[data-fontsize]');
    if (!f) return;
    e.preventDefault();
    var body = $('.note-body');
    if (!body) return;
    body.classList.remove('fs-l', 'fs-s');
    var v = f.getAttribute('data-fontsize');
    if (v) body.classList.add(v);
    try { localStorage.setItem('xhs-fs', v); } catch (err) { /* 忽略 */ }
  });
  try {
    var fs = localStorage.getItem('xhs-fs');
    if (fs && $('.note-body')) $('.note-body').classList.add(fs);
  } catch (err) { /* 忽略 */ }

  // 打印
  $all('[data-print]').forEach(function (b) { b.addEventListener('click', function (e) { e.preventDefault(); window.print(); }); });

  // ---------- UBB 编辑器 ----------
  $all('.editor-bar').forEach(function (bar) {
    var ta = document.getElementById(bar.getAttribute('data-editor'));
    if (!ta) return;
    bar.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b || !bar.contains(b)) return;
      var tag = b.getAttribute('data-tag');
      if (tag) {
        var p = b.getAttribute('data-prompt');
        if (p) {
          var v = window.prompt(p, 'http://');
          if (!v) return;
          insertAt(ta, '[' + tag + '=' + v + ']', '[/' + tag + ']');
        } else {
          insertAt(ta, '[' + tag + ']', '[/' + tag + ']');
        }
      }
      var ins = b.getAttribute('data-insert');
      if (ins) insertAt(ta, '\n' + ins + '\n');
      var pv = b.getAttribute('data-preview');
      if (pv) {
        var box = document.getElementById(pv + '-preview');
        if (!box) return;
        if (!box.classList.contains('hidden')) { box.classList.add('hidden'); return; }
        api('/api/ubb/preview', { content: ta.value, mode: ta.getAttribute('data-mode') || 'note' }).then(function (r) {
          box.innerHTML = r.ok ? (r.html || '<span class="gray">（空）</span>') : (r.error || '预览失败');
          box.classList.remove('hidden');
        });
      }
    });
    bar.addEventListener('change', function (e) {
      var s = e.target.closest('select[data-tag-arg]');
      if (s && s.value) {
        var t = s.getAttribute('data-tag-arg');
        insertAt(ta, '[' + t + '=' + s.value + ']', '[/' + t + ']');
        s.value = '';
      }
      var input = e.target.closest('input[data-upload]');
      if (input && input.files.length) uploadFiles(input.files, ta, bar.querySelector('[data-upload-status]'), input);
    });
  });

  // 前端压缩：长边超过 1280 的 JPG/PNG 先缩小再上传（GIF 保持原样以保留动画）
  function shrink(file) {
    return new Promise(function (resolve) {
      if (!/^image\/(jpeg|png|webp)$/.test(file.type) || !window.createImageBitmap) return resolve(file);
      createImageBitmap(file).then(function (bmp) {
        var max = 1280, w = bmp.width, h = bmp.height;
        if (Math.max(w, h) <= max && file.size <= 400 * 1024) return resolve(file);
        var scale = Math.min(1, max / Math.max(w, h));
        var cv = document.createElement('canvas');
        cv.width = Math.round(w * scale); cv.height = Math.round(h * scale);
        var g = cv.getContext('2d');
        g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
        g.drawImage(bmp, 0, 0, cv.width, cv.height);
        cv.toBlob(function (blob) {
          if (!blob || blob.size >= file.size) return resolve(file);
          resolve(new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }));
        }, 'image/jpeg', 0.82);
      }).catch(function () { resolve(file); });
    });
  }
  window.XHS.shrink = shrink;

  function uploadFiles(files, ta, status, input) {
    var list = Array.prototype.slice.call(files);
    var n = 0;
    function next() {
      if (!list.length) { if (status) status.textContent = n ? '上传完成 ' + n + ' 张' : ''; input.value = ''; return; }
      var f = list.shift();
      if (status) status.textContent = '正在上传 ' + f.name + ' …';
      shrink(f).then(function (small) {
        var fd = new FormData();
        fd.append('file', small, small.name);
        return api('/api/upload?purpose=' + (ta.getAttribute('data-purpose') || 'note'), fd);
      }).then(function (r) {
        if (!r.ok) { alert(r.error || '上传失败'); } else { n++; insertAt(ta, '\n[img=' + '图片说明' + ']' + r.url + '[/img]\n'); }
        next();
      }).catch(function () { alert('上传失败，请检查网络'); next(); });
    }
    next();
  }

  // 字数统计
  $all('textarea[data-maxlen]').forEach(function (ta) {
    var tip = document.querySelector('[data-len-for="' + ta.id + '"]');
    if (!tip) return;
    var upd = function () { tip.textContent = ta.value.length + ' / ' + ta.getAttribute('data-maxlen'); };
    ta.addEventListener('input', upd); upd();
  });
})();
