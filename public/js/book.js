(function () {
  var form = document.getElementById('book-form');
  if (!form) return;
  var town = document.getElementById('book-town');
  var day = document.getElementById('book-day');
  var time = document.getElementById('book-time');
  var grid = document.getElementById('book-grid');
  var times = document.getElementById('book-times');
  var limited = document.getElementById('book-limited');
  var message = document.getElementById('book-message');
  var blocks = [];
  try {
    blocks = JSON.parse(document.getElementById('book-blocks').textContent || '[]');
  } catch (error) {
    blocks = [];
  }

  function nyDate(now) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  }

  function minutes(hhmm) {
    var parts = hhmm.split(':');
    return Number(parts[0]) * 60 + Number(parts[1]);
  }

  function blocked(dayValue, start, now) {
    var startMin = minutes(start);
    var endMin = startMin + 30;
    var today = nyDate(now || new Date());
    return blocks.some(function (block) {
      if (block.days.indexOf(dayValue) === -1) return false;
      if (block.until && today > block.until) return false;
      return startMin < minutes(block.end) && endMin > minutes(block.start);
    });
  }

  function showMessage(text) {
    message.hidden = false;
    message.textContent = text;
  }

  function paint() {
    var selectedDay = day.value;
    var coral = town.options[town.selectedIndex].getAttribute('data-limited') === 'true';
    times.hidden = coral;
    limited.hidden = !coral;
    Array.prototype.forEach.call(grid.querySelectorAll('[data-day]'), function (button) {
      var open = !blocked(button.getAttribute('data-day'), button.getAttribute('data-start'));
      button.disabled = !open;
      button.classList.toggle('is-blocked', !open);
      button.hidden = button.getAttribute('data-day') !== selectedDay;
      if (!open) button.classList.remove('is-selected');
    });
    if (coral || (time.value && blocked(selectedDay, time.value))) time.value = '';
    if (time.value && day.value) {
      var current = grid.querySelector('[data-day="' + selectedDay + '"][data-start="' + time.value + '"]');
      if (!current || current.disabled) time.value = '';
    }
  }

  town.addEventListener('change', paint);
  day.addEventListener('change', paint);
  grid.addEventListener('click', function (event) {
    var button = event.target.closest('[data-start]');
    if (!button || button.disabled) return;
    Array.prototype.forEach.call(grid.querySelectorAll('.is-selected'), function (item) {
      item.classList.remove('is-selected');
    });
    button.classList.add('is-selected');
    time.value = button.getAttribute('data-start');
  });

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    message.hidden = true;
    var coral = town.options[town.selectedIndex].getAttribute('data-limited') === 'true';
    if (coral) {
      showMessage(limited.textContent.trim());
      return;
    }
    var lessonOptions = { single: 1, 'pkg-8': 1, 'pkg-12': 1, 'pkg-20': 1 };
    if (!lessonOptions[form.option.value]) {
      showMessage('Choose a lesson.');
      return;
    }
    if (!time.value) {
      showMessage('Choose an open time.');
      return;
    }
    var button = document.getElementById('book-submit');
    button.disabled = true;
    var count = swimmerCount();
    var data = {
      option: form.option.value,
      town: town.value,
      day: day.value,
      time: time.value,
      name: form.name.value,
      email: form.email.value,
      phone: form.phone.value,
      childAge: form.childAge.value,
      swimmers: count,
      poolAddress: form.poolAddress.value,
    };
    if (count >= 2) data.childAge2 = form.childAge2.value;
    if (count >= 3) data.childAge3 = form.childAge3.value;
    fetch('/api/book', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
    }).then(function (response) {
      return response.json().then(function (body) {
        return { ok: response.ok, status: response.status, body: body };
      });
    }).then(function (result) {
      if (result.status === 503) {
        showMessage(result.body && result.body.message ? result.body.message : 'Online booking opens soon. Text 561-236-8260 to book.');
        return;
      }
      if (result.status === 400) {
        showMessage(result.body && result.body.message ? result.body.message : 'Please check your email address and phone number, then try again.');
        return;
      }
      if (!result.ok || !result.body || typeof result.body.url !== 'string') {
        showMessage(result.body && result.body.message ? result.body.message : 'We could not start checkout. Text 561-236-8260.');
        return;
      }
      window.location.href = result.body.url;
    }).catch(function () {
      showMessage('We could not start checkout. Text 561-236-8260.');
    }).then(function () {
      button.disabled = false;
    });
  });

  function swimmerCount() {
    var select = document.getElementById('book-swimmers');
    var count = select ? Number(select.value) : 1;
    return count === 2 || count === 3 ? count : 1;
  }

  function paintSwimmers() {
    var count = swimmerCount();
    [2, 3].forEach(function (index) {
      var wrap = document.getElementById('book-child-' + index);
      var input = wrap ? wrap.querySelector('input') : null;
      var show = count >= index;
      if (wrap) wrap.hidden = !show;
      if (!input) return;
      input.required = show;
      input.disabled = !show;
      if (!show) input.value = '';
    });
  }

  function registrationFee(count) {
    var tiers = window.SSS_REGISTRATION_TIERS || { 1: 3500, 2: 5000, 3: 6000 };
    var cents = Number(tiers[count] != null ? tiers[count] : tiers[String(count)]);
    if (!cents) cents = 3500;
    var dollars = '$' + (cents / 100);
    if (count === 2) return 'Annual registration is ' + dollars + ' for two siblings.';
    if (count === 3) return 'Annual registration is ' + dollars + ' for a family with three or more swimmers.';
    return 'Annual registration is ' + dollars + ' for one swimmer.';
  }

  function paintSummary() {
    var summary = document.getElementById('book-summary-choice');
    var fee = document.getElementById('book-summary-fee');
    var note = document.getElementById('book-summary-note');
    var mobile = document.getElementById('book-mobile-summary');
    var mobileChoice = document.getElementById('book-mobile-choice');
    var mobileNote = document.getElementById('book-mobile-note');
    if (!summary) return;
    var checked = form.querySelector('input[name="option"]:checked');
    var label = checked ? checked.parentNode.textContent.replace(/\s+/g, ' ').trim() : '';
    var single = checked && checked.value === 'single';
    summary.textContent = label || 'Choose a package';
    if (fee) fee.textContent = registrationFee(swimmerCount());
    if (note) {
      note.textContent = single
        ? 'A single lesson is $75 (can be credited toward a package). Annual registration is not waived on a single lesson.'
        : 'Annual registration (the $35, $50 or $60 fee) is waived on lock in packages bought by December 31, 2026.';
    }
    if (mobile && mobileChoice && mobileNote) {
      mobile.hidden = !checked;
      mobileChoice.textContent = label;
      mobileNote.textContent = single
        ? 'Annual registration is not waived on a single lesson.'
        : 'Annual registration (the $35, $50 or $60 fee) is waived on lock in packages bought by December 31, 2026.';
    }
  }
  var swimmers = document.getElementById('book-swimmers');
  if (swimmers) swimmers.addEventListener('change', function () {
    paintSwimmers();
    paintSummary();
  });
  form.addEventListener('change', paintSummary);
  paintSwimmers();
  paintSummary();

  paint();
})();
