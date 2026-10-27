import { readFileSync } from 'node:fs';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { onRequestPost } from '../functions/api/checkout';
import { onRequestGet as onCheckoutHealth } from '../functions/api/checkout-health';
import { onRequestPost as onWebhookPost } from '../functions/api/square-webhook';
import { buildCreatePaymentLinkBody, httpsRedirectUrl } from '../functions/_lib/payment-link';
import { CATALOG, checkoutPaymentNote, normalizeChildren, normalizePhone, normalizeSwimmerCount, priceClientLines, registrationPriceCents, validateClientItems } from '../functions/_lib/prices';
import { resetRateLimit } from '../functions/_lib/rate-limit';
import { customerSearchBody, decideRegistration, orderSearchBody, type SquareLookup } from '../functions/_lib/registration';
import { SQUARE_SANDBOX_ORIGIN } from '../functions/_lib/prices';
import { checkoutConfigured, SQUARE_PRODUCTION_ORIGIN, squarePost } from '../functions/_lib/square';
import { eventSummary, verifySquareSignature, webhookNotificationUrl } from '../functions/_lib/webhook';

const env = {
  SQUARE_ENV: 'sandbox',
  SQUARE_ACCESS_TOKEN: 'sandbox-token',
  SQUARE_LOCATION_ID: 'LOC123',
  SQUARE_WEBHOOK_SIGNATURE_KEY: 'sig-key',
};

afterEach(() => {
  resetRateLimit();
  vi.restoreAllMocks();
});

describe('price validation', () => {
  it('prices the catalog in USD cents', () => {
    const cents = Object.fromEntries(CATALOG.map((item) => [item.id, item.priceCents]));
    expect(cents).toEqual({
      'registration-annual': 3500,
      'pkg-8': 52000,
      'pkg-12': 72000,
      'pkg-20': 110000,
      trial: 7500,
      'water-aerobics': 4500,
    });
    expect(CATALOG.find((item) => item.id === 'pkg-8')?.name).toBe('8 Private Lessons (30 min)');
    expect(CATALOG.find((item) => item.id === 'water-aerobics')?.maxQty).toBe(20);
    expect(CATALOG.find((item) => item.id === 'trial')?.maxQty).toBe(3);
  });

  it('accepts sibling quantities and rejects unknown ids and bad quantities', () => {
    expect(validateClientItems([{ id: 'pkg-8', quantity: 3 }, { id: 'water-aerobics', quantity: 20 }]).ok).toBe(true);
    expect(validateClientItems([{ id: 'nope', quantity: 1 }])).toMatchObject({ ok: false });
    expect(validateClientItems([{ id: 'registration-annual', quantity: 1 }])).toMatchObject({ ok: false });
    expect(validateClientItems([{ id: 'pkg-12', quantity: 4 }])).toMatchObject({ ok: false });
    expect(validateClientItems([{ id: 'water-aerobics', quantity: 21 }])).toMatchObject({ ok: false });
    expect(validateClientItems([{ id: 'trial', quantity: 1.5 }])).toMatchObject({ ok: false });
    expect(validateClientItems([])).toMatchObject({ ok: false });
    expect(validateClientItems([{ id: 'pkg-8', quantity: 1 }, { id: 'pkg-8', quantity: 1 }])).toMatchObject({ ok: false });
  });

  it('prices from the server catalog and ignores any client price', () => {
    const validated = validateClientItems([{ id: 'pkg-20', quantity: 2, price: 1 } as { id: 'pkg-20'; quantity: number }]);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    expect(priceClientLines(validated.lines, true)).toEqual([
      { name: '20 Private Lessons (30 min)', quantity: 2, priceCents: 110000 },
      { name: 'Annual Registration', quantity: 1, priceCents: 3500 },
    ]);
    expect(priceClientLines(validated.lines, true, 2)[1]).toEqual({ name: 'Annual Registration', quantity: 1, priceCents: 5000 });
    expect(priceClientLines(validated.lines, true, 3)[1]).toEqual({ name: 'Annual Registration', quantity: 1, priceCents: 6000 });
    expect(priceClientLines(validated.lines, true, 8)[1].priceCents).toBe(6000);
  });

  it('prices registration from swimmer count, not package quantity', () => {
    expect(registrationPriceCents(1)).toBe(3500);
    expect(registrationPriceCents(2)).toBe(5000);
    expect(registrationPriceCents(3)).toBe(6000);
    expect(normalizeSwimmerCount(undefined)).toBe(1);
    expect(normalizeSwimmerCount('2')).toBe(2);
    expect(normalizeSwimmerCount(0)).toBeNull();
    expect(normalizeSwimmerCount(21)).toBeNull();
    const validated = validateClientItems([{ id: 'pkg-8', quantity: 1 }]);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    expect(priceClientLines(validated.lines, true, 2)).toEqual([
      { name: '8 Private Lessons (30 min)', quantity: 1, priceCents: 52000 },
      { name: 'Annual Registration', quantity: 1, priceCents: 5000 },
    ]);
  });

  it('derives the registration tier from the children, not from package quantity', () => {
    expect(normalizeChildren(undefined)).toEqual({ ok: true, children: null });
    expect(normalizeChildren([])).toMatchObject({ ok: false });
    expect(normalizeChildren([{ name: ' ', age: '4' }])).toMatchObject({ ok: false });
    expect(normalizeChildren([{ name: 'Ada', age: '' }])).toMatchObject({ ok: false });
    expect(normalizeChildren([{ name: 'Ada', age: '4', notes: 12 }])).toMatchObject({ ok: false });
    expect(normalizeChildren(Array.from({ length: 21 }, () => ({ name: 'Ada', age: '4' })))).toMatchObject({ ok: false });
    const three = normalizeChildren([
      { name: 'Ada Lee', age: '6', notes: 'nervous in deep water' },
      { name: 'Ben Lee', age: '4', notes: '   ' },
      { name: 'Cam Lee', age: '8 months' },
    ]);
    expect(three).toEqual({
      ok: true,
      children: [
        { name: 'Ada Lee', age: '6', notes: 'nervous in deep water' },
        { name: 'Ben Lee', age: '4' },
        { name: 'Cam Lee', age: '8 months' },
      ],
    });
    if (!three.ok || !three.children) return;
    expect(registrationPriceCents(three.children.length)).toBe(6000);
    expect(priceClientLines([{ id: 'pkg-8', quantity: 1 }], true, three.children.length)).toEqual([
      { name: '8 Private Lessons (30 min)', quantity: 1, priceCents: 52000 },
      { name: 'Annual Registration', quantity: 1, priceCents: 6000 },
    ]);
    expect(checkoutPaymentNote('Pat Lee', null)).toBe('Pat Lee');
    expect(checkoutPaymentNote('Pat Lee', three.children)).toBe(
      'Pat Lee. Children: 1. Ada Lee, age 6. Notes: nervous in deep water 2. Ben Lee, age 4 3. Cam Lee, age 8 months',
    );
    const notes = 'n'.repeat(200);
    const long = checkoutPaymentNote('Pat Lee', [
      { name: 'Ada Lee', age: '6', notes },
      { name: 'Ben Lee', age: '4', notes },
      { name: 'Cam Lee', age: '8 months', notes },
    ]);
    expect(long.length).toBeLessThanOrEqual(500);
    expect(long).toContain('Ada Lee, age 6');
    expect(long).not.toContain(notes);
  });
});

