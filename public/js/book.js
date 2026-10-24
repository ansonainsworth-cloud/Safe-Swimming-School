(function () {
  var selected = [];
  var needed = 0;
  var slots = [];

  function packageInput() {
    return document.querySelector('input[name="package"]:checked');
  }

  function setNeeded() {
    var input = packageInput();
    needed = input ? Number(input.getAttribute('data-lessons')) : 0;
    if (selected.length > needed) selected = selected.slice(0, needed);
  }

  var preset = new URLSearchParams(location.search).get('package');
  document.querySelectorAll('input[name="package"]').forEach(function (input) {
    if (input.value === preset) input.checked = true;
    input.addEventListener('change', function () {
      setNeeded();
      render();
    });
  });
  setNeeded();

  function dayKey(iso) {
    return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(iso));
  }

  function timeLabel(iso) {
    return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
  }

  function render() {
    var root = document.getElementById('sss-slots');
    var byDay = [];
    var index = {};
    slots.forEach(function (slot) {
      var key = dayKey(slot.start);
      if (!Object.prototype.hasOwnProperty.call(index, key)) {
        index[key] = byDay.length;
        byDay.push({ day: key, slots: [] });
      }
      byDay[index[key]].slots.push(slot);
    });
    root.innerHTML = byDay.map(function (group) {
      var buttons = group.slots.map(function (slot) {
        var on = selected.indexOf(slot.start) !== -1;
        var disabled = slot.state !== 'open';
        return '<button type="button" class="sss-slot" data-start="' + slot.start + '" aria-pressed="' + (on ? 'true' : 'false') + '"' + (disabled ? ' disabled' : '') + '>' + timeLabel(slot.start) + (disabled ? ' unavailable' : '') + '</button>';
      }).join('');
      return '<section class="sss-day"><h2>' + group.day + '</h2>' + buttons + '</section>';
    }).join('');
    document.getElementById('sss-count').textContent = selected.length + ' of ' + needed + ' lessons selected';
    document.getElementById('sss-continue').disabled = !needed || selected.length !== needed;
  }

  document.getElementById('sss-slots').addEventListener('click', function (event) {
    var button = event.target.closest('.sss-slot');
    if (!button || button.disabled) return;
    var start = button.getAttribute('data-start');
    var at = selected.indexOf(start);
    if (at !== -1) selected.splice(at, 1);
    else if (selected.length < needed) selected.push(start);
    render();
  });

  fetch('/api/availability?days=14').then(function (response) {
    return response.json();
  }).then(function (data) {
    if (data && data.policy) document.getElementById('sss-policy').textContent = data.policy;
    slots = data && data.slots ? data.slots : [];
    render();
  });

  document.getElementById('sss-book-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var item = packageInput();
    var message = document.getElementById('sss-book-message');
    message.textContent = '';
    var body = {
      itemId: item.value,
      quantity: 1,
      email: document.getElementById('sss-email').value,
      parent: document.getElementById('sss-parent').value,
      child: document.getElementById('sss-child').value,
      slots: selected.slice()
    };
    fetch('/api/hold', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (response) {
      return response.json().then(function (data) { return { ok: response.ok, data: data }; });
    }).then(function (result) {
      if (!result.ok) {
        if (result.data && result.data.error === 'invalid-buyer') message.textContent = 'Enter a child name, parent name, and email.';
        else if (result.data && result.data.error === 'invalid-slot-count') message.textContent = 'Select a time for every lesson.';
        else message.textContent = 'One of those times is no longer open.';
        return;
      }
      localStorage.setItem('sss-cart', JSON.stringify({ items: [{ id: body.itemId, quantity: 1 }] }));
      localStorage.setItem('sss-booking', JSON.stringify({
        holdToken: result.data.holdToken,
        slots: result.data.slots,
        child: body.child.trim(),
        parent: body.parent.trim(),
        email: body.email.trim(),
        itemId: body.itemId
      }));
      location.href = '/cart/';
    });
  });
})();
