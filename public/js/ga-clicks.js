/** Click events for the GA4 tag already in the layout. Sends nothing when gtag is absent. */

const KNOWN_PATHS = {
  '/u/VHbjtGE5': 'trial',
  '/u/AbfxxGYu': 'registration',
  '/u/wTx6tPan': '8',
  '/u/ZpLS9ENJ': '12',
  '/u/RSY4plY8': '20',
  '/u/UeHllrka': 'water aerobics',
  '/u/IiddEmp0': 'gift certificate',
  '/u/sLsPsavs': '20 lesson gift certificate',
};

const KNOWN_IDS = {
  'pkg-8': '8',
  'pkg-12': '12',
  'pkg-20': '20',
  trial: 'trial',
  single: 'trial',
  'water-aerobics': 'water aerobics',
  'registration-annual': 'registration',
};

const SQUARE_HOSTS = ['square.link', 'checkout.square.site', 'squareup.com', 'square.site'];

export function itemFromText(value) {
  const text = String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.includes('water aerobics')) return 'water aerobics';
  if (text.includes('gift certificate') && /\b20\b/.test(text)) return '20 lesson gift certificate';
  if (text.includes('gift certificate')) return 'gift certificate';
  if (/\bregistration\b/.test(text)) return 'registration';
  if (/\b20\b/.test(text) && text.includes('lesson')) return '20';
  if (/\b12\b/.test(text) && text.includes('lesson')) return '12';
  if (/\b8\b/.test(text) && text.includes('lesson')) return '8';
  if (text.includes('single lesson') || /\btrial\b/.test(text)) return 'trial';
  return '';
}

export function isSquareUrl(href) {
  let url;
  try {
    url = new URL(href, 'https://safeswimmingschool.com');
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  return SQUARE_HOSTS.some((allowed) => host === allowed || host.endsWith('.' + allowed));
}

function knownItem(href) {
  let url;
  try {
    url = new URL(href, 'https://safeswimmingschool.com');
  } catch {
    return '';
  }
  return KNOWN_PATHS[url.pathname] || '';
}

export function itemFromId(id) {
  return KNOWN_IDS[id] || '';
}

function elementFrom(target) {
  if (!target) return null;
  if (target.nodeType === 1) return target;
  return target.parentElement || null;
}

export function linkLocation(node) {
  const landmark = node.closest('header, footer');
  if (!landmark) return 'body';
  return String(landmark.tagName).toLowerCase() === 'footer' ? 'footer' : 'header';
}

function checkoutPath(action) {
  if (!action) return '';
  try {
    const url = new URL(action, 'https://safeswimmingschool.com');
    if (url.pathname === '/api/checkout' || url.pathname === '/api/book') return url.pathname;
  } catch {
    return '';
  }
  return '';
}

function squareHit(linkUrl, pagePath, item) {
  const params = { link_url: linkUrl, page_path: pagePath, transport_type: 'beacon' };
  if (item) params.item = item;
  return { name: 'square_checkout_click', params };
}

export function itemFromAnchor(anchor, href) {
  const sources = [anchor.getAttribute('aria-label'), anchor.textContent];
  for (const source of sources) {
    const item = itemFromText(source);
    if (item) return item;
  }
  return knownItem(href);
}

function itemFromForm(form) {
  const action = checkoutPath(form.getAttribute('action'));
  if (action === '/api/book') {
    const selected = form.querySelector('input[name="option"]:checked');
    if (!selected) return '';
    const label = selected.closest ? selected.closest('label') : null;
    return itemFromText(label && label.textContent) || itemFromId(selected.value);
  }
  const root = form.ownerDocument || form;
  const nodes = root.querySelectorAll ? root.querySelectorAll('[data-cart-id]') : [];
  const items = [];
  for (const node of nodes) {
    const item = itemFromId(node.getAttribute('data-cart-id'));
    if (item && !items.includes(item)) items.push(item);
  }
  return items.join(', ');
}

function controlType(control) {
  const type = control.getAttribute && control.getAttribute('type');
  if (type) return type.toLowerCase();
  return String(control.tagName).toUpperCase() === 'BUTTON' ? 'submit' : '';
}

export function clickHit(targetNode, pagePath) {
  const origin = elementFrom(targetNode);
  if (!origin || !origin.closest) return null;
  const link = origin.closest('a[href]');
  if (link) {
    const href = link.getAttribute('href') || '';
    if (href.startsWith('tel:')) {
      return {
        name: 'phone_call_click',
        params: {
          link_url: href,
          page_path: pagePath,
          link_location: linkLocation(link),
          transport_type: 'beacon',
        },
      };
    }
    if (isSquareUrl(href)) return squareHit(href, pagePath, itemFromAnchor(link, href));
  }
  const control = origin.closest('button, input');
  if (!control) return null;
  const form = control.form || (control.closest && control.closest('form'));
  const action = form && checkoutPath(form.getAttribute('action'));
  if (!action || controlType(control) !== 'submit') return null;
  return squareHit(action, pagePath, itemFromForm(form));
}

export function submitHit(form, pagePath) {
  if (!form || !form.getAttribute) return null;
  const action = checkoutPath(form.getAttribute('action'));
  if (!action) return null;
  return squareHit(action, pagePath, itemFromForm(form));
}

export function sendGa(target, hit) {
  if (!hit || !target || typeof target.gtag !== 'function') return;
  try {
    target.gtag('event', hit.name, hit.params);
  } catch {
    /* The tag can reject an event. The click still continues. */
  }
}

export function installGaClicks(target) {
  const doc = target.document;
  let skipSubmit = false;
  doc.addEventListener('click', (event) => {
    const hit = clickHit(event.target, target.location.pathname);
    const url = hit && hit.params.link_url;
    skipSubmit = url === '/api/checkout' || url === '/api/book';
    sendGa(target, hit);
    if (skipSubmit) setTimeout(() => { skipSubmit = false; }, 0);
  });
  doc.addEventListener('submit', (event) => {
    if (skipSubmit) {
      skipSubmit = false;
      return;
    }
    sendGa(target, submitHit(event.target, target.location.pathname));
  });
}

if (typeof window !== 'undefined' && window.document) installGaClicks(window);
