/* 相册上传：逐张压缩后用 fetch 上传，显示进度；无 JS 时表单照常提交 */
(function () {
  'use strict';
  var form = document.getElementById('album-upload');
  if (!form || !window.XHS || !window.fetch || !window.FormData) return;
  var input = form.querySelector('input[type=file]');
  var progress = form.querySelector('[data-progress]');
  var button = form.querySelector('button[type=submit]');
  var url = '/album/' + form.getAttribute('data-album') + '/upload';

  form.addEventListener('submit', function (e) {
    var files = Array.prototype.slice.call(input.files || []);
    if (!files.length) return;
    e.preventDefault();
    if (files.length > 10) { alert('一次最多上传 10 张照片'); return; }
    button.disabled = true;
    var ok = 0, errors = [], i = 0;
    function next() {
      if (i >= files.length) {
        progress.textContent = '上传完成：成功 ' + ok + ' 张' + (errors.length ? '，失败 ' + errors.length + ' 张' : '');
        if (errors.length) alert(errors.join('\n'));
        if (ok) setTimeout(function () { location.reload(); }, 600); else button.disabled = false;
        return;
      }
      var f = files[i++];
      progress.textContent = '正在上传第 ' + i + ' / ' + files.length + ' 张：' + f.name + ' …';
      window.XHS.shrink(f).then(function (small) {
        var fd = new FormData();
        fd.append('photos', small, small.name);
        return window.XHS.api(url, fd);
      }).then(function (res) {
        if (res.ok) ok += res.saved || 1; else errors.push(f.name + '：' + (res.error || '上传失败'));
        next();
      }).catch(function () { errors.push(f.name + '：网络错误'); next(); });
    }
    next();
  });
})();
