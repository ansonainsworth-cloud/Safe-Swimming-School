(function () {
  var selected = [];
  var needed = 0;
  var slots = [];

  function packageInput() {
    return document.querySelector('input[name="package"]:checked');
  }

  function siblingName() {
    var field = document.getElementById('sss-sibling');
    return field ? field.value.trim() : '';
  }

  function setNeeded() {
    var input = packageInput();
    needed = input ? Number(input.getAttribute('data-lessons')) : 0;
    var siblingFields = document.getElementById('sss-sibling-fields');
    if (siblingFields) siblingFields.hidden = needed <= 1;
    if (needed <= 1 && document.getElementById('sss-sibling')) document.getElementById('sss-sibling').value = '';
    selected = [];
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

  function parts(iso) {
    var list = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hourCycle: 'h23',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit'
    }).formatToParts(new Date(iso));
    var value = {};
    list.forEach(function (part) { value[part.type] = part.value; });
    if (value.hour === '24') value.hour = '00';
    return value;
  }

  function dayKey(iso) {
    return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(iso));
  }

  function timeLabel(iso) {
    return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
  }

  function weeklyLabel(iso, weeks) {
    var label = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'long', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
    if (weeks > 1) label = label.replace(/^([A-Za-z]+) /, '$1s ');
    return label;
  }

  function consecutive(starts, count) {
    var sorted = starts.slice().sort();
    for (var i = 0; i <= sorted.length - count; i += 1) {
      var ok = true;
      for (var j = 1; j < count; j += 1) {
        var gap = (Date.parse(sorted[i + j]) - Date.parse(sorted[i + j - 1])) / 86400000;
        if (gap < 6.5 || gap > 7.5) ok = false;
      }
      if (ok) return sorted.slice(i, i + count);
    }
    return null;
  }

  function seriesOptions() {
    var open = {};
    slots.forEach(function (slot) {
      if (slot.state === 'open') open[slot.start] = true;
    });
    var sibling = siblingName();
    var weeks = sibling ? needed / 2 : needed;
    if (!weeks || weeks !== Math.floor(weeks)) return [];
    var groups = {};
    slots.forEach(function (slot) {
      if (slot.state !== 'open') return;
      var when = parts(slot.start);
      var key = when.weekday + '|' + when.hour + '|' + when.minute;
      if (!groups[key]) groups[key] = [];
      groups[key].push(slot.start);
    });
    var options = [];
    Object.keys(groups).forEach(function (key) {
      var run = consecutive(groups[key], weeks);
      if (!run) return;
      var starts = run;
      if (sibling) {
        var pairs = [];
        for (var i = 0; i < run.length; i += 1) {
          var next = new Date(Date.parse(run[i]) + 30 * 60 * 1000).toISOString();
          if (!open[next]) return;
          pairs.push(run[i], next);
        }
        starts = pairs;
      }
      options.push({ label: weeklyLabel(run[0], weeks), starts: starts });
    });
    options.sort(function (a, b) { return Date.parse(a.starts[0]) - Date.parse(b.starts[0]); });
    return options;
  }

  function sameSelection(starts) {
    if (starts.length !== selected.length) return false;
    var sorted = starts.slice().sort();
    var current = selected.slice().sort();
    for (var i = 0; i < sorted.length; i += 1) if (sorted[i] !== current[i]) return false;
    return true;
  }

  function render() {
    var root = document.getElementById('sss-slots');
    if (needed > 1) {
      root.innerHTML = seriesOptions().map(function (option, index) {
        var on = sameSelection(option.starts);
        return '<button type="button" class="sss-slot" data-series="' + index + '" aria-pressed="' + (on ? 'true' : 'false') + '">' + option.label + '</button>';
      }).join('');
    } else {
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
    }
    document.getElementById('sss-count').textContent = selected.length + ' of ' + needed + ' lessons selected';
    document.getElementById('sss-continue').disabled = !needed || selected.length !== needed;
  }

  document.getElementById('sss-slots').addEventListener('click', function (event) {
    var seriesButton = event.target.closest('[data-series]');
    if (seriesButton) {
      var option = seriesOptions()[Number(seriesButton.getAttribute('data-series'))];
      if (!option) return;
      selected = sameSelection(option.starts) ? [] : option.starts.slice();
      render();
      return;
    }
    var button = event.target.closest('.sss-slot');
    if (!button || button.disabled) return;
    var start = button.getAttribute('data-start');
    var at = selected.indexOf(start);
    if (at !== -1) selected.splice(at, 1);
    else if (selected.length < needed) selected.push(start);
    render();
  });

  function loadSlots() {
    var address = document.getElementById('sss-address').value.trim();
    var query = '/api/availability?days=154';
    if (address) query += '&address=' + encodeURIComponent(address);
    fetch(query).then(function (response) {
      return response.json();
    }).then(function (data) {
      if (data && data.policy) document.getElementById('sss-policy').textContent = data.policy;
      slots = data && data.slots ? data.slots : [];
      selected = selected.filter(function (start) {
        return slots.some(function (slot) { return slot.start === start && slot.state === 'open'; });
      });
      render();
    });
  }

  loadSlots();
  document.getElementById('sss-sibling').addEventListener('input', function () {
    selected = [];
    render();
  });
  var addressTimer;
  document.getElementById('sss-address').addEventListener('input', function () {
    window.clearTimeout(addressTimer);
    addressTimer = window.setTimeout(loadSlots, 400);
  });

  document.getElementById('sss-book-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var item = packageInput();
    var message = document.getElementById('sss-book-message');
    message.textContent = '';
    var sibling = siblingName();
    var body = {
      itemId: item.value,
      quantity: 1,
      email: document.getElementById('sss-email').value,
      parent: document.getElementById('sss-parent').value,
      phone: document.getElementById('sss-phone').value,
      child: document.getElementById('sss-child').value,
      childDob: document.getElementById('sss-dob').value,
      poolAddress: document.getElementById('sss-address').value,
      slots: selected.slice()
    };
    if (sibling) {
      body.sibling = sibling;
      body.siblingDob = document.getElementById('sss-sibling-dob').value;
    }
    fetch('/api/hold', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (response) {
      return response.json().then(function (data) { return { ok: response.ok, data: data }; });
    }).then(function (result) {
      if (!result.ok) {
        if (result.data && result.data.error === 'invalid-buyer') message.textContent = 'Enter the child, date of birth, parent, email, phone, and pool address.';
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
        phone: body.phone.trim(),
        itemId: body.itemId
      }));
      location.href = '/cart/';
    }).catch(function () {
      message.textContent = 'We couldn\'t save those times. Try again.';
    });
  });
})();
