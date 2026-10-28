import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { onRequest as teamGone } from '../functions/team/[[path]].js';
import { clickEvent, installGaEvents, leadFromTallyMessage } from '../public/js/ga-events.js';

const redirectLines = readFileSync(new URL('../public/_redirects', import.meta.url), 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'));

describe('redirects', () => {
  it('sends /enroll.html to /enroll/ before any catch-all', () => {
    const enroll = redirectLines.findIndex((line) => line.startsWith('/enroll.html '));
    const catchAll = redirectLines.findIndex((line) => line.includes('*'));
    expect(redirectLines[enroll]).toBe('/enroll.html /enroll/ 301');
    expect(catchAll).toBeGreaterThan(enroll);
  });

  it('does not redirect /books/ because that page exists', () => {
    expect(redirectLines.some((line) => line.startsWith('/books'))).toBe(false);
    const books = readFileSync(new URL('../src/pages/books.astro', import.meta.url), 'utf8');
    expect(books).toContain("const path = '/books/';");
  });
});

describe('/team/matt/', () => {
  it('is still served by the 410 function', async () => {
    const source = readFileSync(new URL('../functions/team/[[path]].js', import.meta.url), 'utf8');
    expect(source).toContain('gone.js');
    const routes = JSON.parse(readFileSync(new URL('../public/_routes.json', import.meta.url), 'utf8')) as { include: string[] };
    expect(routes.include).toContain('/team/*');
    const response = teamGone();
    expect(response.status).toBe(410);
    expect(await response.text()).toBe('Gone');
    expect(response.headers.get('x-robots-tag')).toBe('noindex');
  });
});

describe('GA4 events', () => {
  it('turns a Tally submission into generate_lead without the answers', () => {
    const secret = 'parent@example.com';
    const hit = leadFromTallyMessage({
      origin: 'https://tally.so',
      data: JSON.stringify({
        event: 'Tally.FormSubmitted',
        payload: { formId: 'yPed66', fields: [{ type: 'INPUT_EMAIL', answer: { value: secret } }] },
      }),
    }, '/enroll/');
    expect(hit).toEqual({ name: 'generate_lead', params: { form_id: 'yPed66', page_path: '/enroll/' } });
    expect(JSON.stringify(hit)).not.toContain(secret);

    expect(leadFromTallyMessage({
      origin: 'https://evil.example',
      data: { event: 'Tally.FormSubmitted', payload: { formId: 'yPed66' } },
    }, '/enroll/')).toBeNull();
    expect(leadFromTallyMessage({
      origin: 'https://tally.so',
      data: { event: 'Tally.FormPageView', payload: { formId: 'yPed66' } },
    }, '/enroll/')).toBeNull();
  });

  it('tracks business tel and sms links only', () => {
    expect(clickEvent('tel:+15612368260', '/contact-us/')).toEqual({
      name: 'phone_click',
      params: { link_url: 'tel:+15612368260', page_path: '/contact-us/' },
    });
    expect(clickEvent('sms:+15612368260', '/')).toEqual({
      name: 'sms_click',
      params: { link_url: 'sms:+15612368260', page_path: '/' },
    });
    expect(clickEvent('mailto:info@safeswimmingschool.com', '/')).toBeNull();
  });

  it('sends those events through gtag and ignores a foreign message', () => {
    const gtag = vi.fn();
    const listeners = new Map<string, (event: unknown) => void>();
    const target = {
      gtag,
      location: { pathname: '/enroll/' },
      addEventListener: (type: string, fn: (event: unknown) => void) => listeners.set(type, fn),
      document: { addEventListener: (type: string, fn: (event: unknown) => void) => listeners.set(type, fn) },
    };
    installGaEvents(target as unknown as Window);
    listeners.get('message')?.({
      origin: 'https://tally.so',
      data: { event: 'Tally.FormSubmitted', payload: { formId: 'yPed66', fields: [{ answer: { value: 'hidden' } }] } },
    });
    listeners.get('click')?.({
      target: { closest: () => ({ getAttribute: () => 'sms:15612368260' }) },
    });
    listeners.get('message')?.({ origin: 'https://example.com', data: { event: 'Tally.FormSubmitted', payload: { formId: 'nope' } } });
    expect(gtag.mock.calls).toEqual([
      ['event', 'generate_lead', { form_id: 'yPed66', page_path: '/enroll/' }],
      ['event', 'sms_click', { link_url: 'sms:15612368260', page_path: '/enroll/' }],
    ]);
    expect(JSON.stringify(gtag.mock.calls)).not.toContain('hidden');
  });
});

describe('GA4 snippet', () => {
  function runSnippet(checkoutOnly: boolean) {
    const layout = readFileSync(new URL('../src/layouts/Base.astro', import.meta.url), 'utf8');
    const match = layout.match(/define:vars=\{\{ GA_ID, checkoutOnly \}\}>([^<]+)<\/script>/);
    expect(match?.[1]).toContain('window.gtag=function(){window.dataLayer.push(arguments);}');
    const sandbox: { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void } = {};
    new Function('window', 'GA_ID', 'checkoutOnly', match![1])(sandbox, 'G-TEST', checkoutOnly);
    return sandbox;
  }

  it('leaves window.gtag in place after the snippet function returns', () => {
    const sandbox = runSnippet(false);
    expect(typeof sandbox.gtag).toBe('function');
    const commands = (sandbox.dataLayer ?? []).map((entry) => Array.from(entry as ArrayLike<unknown>));
    expect(commands.filter((entry) => entry[0] === 'config')).toEqual([['config', 'G-TEST']]);
    sandbox.gtag!('event', 'phone_click', { link_url: 'tel:+15612368260' });
    expect((sandbox.dataLayer ?? []).map((entry) => Array.from(entry as ArrayLike<unknown>))).toContainEqual([
      'event',
      'phone_click',
      { link_url: 'tel:+15612368260' },
    ]);
  });

  it('sends one checkout config and still exposes window.gtag', () => {
    const sandbox = runSnippet(true);
    expect(typeof sandbox.gtag).toBe('function');
    const commands = (sandbox.dataLayer ?? []).map((entry) => Array.from(entry as ArrayLike<unknown>));
    expect(commands.filter((entry) => entry[0] === 'config')).toEqual([['config', 'G-TEST', { send_page_view: false }]]);
  });
});

describe('begin_checkout stays off the buyer fields', () => {
  it('fires currency and value from the cart script', () => {
    const cart = readFileSync(new URL('../public/js/cart.js', import.meta.url), 'utf8');
    const fn = cart.slice(cart.indexOf('function trackBeginCheckout'), cart.indexOf('function money'));
    expect(fn).toContain('typeof window.gtag !== \'function\'');
    expect(fn).toContain("gtag('event', 'begin_checkout'");
    expect(fn).toContain("currency: 'USD'");
    expect(fn).toContain('value: cents / 100');
    expect(fn).toContain("transport_type: 'beacon'");
    expect(fn).not.toMatch(/email|phone|name|address/i);
    expect(cart).toContain('trackBeginCheckout(items, function ()');
    const layout = readFileSync(new URL('../src/layouts/Base.astro', import.meta.url), 'utf8');
    expect(layout).toContain('trackAnalytics && <script is:inline type="module" src="/js/ga-events.js"></script>');
    expect(layout).toContain('send_page_view:false');
    const cartPage = readFileSync(new URL('../src/pages/cart.astro', import.meta.url), 'utf8');
    expect(cartPage).toContain('trackAnalytics={false}');
    expect(cartPage).toContain('checkoutAnalytics={true}');
    const thanks = readFileSync(new URL('../src/pages/checkout/thanks.astro', import.meta.url), 'utf8');
    expect(thanks).toContain('trackAnalytics={false}');
    expect(thanks).not.toContain('checkoutAnalytics');
    expect(thanks).not.toContain('gtag');
    const events = readFileSync(new URL('../public/js/ga-events.js', import.meta.url), 'utf8');
    expect(events).not.toContain('contact_submit');
    const enroll = readFileSync(new URL('../src/content/pages/enroll.html', import.meta.url), 'utf8');
    expect(enroll).toContain('tally.so/embed/yPed66');
    expect(enroll).not.toContain('<form');
    const contact = readFileSync(new URL('../src/content/pages/contact-us.html', import.meta.url), 'utf8');
    expect(contact).not.toContain('<form');
  });
});
