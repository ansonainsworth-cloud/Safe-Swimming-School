import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { clickHit, installGaClicks, isSquareUrl, itemFromText, sendGa } from '../public/js/ga-clicks.js';

const root = new URL('..', import.meta.url).pathname;
const scriptTag = '<script defer type="module" src="/js/ga-clicks.js"></script>';

type Attrs = Record<string, string>;

class El {
  tagName: string;
  attrs: Attrs;
  children: El[];
  parentElement: El | null;
  form: El | null;
  ownerDocument: { querySelectorAll: (selector: string) => El[] } | null;
  nodeType = 1;

  constructor(tag: string, attrs: Attrs = {}, children: El[] = []) {
    this.tagName = tag.toUpperCase();
    this.attrs = attrs;
    this.children = children;
    this.parentElement = null;
    this.form = null;
    this.ownerDocument = null;
    for (const child of children) child.parentElement = this;
  }

  getAttribute(name: string) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
  }

  get textContent(): string {
    return (this.attrs.text || '') + this.children.map((child) => child.textContent).join('');
  }

  closest(selector: string): El | null {
    const parts = selector.split(',').map((part) => part.trim());
    let node: El | null = this;
    while (node) {
      if (parts.some((part) => node!.matches(part))) return node;
      node = node.parentElement;
    }
    return null;
  }

  matches(selector: string) {
    if (selector === 'header' || selector === 'footer') return this.tagName === selector.toUpperCase();
    if (selector === 'a[href]') return this.tagName === 'A' && this.getAttribute('href') !== null;
    if (selector === 'button' || selector === 'input' || selector === 'button, input') return this.tagName === 'BUTTON' || this.tagName === 'INPUT';
    if (selector === 'label') return this.tagName === 'LABEL';
    return false;
  }

  querySelector(selector: string) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector: string): El[] {
    const found: El[] = [];
    const visit = (node: El) => {
      if (selector === 'input[name="option"]:checked' && node.tagName === 'INPUT' && node.getAttribute('name') === 'option' && node.getAttribute('checked') !== null) found.push(node);
      if (selector === '[data-cart-id]' && node.getAttribute('data-cart-id')) found.push(node);
      for (const child of node.children) visit(child);
    };
    visit(this);
    return found;
  }
}

function listen() {
  const gtag = vi.fn();
  const listeners = new Map<string, (event: { target: unknown }) => void>();
  const target = {
    gtag,
    location: { pathname: '/pricing/' },
    document: {
      addEventListener: (type: string, fn: (event: { target: unknown }) => void) => listeners.set(type, fn),
    },
  };
  installGaClicks(target as unknown as Window);
  return {
    gtag,
    click: (node: unknown) => listeners.get('click')?.({ target: node }),
    submit: (node: unknown) => listeners.get('submit')?.({ target: node }),
  };
}

