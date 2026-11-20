import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { metaPixelMarkup } from '../src/data/meta-pixel.js';
import { installGaEvents } from '../public/js/ga-events.js';
import { installGaClicks } from '../public/js/ga-clicks.js';
import { trackMeta } from '../public/js/meta-pixel.js';

const root = new URL('..', import.meta.url).pathname;
const dummyId = '1234567890';

function htmlFiles(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) found.push(...htmlFiles(path));
    else if (name.endsWith('.html')) found.push(path);
  }
  return found;
}

describe('Meta Pixel', () => {
  it('ships with an empty ID and no pixel in the built pages', () => {
    const site = readFileSync(new URL('../src/data/site.js', import.meta.url), 'utf8');
    expect(site).toContain("export const META_PIXEL_ID = ''");
    expect(metaPixelMarkup('')).toBe('');
    execSync('npm run build', { cwd: root, stdio: 'pipe' });
    const files = htmlFiles(join(root, 'dist'));
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      const html = readFileSync(file, 'utf8');
      expect(html, file).not.toContain('fbq');
      expect(html, file).not.toContain('connect.facebook.net');
      expect(html, file).not.toContain('facebook.com/tr');
    }
  });

  it('renders the standard base code for a dummy ID only inside the test', () => {
    const markup = metaPixelMarkup(dummyId);
    expect(markup).toContain('https://connect.facebook.net/en_US/fbevents.js');
    expect(markup).toContain('t.async=!0');
    expect(markup).toContain(`fbq('init','${dummyId}')`);
    expect(markup).toContain("fbq('track','PageView')");
    expect(markup).toContain(`https://www.facebook.com/tr?id=${dummyId}&ev=PageView&noscript=1`);
    expect(markup).not.toContain('info@');
    const layout = readFileSync(new URL('../src/layouts/Base.astro', import.meta.url), 'utf8');
    expect(layout).toContain('const pixelMarkup = loadGtag ? metaPixelMarkup(META_PIXEL_ID) : \'\'');
    const site = readFileSync(new URL('../src/data/site.js', import.meta.url), 'utf8');
    expect(site).not.toContain(dummyId);
  });

  it('sends Lead and Contact from the GA4 lead and click listeners', () => {
    const fbq = vi.fn();
    const gtag = vi.fn();
    const listeners = new Map<string, (event: unknown) => void>();
    const target = {
      fbq,
      gtag,
      location: { pathname: '/enroll/' },
      addEventListener: (type: string, fn: (event: unknown) => void) => listeners.set(type, fn),
      document: { addEventListener: (type: string, fn: (event: unknown) => void) => listeners.set(type, fn) },
    };
    installGaEvents(target as unknown as Window);
    listeners.get('message')?.({
      origin: 'https://tally.so',
      data: { event: 'Tally.FormSubmitted', payload: { formId: 'yPed66', fields: [{ answer: { value: 'hidden@example.com' } }] } },
    });
    listeners.get('click')?.({
      target: { closest: () => ({ getAttribute: () => 'tel:+15612368260' }) },
    });
    listeners.get('click')?.({
      target: { closest: () => ({ getAttribute: () => 'sms:+15612368260' }) },
    });
    expect(fbq.mock.calls).toEqual([
      ['track', 'Lead', { content_name: 'yPed66' }],
      ['track', 'Contact'],
      ['track', 'Contact'],
    ]);
    expect(JSON.stringify(fbq.mock.calls)).not.toContain('hidden@example.com');
    expect(JSON.stringify(fbq.mock.calls)).not.toContain('561');
  });

  it('sends InitiateCheckout from Square, book, and cart starts without buyer fields', () => {
    const fbq = vi.fn();
    const listeners = new Map<string, (event: { target: { closest: () => { getAttribute: () => string } } }) => void>();
    const target = {
      fbq,
      gtag: vi.fn(),
      location: { pathname: '/book/' },
      document: {
        addEventListener: (type: string, fn: (event: { target: { closest: () => { getAttribute: () => string } } }) => void) => listeners.set(type, fn),
      },
    };
    installGaClicks(target as unknown as Window);
    listeners.get('click')?.({
      target: {
        nodeType: 1,
        textContent: 'Pay 8 lessons, $520',
        getAttribute: () => 'https://square.link/u/wTx6tPan',
        closest(selector: string) {
          return selector === 'a[href]' ? this : null;
        },
      },
    });
    expect(fbq.mock.calls[0]).toEqual(['track', 'InitiateCheckout', { content_name: '8' }]);
    trackMeta({ fbq }, 'InitiateCheckout', { value: 520, currency: 'USD', content_name: 'buyer@example.com' });
    expect(fbq.mock.calls.at(-1)).toEqual(['track', 'InitiateCheckout', { value: 520, currency: 'USD' }]);
    trackMeta({}, 'Lead');
    const cart = readFileSync(new URL('../public/js/cart.js', import.meta.url), 'utf8');
    const fn = cart.slice(cart.indexOf('function trackBeginCheckout'), cart.indexOf('function money'));
    expect(fn).toContain("fbq('track', 'InitiateCheckout'");
    expect(fn).toContain('value: cents / 100');
    expect(fn).toContain("currency: 'USD'");
    expect(fn).not.toMatch(/email|phone|name|address/i);
    const clicks = readFileSync(new URL('../public/js/ga-clicks.js', import.meta.url), 'utf8');
    expect(clicks).toContain("trackMeta(target, 'InitiateCheckout'");
    expect(clicks).toContain("trackMeta(target, 'Contact')");
  });
});
