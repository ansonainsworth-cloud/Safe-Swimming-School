(function () {
  var KEY = 'sss-cart';

  function catalog() {
    return window.SSS_CATALOG || [];
  }

  function itemById(id) {
    for (var i = 0; i < catalog().length; i++) {
      if (catalog()[i].id === id) return catalog()[i];
    }
    return null;
  }

  function read() {
    try {
      var data = JSON.parse(localStorage.getItem(KEY) || '{"items":[]}');
      if (!data || !Array.isArray(data.items)) return [];
      return data.items.filter(function (line) {
        var item = itemById(line && line.id);
        return item && Number.isInteger(line.quantity) && line.quantity >= item.minQty && line.quantity <= item.maxQty;
      }).map(function (line) {
        return { id: line.id, quantity: line.quantity };
      });
    } catch (error) {
      return [];
    }
  }

  function count(items) {
    return items.reduce(function (sum, line) { return sum + line.quantity; }, 0);
  }

  function write(items) {
    localStorage.setItem(KEY, JSON.stringify({ items: items }));
    renderCount(items);
    renderCart(items);
  }

  function renderCount(items) {
    var el = document.getElementById('sss-cart-count');
    if (el) el.textContent = String(count(items || read()));
  }

  function trackBeginCheckout(items, done) {
    var cents = 0;
    for (var i = 0; i < items.length; i++) {
      var item = itemById(items[i].id);
      if (item) cents += item.priceCents * items[i].quantity;
    }
    var finished = false;
    function finish() {
      if (finished) return;
      finished = true;
      if (typeof done === 'function') done();
    }
    if (typeof window.gtag !== 'function') {
      finish();
      return;
    }
    window.gtag('event', 'begin_checkout', {
      currency: 'USD',
      value: cents / 100,
      transport_type: 'beacon',
      event_callback: finish,
      event_timeout: 800
    });
    window.setTimeout(finish, 1000);
  }

  function money(cents) {
    return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  }

  function childRows() {
    var root = document.getElementById('sss-children');
    if (!root) return [];
    return Array.prototype.slice.call(root.querySelectorAll('.sss-child'));
  }

  function swimmerCount() {
    var rows = childRows();
    if (!rows.length) return 1;
    return rows.length > 20 ? 20 : rows.length;
  }

  function readChildren() {
    return childRows().map(function (row) {
      var notes = row.querySelector('[data-child-notes]').value.trim();
      var child = {
        name: row.querySelector('[data-child-name]').value.trim(),
        age: row.querySelector('[data-child-age]').value.trim()
      };
      if (notes) child.notes = notes;
      return child;
    });
  }

  function renumberChildren() {
    childRows().forEach(function (row, index) {
      var number = index + 1;
      row.querySelector('[data-child-heading]').textContent = 'Child ' + number;
      var remove = row.querySelector('[data-remove-child]');
      remove.textContent = 'Remove child ' + number;
      remove.setAttribute('aria-label', 'Remove child ' + number);
      row.querySelectorAll('[data-child-field]').forEach(function (field) {
        var kind = field.getAttribute('data-child-field');
        var id = 'sss-child-' + kind + '-' + number;
        field.id = id;
        var label = row.querySelector('label[data-child-label="' + kind + '"]');
        if (label) label.htmlFor = id;
      });
    });
  }

  function updateRemoveButtons() {
    var rows = childRows();
    var only = rows.length < 2;
    rows.forEach(function (row) {
      var button = row.querySelector('[data-remove-child]');
      button.disabled = only;
      button.setAttribute('aria-disabled', only ? 'true' : 'false');
    });
    var add = document.getElementById('sss-add-child');
    if (add) add.disabled = rows.length >= 20;
  }

  function addChild(shouldFocus) {
    var root = document.getElementById('sss-children');
    if (!root || childRows().length >= 20) return;
    var row = document.createElement('div');
    row.className = 'sss-child';
    row.innerHTML = ''
      + '<h3 data-child-heading>Child</h3>'
      + '<label data-child-label="name">Name<input data-child-field="name" data-child-name type="text" required maxlength="100" autocomplete="off"></label>'
      + '<label data-child-label="age">Age<input data-child-field="age" data-child-age type="text" required maxlength="40" autocomplete="off"></label>'
      + '<label data-child-label="notes">Notes <span class="sss-optional">(optional)</span><textarea data-child-field="notes" data-child-notes maxlength="200"></textarea></label>'
      + '<button type="button" class="sss-remove" data-remove-child>Remove child</button>';
    root.appendChild(row);
    renumberChildren();
    updateRemoveButtons();
    if (shouldFocus) {
      var name = row.querySelector('[data-child-name]');
      if (name) name.focus();
    }
  }

  function bindChildren() {
    var root = document.getElementById('sss-children');
    var add = document.getElementById('sss-add-child');
    if (!root || !add) return;
    add.addEventListener('click', function () {
      addChild(true);
      renderCart(read());
    });
    root.addEventListener('click', function (event) {
      var button = event.target.closest('[data-remove-child]');
      if (!button || button.disabled) return;
      var row = button.closest('.sss-child');
      if (!row || childRows().length < 2) return;
      row.remove();
      renumberChildren();
      updateRemoveButtons();
      renderCart(read());
      add.focus();
    });
    root.addEventListener('input', function () {
      renderCart(read());
    });
    if (!childRows().length) addChild(false);
  }

  function registrationCents(swimmers) {
    var tiers = window.SSS_REGISTRATION_TIERS || { 1: 3500, 2: 5000, 3: 6000 };
    var key = swimmers >= 3 ? 3 : swimmers;
    return tiers[key] || tiers[1] || 3500;
  }

  function registrationLabel(swimmers) {
    if (swimmers >= 3) return 'Annual registration for 3 or more swimmers';
    if (swimmers === 2) return 'Annual registration for 2 siblings';
    return 'Annual registration for 1 swimmer';
  }

  function clamp(item, value) {
    var qty = parseInt(value, 10);
    if (!Number.isInteger(qty)) return item.minQty;
    if (qty < item.minQty) return item.minQty;
    if (qty > item.maxQty) return item.maxQty;
    return qty;
  }

  document.addEventListener('click', function (event) {
    var add = event.target.closest('[data-cart-add]');
    if (add) {
      var wrap = add.closest('[data-cart-id]');
      var item = itemById(wrap.getAttribute('data-cart-id'));
      if (!item) return;
      var input = wrap.querySelector('[data-cart-qty]');
      var qty = clamp(item, input ? input.value : item.minQty);
      if (input) input.value = String(qty);
      var items = read().filter(function (line) { return line.id !== item.id; });
      items.push({ id: item.id, quantity: qty });
      write(items);
      add.textContent = 'Added';
      window.setTimeout(function () { add.textContent = 'Add to cart'; }, 1200);
      return;
    }
    var remove = event.target.closest('[data-cart-remove]');
    if (remove) {
      write(read().filter(function (line) { return line.id !== remove.getAttribute('data-cart-remove'); }));
    }
  });

    document.addEventListener('change', function (event) {
    var input = event.target.closest('#sss-cart-root [data-cart-qty]');
    if (!input) return;
    var line = input.closest('[data-cart-id]');
    var item = itemById(line.getAttribute('data-cart-id'));
    if (!item) return;
    var qty = clamp(item, input.value);
    var items = read().map(function (entry) {
      return entry.id === item.id ? { id: entry.id, quantity: qty } : entry;
    });
    write(items);
  });

  function renderCart(items) {
    var root = document.getElementById('sss-cart-root');
    if (!root) return;
    items = items || read();
    if (!items.length) {
      root.innerHTML = '<p>Your cart is empty. See <a href="/pricing/">lesson packages</a> or <a href="/water-aerobics/">water aerobics</a>.</p>';
    } else {
      var subtotal = 0;
      var html = items.map(function (line) {
        var item = itemById(line.id);
        var lineCents = item.priceCents * line.quantity;
        subtotal += lineCents;
        return '<div class="sss-cart-line" data-cart-id="' + item.id + '"><p><strong>' + item.name + '</strong><br>' + money(item.priceCents) + '</p><label class="sss-qty">Qty <input type="number" min="' + item.minQty + '" max="' + item.maxQty + '" value="' + line.quantity + '" inputmode="numeric" data-cart-qty aria-label="Quantity for ' + item.name + '"></label><button type="button" class="sss-remove" data-cart-remove="' + item.id + '">Remove</button><p class="sss-line-total">' + money(lineCents) + '</p></div>';
      }).join('');
      var fee = registrationCents(swimmerCount());
      subtotal += fee;
      html += '<div class="sss-cart-line"><p><strong>' + registrationLabel(swimmerCount()) + '</strong><br>' + money(fee) + ', added at checkout if registration is not already paid this year</p><p class="sss-line-total">' + money(fee) + '</p></div>';
      root.innerHTML = html + '<p class="sss-cart-subtotal"><strong>Subtotal:</strong> ' + money(subtotal) + '</p>';
    }
    var button = document.getElementById('sss-checkout-button');
    if (button) button.disabled = items.length === 0;
  }

  var form = document.getElementById('sss-checkout-form');
  if (form) {
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var message = document.getElementById('sss-checkout-message');
      var fallback = document.getElementById('sss-pay-fallback');
      var items = read();
      if (!items.length) return;
      var phone = form.phone.value.trim();
      var buyer = { name: form.name.value.trim(), email: form.email.value.trim() };
      if (phone) buyer.phone = phone;
      var children = readChildren();
      var missingChild = children.some(function (child) { return !child.name || !child.age; });
      message.hidden = true;
      message.innerHTML = '';
      if (!children.length || missingChild) {
        message.hidden = false;
        message.textContent = 'Add a name and age for each child, then try again.';
        return;
      }
      var button = document.getElementById('sss-checkout-button');
      button.disabled = true;
      fetch('/api/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          items: items.map(function (line) { return { id: line.id, quantity: line.quantity }; }),
          children: children,
          buyer: buyer
        })
      }).then(function (response) {
        if (response.status === 503) {
          if (fallback) fallback.hidden = false;
          return null;
        }
        return response.json().then(function (data) {
          return { ok: response.ok, data: data };
        });
      }).then(function (result) {
        if (!result) return;
        if (!result.ok || !result.data || typeof result.data.url !== 'string' || result.data.url.indexOf('https://') !== 0) {
          message.hidden = false;
          message.textContent = result.data && result.data.error === 'invalid-children'
            ? 'Add a name and age for each child, then try again.'
            : 'We couldn’t start checkout. Check your name and email, and try again.';
          return;
        }
        if (result.data.registrationReason === 'lookup-error') {
          trackBeginCheckout(items);
          message.hidden = false;
          var added = Number(result.data.registrationCents);
          var addedText = Number.isInteger(added) ? money(added) : money(registrationCents(swimmerCount()));
          message.textContent = 'We added the ' + addedText + ' annual registration fee because we couldn’t confirm a registration from the last 12 months. If you already paid it this year, we can refund it. ';
          var continueLink = document.createElement('a');
          continueLink.href = result.data.url;
          continueLink.textContent = 'Continue to checkout';
          message.appendChild(continueLink);
          return;
        }
        trackBeginCheckout(items, function () {
          window.location.href = result.data.url;
        });
      }).catch(function () {
        message.hidden = false;
        message.textContent = 'We couldn’t start checkout. Please try again.';
      }).finally(function () {
        button.disabled = read().length === 0;
      });
    });
  }

  bindChildren();
  renderCount(read());
  renderCart(read());
})();
