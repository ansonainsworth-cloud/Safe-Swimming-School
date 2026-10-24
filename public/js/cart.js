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
      message.hidden = true;
      message.innerHTML = '';
      var button = document.getElementById('sss-checkout-button');
      button.disabled = true;
      fetch('/api/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          items: items.map(function (line) { return { id: line.id, quantity: line.quantity }; }),
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
          message.textContent = 'We couldn’t start checkout. Check your name and email, and try again.';
          return;
        }
        if (result.data.registrationReason === 'lookup-error') {
          trackBeginCheckout(items);
          message.hidden = false;
          message.textContent = 'We added the $35 annual registration fee because we couldn’t confirm a registration from the last 12 months. If you already paid it this year, we can refund it. ';
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

  renderCount(read());
  renderCart(read());
})();