describe('registration decision', () => {
  const now = new Date('2026-10-23T15:00:00.000Z');

  function lookup(partial: Partial<SquareLookup>): SquareLookup {
    return {
      searchCustomers: async () => ({ customers: [] }),
      searchOrders: async () => ({ orders: [] }),
      ...partial,
    };
  }

  it('skips the fee when a completed order in the window has Annual Registration', async () => {
    const searchOrders = vi.fn(async () => ({
      orders: [{ line_items: [{ name: '8 Private Lessons (30 min)' }, { name: 'Annual Registration' }] }],
    }));
    const decision = await decideRegistration('parent@example.com', lookup({
      searchCustomers: async () => ({ customers: [{ id: 'CUST1' }] }),
      searchOrders,
    }), now);
    expect(decision).toEqual({ add: false, reason: 'already-registered', customerId: 'CUST1' });
    expect(searchOrders).toHaveBeenCalledWith('CUST1', '2025-10-23T15:00:00.000Z', undefined);
  });

  it('adds the fee when the customer has no registration line', async () => {
    const decision = await decideRegistration('parent@example.com', lookup({
      searchCustomers: async () => ({ customers: [{ id: 'CUST1' }] }),
      searchOrders: async () => ({ orders: [{ line_items: [{ name: 'Trial Lesson (30 min)' }] }] }),
    }), now);
    expect(decision).toEqual({ add: true, reason: 'no-recent-registration', customerId: 'CUST1' });
  });

  it('adds the fee when no customer exists', async () => {
    const decision = await decideRegistration('new@example.com', lookup({
      searchCustomers: async () => ({}),
    }), now);
    expect(decision).toEqual({ add: true, reason: 'no-customer' });
  });

  it('adds the fee and flags a lookup error', async () => {
    const decision = await decideRegistration('parent@example.com', lookup({
      searchCustomers: async () => { throw new Error('square down'); },
    }), now);
    expect(decision).toEqual({ add: true, reason: 'lookup-error' });
  });

  it('flags a lookup error when the customer search body is null', async () => {
    const decision = await decideRegistration('parent@example.com', lookup({
      searchCustomers: async () => null as unknown as { customers?: { id?: string }[] },
    }), now);
    expect(decision).toEqual({ add: true, reason: 'lookup-error' });
  });

  it('searches Square by exact email, location, completed state, and closed date', () => {
    expect(customerSearchBody('parent@example.com')).toEqual({
      limit: 10,
      query: { filter: { email_address: { exact: 'parent@example.com' } } },
    });
    expect(orderSearchBody('LOC123', 'CUST1', '2025-10-23T15:00:00.000Z')).toEqual({
      location_ids: ['LOC123'],
      limit: 100,
      query: {
        filter: {
          customer_filter: { customer_ids: ['CUST1'] },
          state_filter: { states: ['COMPLETED'] },
          date_time_filter: { closed_at: { start_at: '2025-10-23T15:00:00.000Z' } },
        },
      },
    });
  });
});

