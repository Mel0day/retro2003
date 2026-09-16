// __NAME__：少量原生 JS。CSP 禁止内联脚本，事件都在这里绑定；关掉 JS 站点也能用。
(function () {
  'use strict';
  function $$(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }

  // 危险操作二次确认
  $$('form[data-confirm]').forEach(function (f) {
    f.addEventListener('submit', function (e) { if (!confirm(f.getAttribute('data-confirm'))) e.preventDefault(); });
  });

  // 防重复提交
  $$('form[method="post"]').forEach(function (f) {
    f.addEventListener('submit', function (e) {
      if (e.defaultPrevented) return;
      setTimeout(function () { $$('button[type="submit"]').forEach(function (b) { if (f.contains(b)) b.disabled = true; }); }, 0);
    });
  });

  // 加入收藏（2003 年的 IE 有 window.external.AddFavorite）
  $$('[data-action="fav"]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault();
      try { if (window.external && window.external.AddFavorite) return window.external.AddFavorite(location.href, document.title); } catch (err) { /* 非 IE */ }
      alert('请按 Ctrl+D（Mac 为 ⌘+D）把本站加入收藏夹！');
    });
  });
})();
