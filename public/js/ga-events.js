/** GA4 conversion events for pages that already load gtag. Not loaded on /cart/ or /checkout/thanks/. */

export function leadFromTallyMessage(event, pagePath) {
  if (!event || typeof event.origin !== 'string') return null;
  if (!/^https:\/\/([a-z0-9-]+\.)*tally\.so$/i.test(event.origin)) return null;
  let data = event.data;
  if (typeof data === 'string') {
    if (!data.includes('Tally.FormSubmitted')) return null;
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (!data || data.event !== 'Tally.FormSubmitted') return null;
  const formId = data.payload && data.payload.formId;
  if (typeof formId !== 'string' || !formId) return null;
  return { name: 'generate_lead', params: { form_id: formId, page_path: pagePath } };
}

export function clickEvent(href, pagePath) {
  if (typeof href !== 'string') return null;
  if (href.startsWith('tel:')) return { name: 'phone_click', params: { link_url: href, page_path: pagePath } };
  if (href.startsWith('sms:')) return { name: 'sms_click', params: { link_url: href, page_path: pagePath } };
  return null;
}

function send(target, hit) {
  if (!hit || typeof target.gtag !== 'function') return;
  target.gtag('event', hit.name, hit.params);
}

export function installGaEvents(target) {
  target.addEventListener('message', (event) => {
    send(target, leadFromTallyMessage(event, target.location.pathname));
  });
  target.document.addEventListener('click', (event) => {
    const node = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if (!node) return;
    send(target, clickEvent(node.getAttribute('href'), target.location.pathname));
  });
}

if (typeof window !== 'undefined' && window.document) installGaEvents(window);
