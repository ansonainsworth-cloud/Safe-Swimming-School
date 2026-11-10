import { readFileSync } from 'node:fs';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { onRequestPost } from '../functions/api/book';

const env = { SQUARE_ACCESS_TOKEN: 'token', SQUARE_LOCATION_ID: 'LOC123' };

function booking(extra: Record<string, unknown> = {}) {
  return {
    option: 'pkg-8',
    town: 'jupiter',
    day: 'Mon',
    time: '08:00',
    name: 'Pat Parent',
    email: 'pat@example.com',
    phone: '561-236-8260',
    childAge: '4',
    poolAddress: '10 Lake Road',
    ...extra,
  };
}

function request(body: unknown) {
  return new Request('https://safeswimmingschool.com/api/book', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('/api/book swimmer ages', () => {
  it('keeps a one child booking on the package price', async () => {
    const fetchMock = vi.fn(async () => Response.json({ payment_link: { url: 'https://square.test/pay' } }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await onRequestPost({ request: request(booking()), env });
    expect(response.status).toBe(200);
    const sent = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(sent.order.line_items[0].base_price_money).toEqual({ amount: 52000, currency: 'USD' });
    expect(sent.payment_note).toContain('Child age: 4');
    expect(sent.payment_note).toContain('Swimmers: 1');
    expect(sent.payment_note).not.toContain('Second child age');
  });

  it('passes two and three child ages without changing the package price', async () => {
    const fetchMock = vi.fn(async () => Response.json({ payment_link: { url: 'https://square.test/pay' } }));
    vi.stubGlobal('fetch', fetchMock);
    const two = await onRequestPost({ request: request(booking({ swimmers: 2, childAge2: '6' })), env });
    expect(two.status).toBe(200);
    const twoBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(twoBody.order.line_items[0].base_price_money.amount).toBe(52000);
    expect(twoBody.payment_note).toContain('Second child age: 6');
    expect(twoBody.payment_note).toContain('Swimmers: 2');
    expect(twoBody.payment_note).not.toContain('Third child age');

    const three = await onRequestPost({
      request: request(booking({ option: 'single', swimmers: '3', childAge2: '6', childAge3: '2' })),
      env,
    });
    expect(three.status).toBe(200);
    const threeBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(threeBody.order.line_items[0].base_price_money.amount).toBe(7500);
    expect(threeBody.payment_note).toContain('Third child age: 2');
    expect(threeBody.payment_note).toContain('Swimmers: 3');
  });

  it('asks for each visible age and ignores extra ages for one swimmer', async () => {
    const fetchMock = vi.fn(async () => Response.json({ payment_link: { url: 'https://square.test/pay' } }));
    vi.stubGlobal('fetch', fetchMock);
    const missing = await onRequestPost({ request: request(booking({ swimmers: 2 })), env });
    expect(missing.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    const ignored = await onRequestPost({ request: request(booking({ swimmers: 1, childAge2: '9' })), env });
    expect(ignored.status).toBe(200);
    const sent = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
    expect(sent.payment_note).not.toContain('Second child age');
  });
});

describe('booking form swimmer fields', () => {
  it('shows, requires, and submits only the chosen ages', () => {
    const source = readFileSync(new URL('../public/js/book.js', import.meta.url), 'utf8');
    const els = new Map<string, FakeEl>();
    const form = fakeEl('book-form');
    form.option = { value: 'pkg-12' };
    form.name = { value: 'Pat Parent' };
    form.email = { value: 'pat@example.com' };
    form.phone = { value: '561-236-8260' };
    form.childAge = { value: '4' };
    form.poolAddress = { value: '10 Lake Road' };
    const child2 = fakeEl('age-2');
    const child3 = fakeEl('age-3');
    form.childAge2 = child2;
    form.childAge3 = child3;
    const wrap2 = fakeEl('book-child-2');
    const wrap3 = fakeEl('book-child-3');
    wrap2.input = child2;
    wrap3.input = child3;
    wrap2.hidden = true;
    wrap3.hidden = true;
    const swimmers = fakeEl('book-swimmers');
    swimmers.value = '1';
    const summary = fakeEl('book-summary-choice');
    const fee = fakeEl('book-summary-fee');
    const note = fakeEl('book-summary-note');
    const option = fakeEl('option');
    option.parentNode = { textContent: '12 lessons $720' };
    form.querySelector = (sel: string) => (sel === 'input[name="option"]:checked' ? option : null);
    const ids: Record<string, FakeEl> = {
      'book-form': form,
      'book-town': fakeEl('book-town'),
      'book-day': fakeEl('book-day'),
      'book-time': fakeEl('book-time'),
      'book-grid': fakeEl('book-grid'),
      'book-times': fakeEl('book-times'),
      'book-limited': fakeEl('book-limited'),
      'book-message': fakeEl('book-message'),
      'book-blocks': fakeEl('book-blocks'),
      'book-submit': fakeEl('book-submit'),
      'book-summary-choice': summary,
      'book-summary-fee': fee,
      'book-summary-note': note,
      'book-mobile-summary': fakeEl('book-mobile-summary'),
      'book-mobile-choice': fakeEl('book-mobile-choice'),
      'book-mobile-note': fakeEl('book-mobile-note'),
      'book-swimmers': swimmers,
      'book-child-2': wrap2,
      'book-child-3': wrap3,
    };
    ids['book-blocks'].textContent = '[]';
    ids['book-day'].value = 'Mon';
    ids['book-limited'].textContent = 'Limited availability, text 561-236-8260.';
    const posted: unknown[] = [];
    const documentMock = {
      getElementById: (id: string) => ids[id] || null,
    };
    const windowMock = {
      SSS_REGISTRATION_TIERS: { 1: 3500, 2: 5000, 3: 6000 },
      location: { href: '' },
    };
    vi.stubGlobal('document', documentMock);
    vi.stubGlobal('window', windowMock);
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
      posted.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: async () => ({ url: 'https://square.test/pay' }) };
    }));
    new Function(source)();

    expect(wrap2.hidden).toBe(true);
    expect(wrap3.hidden).toBe(true);
    expect(child2.required).toBe(false);
    expect(child2.disabled).toBe(true);
    expect(fee.textContent).toBe('Annual registration is $35 for one swimmer.');

    swimmers.value = '2';
    swimmers.listeners.change.forEach((fn) => fn());
    expect(wrap2.hidden).toBe(false);
    expect(child2.required).toBe(true);
    expect(child2.disabled).toBe(false);
    expect(wrap3.hidden).toBe(true);
    expect(child3.required).toBe(false);
    expect(fee.textContent).toBe('Annual registration is $50 for two siblings.');

    swimmers.value = '3';
    child2.value = '6';
    child3.value = '2';
    swimmers.listeners.change.forEach((fn) => fn());
    expect(wrap3.hidden).toBe(false);
    expect(child3.required).toBe(true);
    expect(child3.disabled).toBe(false);
    expect(fee.textContent).toBe('Annual registration is $60 for a family with three or more swimmers.');

    ids['book-time'].value = '08:00';
    form.listeners.submit.forEach((fn) => fn({ preventDefault() {} }));
    expect(posted[0]).toMatchObject({
      option: 'pkg-12',
      childAge: '4',
      childAge2: '6',
      childAge3: '2',
      swimmers: 3,
    });

    swimmers.value = '1';
    swimmers.listeners.change.forEach((fn) => fn());
    expect(child2.value).toBe('');
    expect(child3.value).toBe('');
    expect(child2.disabled).toBe(true);
    void els;
  });
});

type FakeEl = {
  id: string;
  hidden: boolean;
  required: boolean;
  disabled: boolean;
  value: string;
  textContent: string;
  input?: FakeEl;
  parentNode?: { textContent: string };
  option?: { value: string };
  name?: { value: string };
  email?: { value: string };
  phone?: { value: string };
  childAge?: { value: string };
  childAge2?: FakeEl;
  childAge3?: FakeEl;
  poolAddress?: { value: string };
  listeners: Record<string, Array<(event?: { preventDefault(): void; target?: FakeEl }) => void>>;
  classList: { toggle: () => void; add: () => void; remove: () => void };
  options: Array<{ getAttribute: () => string }>;
  selectedIndex: number;
  addEventListener: (type: string, fn: (event?: { preventDefault(): void }) => void) => void;
  querySelector: (sel: string) => FakeEl | null;
  querySelectorAll: () => FakeEl[];
};

function fakeEl(id: string): FakeEl {
  const el: FakeEl = {
    id,
    hidden: false,
    required: false,
    disabled: false,
    value: '',
    textContent: '',
    listeners: {},
    classList: { toggle() {}, add() {}, remove() {} },
    options: [{ getAttribute: () => 'false' }],
    selectedIndex: 0,
    addEventListener(type, fn) {
      (el.listeners[type] ||= []).push(fn);
    },
    querySelector() {
      return el.input || null;
    },
    querySelectorAll() {
      return [];
    },
  };
  return el;
}
