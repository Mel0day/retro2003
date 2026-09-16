/* 短消息列表：全选 */
(function () {
  var all = document.querySelector('[data-check-all]');
  if (!all) return;
  all.addEventListener('change', function () {
    var boxes = document.querySelectorAll('input[name="ids"]');
    for (var i = 0; i < boxes.length; i++) boxes[i].checked = all.checked;
  });
})();
