import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { issueHold, resetBookingState } from '../functions/_lib/booking';
import { resetCalendar } from '../functions/_lib/calendar';
import { slotStartsOnDate } from '../functions/_lib/schedule';
import { onRequestPost } from '../functions/api/checkout';
import { onRequestPost as webhookPost } from '../functions/api/square-webhook';
import { buildCreatePaymentLinkBody } from '../functions/_lib/payment-link';
import { CATALOG, priceClientLines, validateClientItems } from '../functions/_lib/prices';
import { resetRateLimit } from '../functions/_lib/rate-limit';
import { customerSearchBody, orderSearchBody } from '../functions/_lib/registration';
import { decideRegistration, MockFamilyRegistry, parentEmailInRows } from '../functions/_lib/family-registry';
import { checkoutAllowed, checkoutConfigured, SQUARE_PRODUCTION_ORIGIN, SQUARE_SANDBOX_ORIGIN, squarePost } from '../functions/_lib/square';
import { eventSummary, verifySquareSignature, webhookNotificationUrl } from '../functions/_lib/webhook';

const env = {
  SQUARE_ENVIRONMENT: 'sandbox',
  SQUARE_ACCESS_TOKEN: 'sandbox-token',
  SQUARE_LOCATION_ID: 'LOC123',
  SQUARE_WEBHOOK_SIGNATURE_KEY: 'sig-key',
  CF_PAGES_BRANCH: 'booking-payments-live',
};

afterEach(() => {
  resetRateLimit();
  resetBookingState();
  resetCalendar();
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
    expect(CATALOG.find((item) => item.id === 'trial')?.name).toBe('Single lesson');
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
  });
});

describe('registration decision', () => {
  const registry = new MockFamilyRegistry();

  it('adds the fee for a parent email that is not in the tracker', async () => {
    expect(await decideRegistration('new@example.com', registry)).toEqual({ add: true, reason: 'first-purchase' });
  });

  it('skips the fee when the parent email is already in the tracker', async () => {
    expect(await decideRegistration('returning@example.com', registry)).toEqual({ add: false, reason: 'returning' });
  });

  it('adds the fee and flags a lookup error instead of skipping it', async () => {
    expect(await decideRegistration('unavailable@example.com', registry)).toEqual({ add: true, reason: 'lookup-error' });
    expect(await decideRegistration('parent@example.com', { async lookupByParentEmail() { throw new Error('sheet down'); } })).toEqual({ add: true, reason: 'lookup-error' });
  });

  it('matches the Parent email column and ignores a missing column', () => {
    expect(parentEmailInRows([
      ['Child', 'Parent email'],
      ['Alex', 'Returning@example.com'],
    ], 'returning@example.com')).toBe(true);
    expect(parentEmailInRows([['Child', 'Parent email'], ['Alex', 'other@example.com']], 'returning@example.com')).toBe(false);
    expect(parentEmailInRows([['Child', 'Email'], ['Alex', 'returning@example.com']], 'returning@example.com')).toBeNull();
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
      buyerEmail: 'parent@family.test',
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
      pre_populated_data: { buyer_email: 'parent@family.test', buyer_phone_number: '+15612368260' },
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
      buyerEmail: 'parent@family.test',
      lines: [{ name: 'Single lesson', quantity: 1, priceCents: 7500 }],
    });
    expect(body.pre_populated_data).toEqual({ buyer_email: 'parent@family.test' });
    expect(body.order).not.toHaveProperty('customer_id');
    const fictional = buildCreatePaymentLinkBody({
      locationId: 'LOC123',
      idempotencyKey: 'idem-3',
      redirectUrl: 'https://preview.example/checkout/thanks/',
      buyerEmail: 'jordan@example.com',
      buyerPhone: '561-555-0134',
      lines: [{ name: 'Single lesson', quantity: 1, priceCents: 7500 }],
    });
    expect(fictional.pre_populated_data).toEqual({});
  });
});

