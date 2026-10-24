(function () {
  var params = new URLSearchParams(location.search);
  var token = params.get('token') || '';
  var status = document.getElementById('sss-manage-status');
  var list = document.getElementById('sss-manage-lessons');
  var picker = document.getElementById('sss-reschedule');
  var pickerSlots = document.getElementById('sss-reschedule-slots');
  var activeLesson = '';

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function load() {
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
      render(result.data.booking);
    });
  }

  function render(booking) {
    status.textContent = booking.child + ' — ' + booking.parent;
    list.innerHTML = booking.lessons.map(function (lesson) {
      var detail = lesson.status === 'taught' ? 'Counted as a lesson taught.' : escapeHtml(lesson.label);
      var id = escapeHtml(lesson.id);
      var actions = '';
      if (lesson.status === 'scheduled' && lesson.reschedule) {
        actions = '<button type="button" class="sss-btn" data-reschedule="' + id + '">Reschedule</button> <button type="button" data-skip="' + id + '">Don\'t pick a new time</button>';
      } else if (lesson.status === 'scheduled') {
        actions = '<button type="button" class="sss-btn" data-count="' + id + '">Cancel</button>';
      }
      return '<li><p>' + detail + '</p>' + actions + '</li>';
    }).join('');
  }

  function post(action, lessonId, start) {
    var body = { token: token, action: action, lessonId: lessonId };
    if (start) body.start = start;
    return fetch('/api/booking', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (response) {
      return response.json().then(function (data) { return { ok: response.ok, data: data }; });
    }).then(function (result) {
      if (!result.ok) {
        status.textContent = result.data && result.data.error === 'counts-as-taught'
          ? 'This cancellation counts as a lesson taught.'
          : 'That time is not open.';
        return;
      }
      token = result.data.token;
      history.replaceState(null, '', '/booking/manage/?token=' + encodeURIComponent(token));
      picker.hidden = true;
      render(result.data.booking);
    });
  }

  list.addEventListener('click', function (event) {
    var reschedule = event.target.closest('[data-reschedule]');
    var skip = event.target.closest('[data-skip]');
    var count = event.target.closest('[data-count]');
    if (reschedule) {
      activeLesson = reschedule.getAttribute('data-reschedule');
      picker.hidden = false;
      fetch('/api/availability?days=21').then(function (response) { return response.json(); }).then(function (data) {
        var open = (data.slots || []).filter(function (slot) { return slot.state === 'open'; }).slice(0, 12);
        pickerSlots.innerHTML = open.map(function (slot) {
          var label = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(slot.start));
          return '<button type="button" class="sss-slot" data-start="' + slot.start + '">' + label + '</button>';
        }).join('');
      });
      return;
    }
    if (skip) post('skip', skip.getAttribute('data-skip'));
    if (count) post('count', count.getAttribute('data-count'));
  });

  pickerSlots.addEventListener('click', function (event) {
    var button = event.target.closest('[data-start]');
    if (!button || !activeLesson) return;
    post('reschedule', activeLesson, button.getAttribute('data-start'));
  });

  load();
})();