describe('GA4 click events', () => {
  it('fires one phone_call_click and one square_checkout_click', () => {
    const phone = new El('a', { href: 'tel:+15612368260', text: '561-236-8260' });
    const main = new El('main', {}, [phone]);
    const square = new El('a', { href: 'https://square.link/u/wTx6tPan', 'aria-label': 'Pay 8 lessons, $520', text: 'Pay' });
    new El('article', {}, [square]);
    const events = listen();

    events.click(phone);
    expect(events.gtag.mock.calls).toEqual([
      ['event', 'phone_call_click', {
        link_url: 'tel:+15612368260',
        page_path: '/pricing/',
        link_location: 'body',
        transport_type: 'beacon',
      }],
    ]);

    events.gtag.mockClear();
    events.click(new El('strong', { text: '561-236-8260' }, []));
    const inside = new El('strong', { text: '561-236-8260' });
    phone.children.push(inside);
    inside.parentElement = phone;
    events.click(inside);
    expect(events.gtag).toHaveBeenCalledTimes(1);
    expect(events.gtag.mock.calls[0][1]).toBe('phone_call_click');

    events.gtag.mockClear();
    const headerLink = new El('a', { href: 'tel:+15612368260' });
    new El('header', {}, [headerLink]);
    expect(clickHit(headerLink, '/').params).toMatchObject({ link_location: 'header' });
    const footerLink = new El('a', { href: 'tel:+15612368260' });
    new El('footer', {}, [footerLink]);
    expect(clickHit(footerLink, '/').params).toMatchObject({ link_location: 'footer' });

    events.gtag.mockClear();
    events.click(square);
    expect(events.gtag.mock.calls).toEqual([
      ['event', 'square_checkout_click', {
        link_url: 'https://square.link/u/wTx6tPan',
        page_path: '/pricing/',
        transport_type: 'beacon',
        item: '8',
      }],
    ]);

    events.gtag.mockClear();
    events.click(new El('a', { href: '/book/', text: 'Book online' }));
    expect(events.gtag).not.toHaveBeenCalled();
    expect(() => events.click(phone)).not.toThrow();
    sendGa({}, clickHit(phone, '/'));
    sendGa({ gtag: () => { throw new Error('blocked'); } }, clickHit(phone, '/'));
  });

  it('tracks a cart or book submit once, including Enter', () => {
    const selected = new El('input', { type: 'radio', name: 'option', value: 'pkg-12', checked: '' });
    const label = new El('label', {}, [selected, new El('span', { text: '12 lessons $720' })]);
    selected.form = null;
    const button = new El('button', { type: 'submit', text: 'Continue to checkout' });
    const form = new El('form', { action: '/api/book' }, [label, button]);
    button.form = form;
    selected.form = form;
    const events = listen();
    events.click(button);
    events.submit(form);
    expect(events.gtag.mock.calls).toEqual([
      ['event', 'square_checkout_click', {
        link_url: '/api/book',
        page_path: '/pricing/',
        transport_type: 'beacon',
        item: '12',
      }],
    ]);

    events.gtag.mockClear();
    const line = new El('div', { 'data-cart-id': 'trial' });
    const checkout = new El('button', { type: 'submit', text: 'Checkout' });
    const cart = new El('form', { action: '/api/checkout' }, [checkout]);
    checkout.form = cart;
    cart.ownerDocument = { querySelectorAll: () => [line] };
    events.click(checkout);
    expect(events.gtag.mock.calls[0][2]).toMatchObject({ link_url: '/api/checkout', item: 'trial' });

    const keyboard = listen();
    keyboard.submit(form);
    expect(keyboard.gtag).toHaveBeenCalledTimes(1);
    expect(keyboard.gtag.mock.calls[0][1]).toBe('square_checkout_click');
    expect(keyboard.gtag.mock.calls[0][2]).toMatchObject({ link_url: '/api/book', item: '12' });
  });

  it('names packages only from the existing labels', () => {
    expect(itemFromText('Pay 20 lessons, $1,100')).toBe('20');
    expect(itemFromText('Pay Water aerobics, $45 per class')).toBe('water aerobics');
    expect(itemFromText('Pay Holiday gift certificate, $475')).toBe('gift certificate');
    expect(itemFromText('Pay Gift certificate: 20 private lessons, $1,100')).toBe('20 lesson gift certificate');
    expect(itemFromText('Pay Gift certificate: 12 private lessons, $720')).toBe('12 lesson gift certificate');
    expect(itemFromText('Pay 20 lessons, $1,100')).toBe('20');
    expect(itemFromText('Pay 12 lessons, $720')).toBe('12');
    expect(itemFromText('Pay Single lesson, $75')).toBe('trial');
    expect(itemFromText('Pay Registration, $35')).toBe('registration');
    expect(itemFromText('Pay')).toBe('');
    expect(isSquareUrl('https://checkout.square.site/merchant/abc')).toBe(true);
    expect(isSquareUrl('https://connect.squareup.com/v2/online-checkout/payment-links')).toBe(true);
    expect(isSquareUrl('https://square.site/pay')).toBe(true);
    expect(isSquareUrl('https://safeswimmingschool.com/book/')).toBe(false);
    expect(isSquareUrl('/api/book')).toBe(false);
  });

  it('includes the deferred click script on every built page', () => {
    execSync('npm run build', { cwd: root, stdio: 'pipe' });
    const files = htmlFiles(join(root, 'dist'));
    expect(files.length).toBeGreaterThan(10);
    const unclassified: string[] = [];
    for (const file of files) {
      const html = readFileSync(file, 'utf8');
      expect(html).toContain(scriptTag);
      for (const anchor of anchors(html)) {
        if (!isSquareUrl(anchor.href)) continue;
        const item = itemFromText(anchor.label) || itemFromText(anchor.text);
        if (!item) unclassified.push(`${file} ${anchor.href}`);
      }
    }
    expect(unclassified).toEqual([]);
  });
});

function htmlFiles(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) found.push(...htmlFiles(path));
    else if (name.endsWith('.html')) found.push(path);
  }
  return found;
}

function anchors(html: string) {
  const found: Array<{ href: string; label: string; text: string }> = [];
  for (const match of html.matchAll(/<a\b([^>]*)>/gi)) {
    const attrs = match[1];
    const href = attr(attrs, 'href');
    if (!href) continue;
    found.push({ href, label: attr(attrs, 'aria-label'), text: '' });
  }
  return found;
}

function attr(source: string, name: string) {
  const match = source.match(new RegExp(`${name}="([^"]*)"`, 'i'));
  return match ? match[1] : '';
}
