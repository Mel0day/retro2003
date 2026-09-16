// 淘宝网 2003：少量原生 JS。CSP 禁止内联脚本，所有事件在这里绑定；没有 JS 时所有功能照常可用。
(function () {
  'use strict';
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function yuan(c) { return '￥' + Math.floor(c / 100) + '.' + ('0' + (c % 100)).slice(-2); }

  // 数量加减（受库存上限约束）
  $$('.qbtn[data-qty]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var input = $('.qtyinput', btn.parentNode);
      if (!input) return;
      var max = parseInt(input.getAttribute('data-max'), 10) || 99;
      var v = (parseInt(input.value, 10) || 1) + parseInt(btn.getAttribute('data-qty'), 10);
      input.value = Math.max(1, Math.min(max, v));
      input.dispatchEvent(new Event('input'));
    });
  });
  $$('.qtyinput[data-max]').forEach(function (input) {
    input.addEventListener('change', function () {
      var max = parseInt(input.getAttribute('data-max'), 10) || 99;
      input.value = Math.max(1, Math.min(max, parseInt(input.value, 10) || 1));
      // 购物车里直接改数量：失去焦点即保存（回车走表单里第一个隐藏的「修改」按钮）
      if (input.hasAttribute('data-autosubmit') && input.form) {
        var def = $('.defbtn', input.form);
        if (def) def.click(); else input.form.submit();
      }
    });
  });

  // 详情页：「加入购物车」带上数量框里的数量
  var cartQty = $('#cartqty');
  var buyQty = $('#buyform .qtyinput');
  if (cartQty && buyQty) {
    var sync = function () { cartQty.value = buyQty.value; };
    buyQty.addEventListener('input', sync);
    buyQty.addEventListener('change', sync);
  }

  // 详情页：点缩略图换大图
  var big = $('#bigpic');
  $$('.thumbs div[data-src]').forEach(function (t) {
    t.addEventListener('click', function () {
      $$('.thumbs div').forEach(function (x) { x.classList.remove('on'); });
      t.classList.add('on');
      var img = $('img', big);
      if (!img) { img = document.createElement('img'); big.textContent = ''; big.appendChild(img); }
      img.src = t.getAttribute('data-src');
    });
  });

  // 收藏本站：2003 年的 IE 有 window.external.AddFavorite，现代浏览器只能提示
  $$('[data-action="fav"]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault();
      try { if (window.external && window.external.AddFavorite) return window.external.AddFavorite(location.href, document.title); } catch (err) { /* 非 IE */ }
      alert('请按 Ctrl+D（Mac 为 ⌘+D）把淘宝网加入收藏夹！');
    });
  });

  // 危险操作确认
  $$('form[data-confirm]').forEach(function (f) {
    f.addEventListener('submit', function (e) { if (!confirm(f.getAttribute('data-confirm'))) e.preventDefault(); });
  });

  // 表单提交后禁用提交按钮，防止重复提交
  $$('form[method="post"]').forEach(function (f) {
    f.addEventListener('submit', function (e) {
      if (e.defaultPrevented) return;
      setTimeout(function () { $$('button[type="submit"]', f).forEach(function (b) { if (!b.classList.contains('defbtn')) b.disabled = true; }); }, 0);
    });
  });

  // 结算页：配送方式改变时即时更新运费与应付总额；地址簿一键填入
  var grand = $('#grand');
  if (grand) {
    var recalc = function () {
      var sum = 0;
      $$('.gtotal').forEach(function (t) {
        var g = t.getAttribute('data-group');
        var checked = $('input[name="ship_' + g + '"]:checked');
        var fee = checked ? parseInt(checked.getAttribute('data-fee'), 10) || 0 : 0;
        var goods = parseInt(t.getAttribute('data-goods'), 10) || 0;
        var feeEl = $('.fee[data-group="' + g + '"]');
        if (feeEl) feeEl.textContent = yuan(fee);
        t.textContent = yuan(goods + fee);
        sum += goods + fee;
      });
      grand.textContent = yuan(sum);
      var expect = $('#expect');
      if (expect) expect.value = sum;
    };
    $$('#checkout input[type="radio"][data-fee]').forEach(function (r) { r.addEventListener('change', recalc); });
  }
  var book = $('#addrbook');
  if (book) {
    book.addEventListener('change', function () {
      var o = book.options[book.selectedIndex];
      if (!o || !o.value) return;
      $('input[name="receiver"]').value = o.getAttribute('data-receiver');
      $('input[name="address"]').value = o.getAttribute('data-address');
      $('input[name="tel"]').value = o.getAttribute('data-tel');
    });
  }
})();