describe('CreatePaymentLink body', () => {
  it('builds an ad hoc sandbox order with no catalog ids', () => {
    const body = buildCreatePaymentLinkBody({
      locationId: 'LOC123',
      idempotencyKey: 'idem-1',
      redirectUrl: 'https://preview.example/checkout/thanks/',
      buyerEmail: 'parent@example.com',
      buyerPhone: '561-236-8260',
      customerId: 'CUST1',
      lines: priceClientLines([{ id: 'pkg-8', quantity: 1 }, { id: 'water-aerobics', quantity: 2 }], true),
    });
    expect(body).toEqual({
      idempotency_key: 'idem-1',
      order: {
        location_id: 'LOC123',
        customer_id: 'CUST1',
        line_items: [
          { name: '8 Private Lessons (30 min)', quantity: '1', base_price_money: { amount: 52000, currency: 'USD' } },
          { name: 'Water Aerobics Class (30 min)', quantity: '2', base_price_money: { amount: 4500, currency: 'USD' } },
          { name: 'Annual Registration', quantity: '1', base_price_money: { amount: 3500, currency: 'USD' } },
        ],
      },
      checkout_options: { redirect_url: 'https://preview.example/checkout/thanks/' },
      pre_populated_data: { buyer_email: 'parent@example.com', buyer_phone_number: '+15612368260' },
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/catalog/i);
    expect(serialized).not.toContain('squareup.com');
  });

  it('omits phone and customer id when they are absent', () => {
    const body = buildCreatePaymentLinkBody({
      locationId: 'LOC123',
      idempotencyKey: 'idem-2',
      redirectUrl: 'https://preview.example/checkout/thanks/',
      buyerEmail: 'parent@example.com',
      lines: [{ name: 'Trial Lesson (30 min)', quantity: 1, priceCents: 7500 }],
    });
    expect(body.pre_populated_data).toEqual({ buyer_email: 'parent@example.com' });
    expect(body.order).not.toHaveProperty('customer_id');
    expect(body.order).not.toHaveProperty('metadata');
  });

  it('omits a blank phone and upgrades an http redirect to https', () => {
    for (const buyerPhone of ['', '   ', 'not-a-phone', '12345']) {
      const body = buildCreatePaymentLinkBody({
        locationId: 'LOC123',
        idempotencyKey: 'idem-blank',
        redirectUrl: 'http://user:pass@preview.example/checkout/thanks/#fragment',
        buyerEmail: 'parent@example.com',
        buyerPhone,
        lines: [
          { name: 'Trial Lesson (30 min)', quantity: 1, priceCents: 7500 },
          { name: 'Annual Registration', quantity: 1, priceCents: 3500 },
        ],
      });
      expect(body.pre_populated_data).toEqual({ buyer_email: 'parent@example.com' });
      expect(JSON.stringify(body)).not.toContain('buyer_phone_number');
      expect(body.checkout_options.redirect_url).toBe('https://preview.example/checkout/thanks/');
      expect(body.order).not.toHaveProperty('metadata');
      expect(body.order.line_items).toEqual([
        { name: 'Trial Lesson (30 min)', quantity: '1', base_price_money: { amount: 7500, currency: 'USD' } },
        { name: 'Annual Registration', quantity: '1', base_price_money: { amount: 3500, currency: 'USD' } },
      ]);
    }
    expect(httpsRedirectUrl('https://safeswimmingschool.com/checkout/thanks/')).toBe('https://safeswimmingschool.com/checkout/thanks/');
    expect(normalizePhone(null)).toBeUndefined();
    expect(normalizePhone('')).toBeUndefined();
    expect(normalizePhone(' ')).toBeUndefined();
    expect(normalizePhone('561-236-8260')).toBe('+15612368260');
    expect(normalizePhone('+1 (561) 236-8260')).toBe('+15612368260');
    expect(normalizePhone('15612368260')).toBe('+15612368260');
    expect(normalizePhone('+442079460958')).toBe('+442079460958');
    expect(normalizePhone('12345')).toBeUndefined();
    expect(normalizePhone(12)).toBeNull();
  });
});

describe('Square host', () => {
  it('posts sandbox calls to the sandbox host with the current Square-Version', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ payment_link: { url: 'https://sandbox.square.link/u/abc' } }), { status: 200 }));
    await squarePost(env, '/v2/online-checkout/payment-links', { idempotency_key: 'k' }, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${SQUARE_SANDBOX_ORIGIN}/v2/online-checkout/payment-links`);
    expect(new Headers(init?.headers).get('Square-Version')).toBe('2026-09-16');
    expect(new Headers(init?.headers).get('Accept-Encoding')).toBe('identity');
    expect(init?.redirect).toBe('manual');
    expect(init?.cache).toBe('no-store');
    expect(String(url)).not.toContain('connect.squareup.com');
  });

  it('posts production calls to connect.squareup.com', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ payment_link: { url: 'https://square.link/u/abc' } }), { status: 200 }));
    await squarePost({ ...env, SQUARE_ENV: 'production' }, '/v2/online-checkout/payment-links', { idempotency_key: 'k' }, fetchImpl);
    const [url] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${SQUARE_PRODUCTION_ORIGIN}/v2/online-checkout/payment-links`);
    expect(String(url)).not.toContain('squareupsandbox.com');
  });

  it('requires the token, location, and webhook key, and refuses an unknown env before any request', async () => {
    const fetchImpl = vi.fn();
    const production = { ...env, SQUARE_ENV: 'production' };
    expect(checkoutConfigured(production)).toBe(true);
    expect(checkoutConfigured(env)).toBe(true);
    expect(checkoutConfigured({ ...production, SQUARE_ACCESS_TOKEN: '' })).toBe(false);
    expect(checkoutConfigured({ ...production, SQUARE_LOCATION_ID: '' })).toBe(false);
    expect(checkoutConfigured({ ...production, SQUARE_WEBHOOK_SIGNATURE_KEY: '' })).toBe(false);
    expect(checkoutConfigured({ ...env, SQUARE_ACCESS_TOKEN: '' })).toBe(false);
    expect(checkoutConfigured({ ...production, SQUARE_ENV: 'live' })).toBe(false);
    await expect(squarePost({ ...env, SQUARE_ENV: 'live' }, '/v2/online-checkout/payment-links', {}, fetchImpl)).rejects.toThrow(/503/);
    await expect(squarePost({ ...production, SQUARE_ACCESS_TOKEN: '' }, '/v2/online-checkout/payment-links', {}, fetchImpl)).rejects.toThrow(/503/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('checkout endpoint', () => {
  it('returns 503 when Square sandbox is not configured', async () => {
    const request = new Request('https://preview.example/api/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.5' },
      body: JSON.stringify({ items: [{ id: 'trial', quantity: 1 }], buyer: { name: 'Pat Lee', email: 'pat@example.com' } }),
    });
    const response = await onRequestPost({ request, env: { SQUARE_ENV: 'sandbox' } });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'checkout-unavailable' });
  });

  it('adds registration for a new buyer and posts one sandbox payment link', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).endsWith('/v2/customers/search')) return new Response(JSON.stringify({}), { status: 200 });
      return new Response(JSON.stringify({ payment_link: { url: 'https://sandbox.square.link/u/test' } }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchImpl);
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((message) => { logs.push(String(message)); });
    const request = new Request('https://preview.example/api/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7' },
      body: JSON.stringify({ items: [{ id: 'trial', quantity: 1 }], buyer: { name: 'Pat Lee', email: 'Pat@Example.com', phone: '561-236-8260' } }),
    });
    const response = await onRequestPost({ request, env });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url: 'https://sandbox.square.link/u/test',
      registrationAdded: true,
      registrationReason: 'no-customer',
      registrationCents: 3500,
    });
    const paymentCall = fetchImpl.mock.calls.find((call) => String(call[0]).includes('/v2/online-checkout/payment-links'));
    expect(paymentCall?.[0]).toBe('https://connect.squareupsandbox.com/v2/online-checkout/payment-links');
    const sent = JSON.parse(String(paymentCall?.[1]?.body));
    expect(sent.order.line_items).toEqual([
      { name: 'Trial Lesson (30 min)', quantity: '1', base_price_money: { amount: 7500, currency: 'USD' } },
      { name: 'Annual Registration', quantity: '1', base_price_money: { amount: 3500, currency: 'USD' } },
    ]);
    expect(sent.order).not.toHaveProperty('metadata');
    expect(sent.checkout_options.redirect_url).toBe('https://preview.example/checkout/thanks/');
    expect(sent.payment_note).toBe('Pat Lee');
    expect(sent.pre_populated_data.buyer_email).toBe('pat@example.com');
    expect(sent.pre_populated_data.buyer_phone_number).toBe('+15612368260');
    expect(JSON.stringify(fetchImpl.mock.calls)).not.toContain('connect.squareup.com');
    expect(logs.join('\n')).not.toContain('sandbox-token');
    expect(logs.join('\n')).not.toContain('Pat@Example.com');
  });

  it('charges the registration tier for 2 and 3 swimmers on the server payment link', async () => {
    const amounts: number[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/v2/customers/search')) return new Response(JSON.stringify({}), { status: 200 });
      const body = JSON.parse(String(init?.body));
      const registration = body.order.line_items.find((line: { name: string }) => line.name === 'Annual Registration');
      amounts.push(registration.base_price_money.amount);
      return new Response(JSON.stringify({ payment_link: { url: 'https://sandbox.square.link/u/tier' } }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchImpl);
    for (const [swimmers, ip] of [[2, '203.0.113.21'], [3, '203.0.113.22'], [5, '203.0.113.23']] as const) {
      const request = new Request('https://preview.example/api/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
        body: JSON.stringify({ items: [{ id: 'pkg-8', quantity: 1 }], swimmers, buyer: { name: 'Pat Lee', email: 'pat@example.com' } }),
      });
      const response = await onRequestPost({ request, env });
      expect(response.status).toBe(200);
      expect((await response.json()).registrationCents).toBe(swimmers === 2 ? 5000 : 6000);
    }
    expect(amounts).toEqual([5000, 6000, 6000]);
  });

  it('keeps one package for three children and puts their details in the payment note', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).endsWith('/v2/customers/search')) return new Response(JSON.stringify({}), { status: 200 });
      return new Response(JSON.stringify({ payment_link: { url: 'https://sandbox.square.link/u/kids' } }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchImpl);
    const request = new Request('https://preview.example/api/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.80' },
      body: JSON.stringify({
        items: [{ id: 'pkg-8', quantity: 1 }],
        swimmers: 1,
        children: [
          { name: 'Ada Lee', age: '6', notes: 'nervous in deep water' },
          { name: 'Ben Lee', age: '4' },
          { name: 'Cam Lee', age: '8 months', notes: '' },
        ],
        buyer: { name: 'Pat Lee', email: 'pat@example.com' },
      }),
    });
    const response = await onRequestPost({ request, env });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ registrationAdded: true, registrationCents: 6000, registrationReason: 'no-customer' });
    const paymentCall = fetchImpl.mock.calls.find((call) => String(call[0]).includes('/v2/online-checkout/payment-links'));
    const sent = JSON.parse(String(paymentCall?.[1]?.body));
    expect(sent.order.line_items).toEqual([
      { name: '8 Private Lessons (30 min)', quantity: '1', base_price_money: { amount: 52000, currency: 'USD' } },
      { name: 'Annual Registration', quantity: '1', base_price_money: { amount: 6000, currency: 'USD' } },
    ]);
    expect(sent.order).not.toHaveProperty('metadata');
    expect(JSON.stringify(sent)).not.toContain('"metadata"');
    expect(sent.payment_note).toBe('Pat Lee. Children: 1. Ada Lee, age 6. Notes: nervous in deep water 2. Ben Lee, age 4 3. Cam Lee, age 8 months');
    expect(sent.payment_note.length).toBeLessThanOrEqual(500);
  });

  it('rejects a child with no name', async () => {
    const request = new Request('https://preview.example/api/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.81' },
      body: JSON.stringify({
        items: [{ id: 'pkg-8', quantity: 1 }],
        children: [{ name: '', age: '4' }],
        buyer: { name: 'Pat Lee', email: 'pat@example.com' },
      }),
    });
    const response = await onRequestPost({ request, env });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid-children' });
  });

  it('posts a production checkout to connect.squareup.com', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).endsWith('/v2/customers/search')) return new Response(JSON.stringify({}), { status: 200 });
      return new Response(JSON.stringify({ payment_link: { url: 'https://square.link/u/live' } }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchImpl);
    const request = new Request('https://safeswimmingschool.com/api/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.40' },
      body: JSON.stringify({ items: [{ id: 'trial', quantity: 1 }], buyer: { name: 'Pat Lee', email: 'pat@example.com' } }),
    });
    const response = await onRequestPost({
      request,
      env: { ...env, SQUARE_ENV: 'production', SQUARE_ACCESS_TOKEN: 'prod-token' },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ url: 'https://square.link/u/live', registrationAdded: true });
    const paymentCall = fetchImpl.mock.calls.find((call) => String(call[0]).includes('/v2/online-checkout/payment-links'));
    expect(paymentCall?.[0]).toBe('https://connect.squareup.com/v2/online-checkout/payment-links');
    expect(new Headers(paymentCall?.[1]?.headers).get('Authorization')).toBe('Bearer prod-token');
    expect(JSON.stringify(fetchImpl.mock.calls)).not.toContain('squareupsandbox.com');
  });

  it('checks out a trial plus one-swimmer registration with a blank phone', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).endsWith('/v2/customers/search')) return new Response(JSON.stringify({}), { status: 200 });
      return new Response(JSON.stringify({ payment_link: { url: 'https://square.link/u/trial' } }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchImpl);
    const request = new Request('http://safeswimmingschool.com/api/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.41' },
      body: JSON.stringify({
        items: [{ id: 'trial', quantity: 1 }],
        swimmers: 1,
        buyer: { name: 'Pat Lee', email: 'pat@example.com', phone: ' ' },
      }),
    });
    const response = await onRequestPost({
      request,
      env: { ...env, SQUARE_ENV: 'production', SQUARE_ACCESS_TOKEN: 'prod-token' },
    });
    expect(response.status).toBe(200);
    const paymentCall = fetchImpl.mock.calls.find((call) => String(call[0]).includes('/v2/online-checkout/payment-links'));
    const sent = JSON.parse(String(paymentCall?.[1]?.body));
    expect(sent.order.line_items).toEqual([
      { name: 'Trial Lesson (30 min)', quantity: '1', base_price_money: { amount: 7500, currency: 'USD' } },
      { name: 'Annual Registration', quantity: '1', base_price_money: { amount: 3500, currency: 'USD' } },
    ]);
    expect(sent.pre_populated_data).toEqual({ buyer_email: 'pat@example.com' });
    expect(sent.order).not.toHaveProperty('metadata');
    expect(sent.checkout_options.redirect_url).toBe('https://safeswimmingschool.com/checkout/thanks/');
    expect(new Headers(paymentCall?.[1]?.headers).get('Square-Version')).toBe('2026-09-16');
  });

  it('returns 400 for a bad cart and does not call Square', async () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal('fetch', fetchImpl);
    const request = new Request('https://preview.example/api/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.6' },
      body: JSON.stringify({ items: [{ id: 'pkg-8', quantity: 9 }], buyer: { name: 'Pat Lee', email: 'pat@example.com' } }),
    });
    const response = await onRequestPost({ request, env });
    expect(response.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('Square error logs', () => {
  function captureLogs(): string[] {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((message) => { logs.push(String(message)); });
    return logs;
  }

  it('logs payment-link status and Square error fields without the token or buyer detail', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      errors: [{
        code: 'INVALID_VALUE',
        category: 'INVALID_REQUEST_ERROR',
        field: 'order.metadata',
        detail: 'parent@example.com 561-236-8260 rejected',
      }],
    }), { status: 400 }));
    const logs = captureLogs();
    await expect(squarePost(env, '/v2/online-checkout/payment-links', { idempotency_key: 'k' }, fetchImpl)).rejects.toThrow(/Square request failed \(400\)/);
    expect(JSON.parse(logs.join('\n'))).toEqual({
      step: 'payment-link',
      status: 400,
      errors: [{ code: 'INVALID_VALUE', category: 'INVALID_REQUEST_ERROR', field: 'order.metadata' }],
    });
    const logged = logs.join('\n');
    expect(logged).not.toContain('sandbox-token');
    expect(logged).not.toContain('parent@example.com');
    expect(logged).not.toContain('561-236-8260');
    expect(logged).not.toContain('detail');
    expect(logged).not.toContain('Bearer');

    logs.length = 0;
    const customerFetch = vi.fn(async () => new Response(JSON.stringify({
      errors: [{ code: 'INVALID_REQUEST', category: 'INVALID_REQUEST_ERROR', field: 'query.filter', detail: 'parent@example.com' }],
    }), { status: 400 }));
    await expect(squarePost(env, '/v2/customers/search', { limit: 1 }, customerFetch)).rejects.toThrow(/400/);
    expect(JSON.parse(logs[0])).toEqual({
      step: 'customers-search',
      status: 400,
      errors: [{ code: 'INVALID_REQUEST', category: 'INVALID_REQUEST_ERROR', field: 'query.filter' }],
    });
    expect(logs[0]).not.toContain('parent@example.com');
  });

  it('logs an orders-search failure and still creates the payment link', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const target = String(url);
      if (target.endsWith('/v2/customers/search')) return new Response(JSON.stringify({ customers: [{ id: 'CUST1' }] }), { status: 200 });
      if (target.endsWith('/v2/orders/search')) {
        return new Response(JSON.stringify({
          errors: [{ code: 'INVALID_REQUEST', category: 'INVALID_REQUEST_ERROR', field: 'query', detail: 'parent@example.com' }],
        }), { status: 400 });
      }
      return new Response(JSON.stringify({ payment_link: { url: 'https://square.link/u/after-lookup' } }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchImpl);
    const logs = captureLogs();
    const request = new Request('https://safeswimmingschool.com/api/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.42' },
      body: JSON.stringify({ items: [{ id: 'trial', quantity: 1 }], buyer: { name: 'Pat Lee', email: 'parent@example.com' } }),
    });
    const response = await onRequestPost({
      request,
      env: { ...env, SQUARE_ENV: 'production', SQUARE_ACCESS_TOKEN: 'prod-token' },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ registrationReason: 'lookup-error', url: 'https://square.link/u/after-lookup' });
    const orderLog = logs.map((line) => JSON.parse(line)).find((entry) => entry.step === 'orders-search');
    expect(orderLog).toEqual({
      step: 'orders-search',
      status: 400,
      errors: [{ code: 'INVALID_REQUEST', category: 'INVALID_REQUEST_ERROR', field: 'query' }],
    });
    expect(logs.join('\n')).not.toContain('parent@example.com');
    expect(logs.join('\n')).not.toContain('prod-token');
  });

  it('returns checkout-failed when CreatePaymentLink is rejected and logs the step', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).endsWith('/v2/customers/search')) return new Response(JSON.stringify({}), { status: 200 });
      return new Response('not-json', { status: 400 });
    });
    vi.stubGlobal('fetch', fetchImpl);
    const logs = captureLogs();
    const request = new Request('https://safeswimmingschool.com/api/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.43' },
      body: JSON.stringify({ items: [{ id: 'trial', quantity: 1 }], buyer: { name: 'Pat Lee', email: 'pat@example.com', phone: '' } }),
    });
    const response = await onRequestPost({
      request,
      env: { ...env, SQUARE_ENV: 'production', SQUARE_ACCESS_TOKEN: 'prod-token' },
    });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'checkout-failed' });
    expect(JSON.parse(logs[0])).toEqual({ step: 'payment-link', status: 400, errors: [] });
    expect(logs.join('\n')).not.toContain('prod-token');
    expect(logs.join('\n')).not.toContain('pat@example.com');
    expect(logs.join('\n')).not.toContain('not-json');
    expect(response.headers.get('content-type')).toContain('application/json');
  });

  it('returns checkout JSON when the Workers proxy body is plain text error code 502', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('Accept-Encoding')).toBe('identity');
      expect(init?.redirect).toBe('manual');
      if (String(url).endsWith('/v2/customers/search')) return new Response(JSON.stringify({}), { status: 200 });
      return new Response('error code: 502', { status: 502, headers: { 'content-type': 'text/plain' } });
    });
    vi.stubGlobal('fetch', fetchImpl);
    const logs = captureLogs();
    const request = new Request('https://safeswimmingschool.com/api/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.44' },
      body: JSON.stringify({ items: [{ id: 'trial', quantity: 1 }], swimmers: 1, buyer: { name: 'Pat Lee', email: 'pat@example.com' } }),
    });
    const response = await onRequestPost({
      request,
      env: { ...env, SQUARE_ENV: 'production', SQUARE_ACCESS_TOKEN: 'prod-token', SQUARE_LOCATION_ID: 'LBP6350HER5HN' },
    });
    expect(response.status).toBe(502);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({ error: 'checkout-failed' });
    expect(JSON.parse(logs[0])).toEqual({ step: 'payment-link', status: 502, errors: [] });
    const logged = logs.join('\n');
    expect(logged).not.toContain('error code');
    expect(logged).not.toContain('prod-token');
    expect(logged).not.toContain('pat@example.com');
    expect(logged).not.toContain('LBP6350HER5HN');
  });

  it('returns checkout JSON when the Square fetch throws', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).endsWith('/v2/customers/search')) return new Response(JSON.stringify({}), { status: 200 });
      throw new TypeError('Network connection lost');
    });
    vi.stubGlobal('fetch', fetchImpl);
    const logs = captureLogs();
    const request = new Request('https://safeswimmingschool.com/api/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.45' },
      body: JSON.stringify({ items: [{ id: 'trial', quantity: 1 }], swimmers: 1, buyer: { name: 'Pat Lee', email: 'pat@example.com' } }),
    });
    const response = await onRequestPost({
      request,
      env: { ...env, SQUARE_ENV: 'production', SQUARE_ACCESS_TOKEN: 'prod-token' },
    });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'checkout-failed' });
    expect(JSON.parse(logs.at(-1) || '')).toEqual({ step: 'payment-link', status: 0, errors: [] });
    expect(logs.join('\n')).not.toContain('Network connection lost');
    expect(logs.join('\n')).not.toContain('prod-token');
  });

  it('returns checkout JSON when the redirect URL cannot be built', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal('fetch', fetchImpl);
    const request = new Request('ftp://files.example/api/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.46' },
      body: JSON.stringify({ items: [{ id: 'trial', quantity: 1 }], swimmers: 1, buyer: { name: 'Pat Lee', email: 'pat@example.com' } }),
    });
    const response = await onRequestPost({ request, env });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'checkout-failed' });
  });
});

