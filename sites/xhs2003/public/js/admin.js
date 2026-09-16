/* 管理后台：全选复选框 */
(function () {
  'use strict';
  document.addEventListener('change', function (e) {
    var all = e.target.closest && e.target.closest('[data-check-all]');
    if (!all) return;
    var name = all.getAttribute('data-check-all');
    Array.prototype.forEach.call(document.querySelectorAll('input[type=checkbox][name="' + name + '"]'), function (c) { c.checked = all.checked; });
  });
})();
/* 颜色选择器与文本框联动 */
(function () {
  'use strict';
  document.addEventListener('input', function (e) {
    var picker = e.target.closest && e.target.closest('[data-color-for]');
    if (!picker) return;
    var input = picker.form && picker.form.elements[picker.getAttribute('data-color-for')];
    if (input) input.value = picker.value;
  });
})();
