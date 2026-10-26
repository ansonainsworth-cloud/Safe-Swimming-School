import { readFileSync } from 'node:fs';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { onRequestPost } from '../functions/api/checkout';
import { buildCreatePaymentLinkBody } from '../functions/_lib/payment-link';
import { CATALOG, normalizeSwimmerCount, priceClientLines, registrationPriceCents, validateClientItems } from '../functions/_lib/prices';
import { resetRateLimit } from '../functions/_lib/rate-limit';
import { customerSearchBody, decideRegistration, orderSearchBody, type SquareLookup } from '../functions/_lib/registration';
import { SQUARE_SANDBOX_ORIGIN } from '../functions/_lib/prices';
import { checkoutConfigured, squarePost } from '../functions/_lib/square';
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
        metadata: { source: 'website-cart' },
      },
      checkout_options: { redirect_url: 'https://preview.example/checkout/thanks/' },
      pre_populated_data: { buyer_email: 'parent@example.com', buyer_phone_number: '561-236-8260' },
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
  });
});

describe('Square host', () => {
  it('posts only to the sandbox host with the current Square-Version', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ payment_link: { url: 'https://sandbox.square.link/u/abc' } }), { status: 200 }));
    await squarePost(env, '/v2/online-checkout/payment-links', { idempotency_key: 'k' }, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${SQUARE_SANDBOX_ORIGIN}/v2/online-checkout/payment-links`);
    expect(new Headers(init?.headers).get('Square-Version')).toBe('2026-09-16');
    expect(String(url)).not.toContain('connect.squareup.com');
  });

  it('refuses a non-sandbox environment before any request', async () => {
    const fetchImpl = vi.fn();
    await expect(squarePost({ ...env, SQUARE_ENV: 'production' }, '/v2/online-checkout/payment-links', {}, fetchImpl)).rejects.toThrow(/503/);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(checkoutConfigured({ ...env, SQUARE_ENV: 'production' })).toBe(false);
    expect(checkoutConfigured({ ...env, SQUARE_ACCESS_TOKEN: '' })).toBe(false);
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
    expect(sent.order.metadata).toEqual({ source: 'website-cart' });
    expect(sent.checkout_options.redirect_url).toBe('https://preview.example/checkout/thanks/');
    expect(sent.payment_note).toBe('Pat Lee');
    expect(sent.pre_populated_data.buyer_email).toBe('pat@example.com');
    expect(sent.pre_populated_data.buyer_phone_number).toBe('561-236-8260');
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
    expect(routes.include).toContain('/api/square-webhook');
    expect(routesOverlap(routes.include)).toBe(false);
  });
});

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