describe('Square host', () => {
  it('posts to the sandbox host when SQUARE_ENVIRONMENT is sandbox', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ payment_link: { url: 'https://sandbox.square.link/u/abc' } }), { status: 200 }));
    await squarePost(env, '/v2/online-checkout/payment-links', { idempotency_key: 'k' }, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${SQUARE_SANDBOX_ORIGIN}/v2/online-checkout/payment-links`);
    expect(new Headers(init?.headers).get('Square-Version')).toBe('2026-09-16');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer sandbox-token');
    expect(String(url)).not.toContain('connect.squareup.com');
  });

  it('posts to the production host when SQUARE_ENVIRONMENT is production', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ payment_link: { url: 'https://square.link/u/live' } }), { status: 200 }));
    await squarePost({ ...env, SQUARE_ENVIRONMENT: 'production', SQUARE_ACCESS_TOKEN: 'live-token' }, '/v2/online-checkout/payment-links', { idempotency_key: 'k' }, fetchImpl);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${SQUARE_PRODUCTION_ORIGIN}/v2/online-checkout/payment-links`);
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer live-token');
  });

  it('refuses an unknown environment before any request', async () => {
    const fetchImpl = vi.fn();
    await expect(squarePost({ ...env, SQUARE_ENVIRONMENT: 'test' }, '/v2/online-checkout/payment-links', {}, fetchImpl)).rejects.toThrow(/503/);
    await expect(squarePost({ ...env, SQUARE_ENVIRONMENT: undefined }, '/v2/online-checkout/payment-links', {}, fetchImpl)).rejects.toThrow(/503/);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(checkoutConfigured({ ...env, SQUARE_ENVIRONMENT: 'production' })).toBe(true);
    expect(checkoutConfigured({ ...env, SQUARE_ACCESS_TOKEN: '' })).toBe(false);
    expect(checkoutConfigured({ ...env, SQUARE_LOCATION_ID: '' })).toBe(false);
    expect(checkoutConfigured({})).toBe(false);
  });

  it('keeps sandbox off the production branch and live payments off a preview', () => {
    expect(checkoutAllowed(env, 'https://booking-payments-live.safe-swimming-school.pages.dev/api/checkout')).toBe(true);
    expect(checkoutAllowed({ ...env, CF_PAGES_BRANCH: 'main' }, 'https://booking-payments-live.safe-swimming-school.pages.dev/api/checkout')).toBe(false);
    expect(checkoutAllowed(env, 'https://safeswimmingschool.com/api/checkout')).toBe(false);
    expect(checkoutAllowed(env, 'https://www.safeswimmingschool.com/api/checkout')).toBe(false);
    const live = { ...env, SQUARE_ENVIRONMENT: 'production', CF_PAGES_BRANCH: 'main' };
    expect(checkoutAllowed(live, 'https://safeswimmingschool.com/api/checkout')).toBe(true);
    expect(checkoutAllowed(live, 'https://safe-swimming-school.pages.dev/api/checkout')).toBe(true);
    expect(checkoutAllowed({ ...env, SQUARE_ENVIRONMENT: 'production' }, 'https://preview.example/api/checkout')).toBe(false);
  });
});