describe('checkout health', () => {
  it('reports booleans and the location GET status without secrets', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(String(url)).toBe('https://connect.squareup.com/v2/locations/LBP6350HER5HN');
      expect(init?.method).toBe('GET');
      expect(init?.body).toBeUndefined();
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer prod-token');
      expect(new Headers(init?.headers).get('Accept-Encoding')).toBe('identity');
      expect(init?.redirect).toBe('manual');
      return new Response(JSON.stringify({ location: { id: 'LBP6350HER5HN', name: 'Safe Swimming School' } }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchImpl);
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((message) => { logs.push(String(message)); });
    const request = new Request('https://safeswimmingschool.com/api/checkout-health', {
      headers: { 'cf-connecting-ip': '203.0.113.50' },
    });
    const response = await onCheckoutHealth({
      request,
      env: { SQUARE_ENV: 'production', SQUARE_ACCESS_TOKEN: 'prod-token', SQUARE_LOCATION_ID: 'LBP6350HER5HN' },
    });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ envSet: true, originChosen: true, locationStatus: 200 });
    expect(text).not.toContain('prod-token');
    expect(text).not.toContain('LBP6350HER5HN');
    expect(text).not.toContain('production');
    expect(text).not.toContain('connect.squareup.com');
    expect(text).not.toContain('Safe Swimming School');
    expect(logs.join('\n')).not.toContain('prod-token');
    expect(logs.join('\n')).not.toContain('LBP6350HER5HN');
  });

  it('reports the Square status when the location GET fails and does not call Square without a chosen origin', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      errors: [{ code: 'UNAUTHORIZED', category: 'AUTHENTICATION_ERROR', field: 'authorization', detail: 'bad token parent@example.com' }],
    }), { status: 401 }));
    vi.stubGlobal('fetch', fetchImpl);
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((message) => { logs.push(String(message)); });
    const denied = await onCheckoutHealth({
      request: new Request('https://safeswimmingschool.com/api/checkout-health', { headers: { 'cf-connecting-ip': '203.0.113.51' } }),
      env: { SQUARE_ENV: 'production', SQUARE_ACCESS_TOKEN: 'prod-token', SQUARE_LOCATION_ID: 'LBP6350HER5HN' },
    });
    expect(denied.status).toBe(200);
    expect(await denied.json()).toEqual({ envSet: true, originChosen: true, locationStatus: 401 });
    expect(JSON.parse(logs[0])).toEqual({
      step: 'location',
      status: 401,
      errors: [{ code: 'UNAUTHORIZED', category: 'AUTHENTICATION_ERROR', field: 'authorization' }],
    });
    expect(logs.join('\n')).not.toContain('parent@example.com');
    expect(logs.join('\n')).not.toContain('prod-token');

    fetchImpl.mockClear();
    const unconfigured = await onCheckoutHealth({
      request: new Request('https://safeswimmingschool.com/api/checkout-health', { headers: { 'cf-connecting-ip': '203.0.113.52' } }),
      env: { SQUARE_ENV: 'live', SQUARE_ACCESS_TOKEN: 'prod-token', SQUARE_LOCATION_ID: 'LBP6350HER5HN' },
    });
    expect(await unconfigured.json()).toEqual({ envSet: true, originChosen: false, locationStatus: 0 });
    const missing = await onCheckoutHealth({
      request: new Request('https://safeswimmingschool.com/api/checkout-health', { headers: { 'cf-connecting-ip': '203.0.113.53' } }),
      env: { SQUARE_LOCATION_ID: '../v2/customers' },
    });
    expect(await missing.json()).toEqual({ envSet: false, originChosen: false, locationStatus: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('webhook signature', () => {
  it('matches the Square documentation vector and rejects a mismatch', async () => {
    const rawBody = '{"hello":"world"}';
    const notificationUrl = 'https://example.com/webhook';
    const signatureKey = 'asdf1234';
    const signatureHeader = '2kRE5qRU2tR+tBGlDwMEw2avJ7QM4ikPYD/PJ3bd9Og=';
    expect(await verifySquareSignature({ rawBody, signatureHeader, signatureKey, notificationUrl })).toBe(true);
    expect(await verifySquareSignature({ rawBody, signatureHeader: signatureHeader.slice(0, -2) + 'xx', signatureKey, notificationUrl })).toBe(false);
    expect(await verifySquareSignature({ rawBody, signatureHeader: 'short', signatureKey, notificationUrl })).toBe(false);
    expect(await verifySquareSignature({ rawBody: rawBody + ' ', signatureHeader, signatureKey, notificationUrl })).toBe(false);
  });

  it('builds the notification URL from the request origin and the webhook path', () => {
    expect(webhookNotificationUrl('https://safeswimmingschool.com/api/square-webhook?x=1')).toBe('https://safeswimmingschool.com/api/square-webhook');
  });

  it('verifies the signature in production and sandbox, and rejects a bad signature, a missing key, or an unknown env', async () => {
    const rawBody = '{"type":"payment.updated","data":{"object":{"payment":{"order_id":"ORD1","status":"COMPLETED"}}}}';
    const notificationUrl = 'https://safeswimmingschool.com/api/square-webhook';
    const signature = await signSquare(notificationUrl, rawBody, 'sig-key');
    for (const squareEnv of ['production', 'sandbox']) {
      const response = await onWebhookPost({
        request: webhookRequest(rawBody, signature),
        env: { ...env, SQUARE_ENV: squareEnv },
      });
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('OK');
    }
    expect((await onWebhookPost({
      request: webhookRequest(rawBody, 'not-the-signature'),
      env: { ...env, SQUARE_ENV: 'production' },
    })).status).toBe(401);
    expect((await onWebhookPost({
      request: webhookRequest(rawBody, signature),
      env: { SQUARE_ENV: 'production', SQUARE_ACCESS_TOKEN: 'tok', SQUARE_LOCATION_ID: 'LOC123' },
    })).status).toBe(401);
    expect((await onWebhookPost({
      request: webhookRequest(rawBody, signature),
      env: { ...env, SQUARE_ENV: 'live' },
    })).status).toBe(401);
  });

  it('summarizes payment and order events without buyer fields', () => {
    expect(eventSummary({
      type: 'payment.updated',
      data: { object: { payment: { order_id: 'ORD1', status: 'COMPLETED', buyer_email_address: 'pat@example.com' } } },
    })).toEqual({ event: 'payment.updated', orderId: 'ORD1', status: 'COMPLETED' });
    expect(eventSummary({
      type: 'order.updated',
      data: { id: 'ORD2', object: { order_updated: { order_id: 'ORD2', state: 'COMPLETED' } } },
    })).toEqual({ event: 'order.updated', orderId: 'ORD2', status: 'COMPLETED' });
    expect(JSON.stringify(eventSummary({
      type: 'payment.updated',
      data: { object: { payment: { order_id: 'ORD1', status: 'COMPLETED', buyer_email_address: 'pat@example.com' } } },
    }))).not.toContain('pat@example.com');
  });
});

describe('routes', () => {
  it('includes the checkout routes without an overlap', () => {
    const routes = JSON.parse(readFileSync(new URL('../public/_routes.json', import.meta.url), 'utf8')) as { include: string[] };
    expect(routes.include).toContain('/api/checkout');
    expect(routes.include).toContain('/api/checkout-health');
    expect(routes.include).toContain('/api/square-webhook');
    expect(routesOverlap(routes.include)).toBe(false);
  });
});

function webhookRequest(rawBody: string, signature: string): Request {
  return new Request('https://safeswimmingschool.com/api/square-webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-square-hmacsha256-signature': signature },
    body: rawBody,
  });
}

async function signSquare(notificationUrl: string, rawBody: string, signatureKey: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(signatureKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(notificationUrl + rawBody));
  let binary = '';
  const bytes = new Uint8Array(mac);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function routesOverlap(rules: string[]): boolean {
  for (const rule of rules) {
    if (!rule.endsWith('/*')) continue;
    const prefix = rule.slice(0, -1);
    for (const other of rules) {
      if (other !== rule && other.startsWith(prefix)) return true;
    }
  }
  return false;
}
