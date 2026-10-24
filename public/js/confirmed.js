(function () {
  var params = new URLSearchParams(location.search);
  if (params.get('mock') === '1') {
    var note = document.getElementById('sss-mock-note');
    if (note) note.hidden = false;
  }
  var token = params.get('token') || '';
  var status = document.getElementById('sss-confirmed-status');
  if (!token) {
    status.textContent = 'This page needs a lesson link.';
    return;
  }
  fetch('/api/booking?token=' + encodeURIComponent(token)).then(function (response) {
    return response.json().then(function (data) { return { ok: response.ok, data: data }; });
  }).then(function (result) {
    if (!result.ok || !result.data.booking) {
      status.textContent = 'This lesson link is not valid.';
      return;
    }
    var booking = result.data.booking;
    status.textContent = booking.child + ' — ' + booking.parent;
    document.getElementById('sss-confirmed-lessons').innerHTML = booking.lessons.map(function (lesson) {
      return '<li>' + String(lesson.label).replace(/[&<>"']/g, function (ch) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
      }) + '</li>';
    }).join('');
    document.getElementById('sss-manage-link').href = '/booking/manage/?token=' + encodeURIComponent(token);
  });
})();
