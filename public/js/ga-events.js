/** GA4 conversion events for pages that already load gtag. Not loaded on /cart/ or /checkout/thanks/. */
import { trackMeta } from './meta-pixel.js';

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
  if (!hit) return;
  if (typeof target.gtag === 'function') target.gtag('event', hit.name, hit.params);
  if (hit.name === 'generate_lead') trackMeta(target, 'Lead', { content_name: hit.params.form_id });
  if (hit.name === 'phone_click' || hit.name === 'sms_click') trackMeta(target, 'Contact');
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