describe('checkout endpoint', () => {
  it('returns 503 when Square sandbox is not configured', async () => {
    const request = new Request('https://preview.example/api/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.5' },
      body: JSON.stringify({ items: [{ id: 'trial', quantity: 1 }], buyer: { name: 'Pat Lee', email: 'pat@example.com' } }),
    });
    const response = await onRequestPost({ request, env: { SQUARE_ENVIRONMENT: 'sandbox', CF_PAGES_BRANCH: 'booking-payments-live' } });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: 'checkout-unavailable', registrationAdded: true, registrationReason: 'first-purchase' });
  });

  it('adds registration for a new buyer and posts one sandbox payment link', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).endsWith('/v2/customers/search')) return new Response(JSON.stringify({}), { status: 200 });
      return new Response(JSON.stringify({ payment_link: { url: 'https://sandbox.square.link/u/test' } }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchImpl);
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((message) => { logs.push(String(message)); });
    const issued = await issueHold({
      env,
      requestUrl: 'https://preview.example/api/hold',
      email: 'pat@example.com',
      parent: 'Pat Lee',
      phone: '561-555-0134',
      childDob: '2022-06-15',
      poolAddress: '100 Example Lane, Jupiter, FL',
      child: 'Alex',
      itemId: 'trial',
      quantity: 1,
      slots: [slotStartsOnDate(2026, 11, 3)[4]],
      now: new Date(),
    });
    if ('error' in issued) throw new Error(issued.error);
    const request = new Request('https://preview.example/api/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7' },
      body: JSON.stringify({
        items: [{ id: 'trial', quantity: 1 }],
        buyer: { name: 'Pat Lee', email: 'Pat@Example.com', phone: '561-236-8260' },
        child: 'Alex',
        holdToken: issued.token,
      }),
    });
    const response = await onRequestPost({ request, env });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url: 'https://sandbox.square.link/u/test',
      registrationAdded: true,
      registrationReason: 'first-purchase',
    });
    const paymentCall = fetchImpl.mock.calls.find((call) => String(call[0]).includes('/v2/online-checkout/payment-links'));
    expect(paymentCall?.[0]).toBe('https://connect.squareupsandbox.com/v2/online-checkout/payment-links');
    const sent = JSON.parse(String(paymentCall?.[1]?.body));
    expect(sent.order.line_items).toEqual([
      { name: 'Single lesson', quantity: '1', base_price_money: { amount: 7500, currency: 'USD' } },
      { name: 'Annual Registration', quantity: '1', base_price_money: { amount: 3500, currency: 'USD' } },
    ]);
    expect(sent.idempotency_key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(sent.order.metadata).toEqual({ source: 'website-cart' });
    expect(sent.checkout_options.redirect_url).toBe('https://preview.example/checkout/thanks/');
    expect(sent.payment_note).toBe('Pat Lee');
    expect(sent.pre_populated_data.buyer_email).toBeUndefined();
    expect(sent.pre_populated_data.buyer_phone_number).toBe('+15612368260');
    expect(JSON.stringify(fetchImpl.mock.calls)).not.toContain('connect.squareup.com');
    expect(logs.join('\n')).not.toContain('sandbox-token');
    expect(logs.join('\n')).not.toContain('Pat@Example.com');
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

  it('returns 503 when sandbox credentials are on the production branch', async () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal('fetch', fetchImpl);
    const request = new Request('https://safeswimmingschool.com/api/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.8' },
      body: JSON.stringify({ items: [{ id: 'pkg-8', quantity: 1 }], buyer: { name: 'Pat Lee', email: 'pat@example.com' } }),
    });
    const response = await onRequestPost({ request, env: { ...env, CF_PAGES_BRANCH: 'main' } });
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({ error: 'checkout-unavailable' });
    expect(body.confirmationUrl).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns 502 when Square errors so the page can show the Pay links', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 500 }));
    vi.stubGlobal('fetch', fetchImpl);
    const request = new Request('https://preview.example/api/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' },
      body: JSON.stringify({ items: [{ id: 'water-aerobics', quantity: 1 }], buyer: { name: 'Pat Lee', email: 'pat@example.com' } }),
    });
    const response = await onRequestPost({ request, env });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'checkout-failed' });
  });

  it('shows the existing Pay links when checkout is unavailable or Square errors', () => {
    const script = readFileSync(new URL('../public/js/cart.js', import.meta.url), 'utf8');
    const page = readFileSync(new URL('../src/pages/cart.astro', import.meta.url), 'utf8');
    const links = readFileSync(new URL('../src/data/payment-links.ts', import.meta.url), 'utf8');
    expect(script).toContain('response.status === 503 || response.status === 502');
    expect(script).toContain('fallback.hidden = false');
    expect(page).toContain('id="sss-pay-fallback"');
    expect(page).toContain('You can still pay with these Square payment links.');
    expect(links).toContain('https://square.link/u/');
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

  it('accepts sandbox or production webhooks and rejects a missing environment', async () => {
    const rawBody = '{"hello":"world"}';
    const signatureHeader = createHmac('sha256', 'asdf1234')
      .update('https://example.com/api/square-webhook' + rawBody)
      .digest('base64');
    const makeRequest = () => new Request('https://example.com/api/square-webhook', {
      method: 'POST',
      headers: { 'x-square-hmacsha256-signature': signatureHeader },
      body: rawBody,
    });
    const missing = await webhookPost({ request: makeRequest(), env: { SQUARE_WEBHOOK_SIGNATURE_KEY: 'asdf1234' } });
    expect(missing.status).toBe(401);
    const sandbox = await webhookPost({
      request: makeRequest(),
      env: { SQUARE_ENVIRONMENT: 'sandbox', SQUARE_WEBHOOK_SIGNATURE_KEY: 'asdf1234' },
    });
    expect(sandbox.status).toBe(200);
    const production = await webhookPost({
      request: makeRequest(),
      env: { SQUARE_ENVIRONMENT: 'production', SQUARE_WEBHOOK_SIGNATURE_KEY: 'asdf1234' },
    });
    expect(production.status).toBe(200);
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
