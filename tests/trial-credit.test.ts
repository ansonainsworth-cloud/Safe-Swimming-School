import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequestPost as onBookPost } from '../functions/api/book';
import { onRequestPost as onCheckoutPost } from '../functions/api/checkout';
import { resetRateLimit } from '../functions/_lib/rate-limit';
import { completedOrderSearchBody } from '../functions/_lib/registration';
import {
  decideTrialCredit,
  TRIAL_CREDIT_METADATA_KEY,
  TRIAL_CREDIT_NAME,
  type CreditOrder,
} from '../functions/_lib/trial-credit';

const CHANTAL_EMAIL = 'chantalbuck1@gmail.com';
const CHANTAL_PAYMENT = 'pay_chantal_20261114';

const checkoutEnv = {
  SQUARE_ENV: 'sandbox',
  SQUARE_ACCESS_TOKEN: 'sandbox-token',
  SQUARE_LOCATION_ID: 'LOC123',
  SQUARE_WEBHOOK_SIGNATURE_KEY: 'sig-key',
};

afterEach(() => {
  resetRateLimit();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function chantalTrial(): CreditOrder {
  return {
    id: 'order_chantal_trial',
    closed_at: '2026-11-14T18:00:00.000Z',
    line_items: [{ name: 'Single lesson', quantity: '1', base_price_money: { amount: 7500 } }],
    total_money: { amount: 7500 },
    tenders: [{ payment_id: CHANTAL_PAYMENT }],
  };
}

function laterPackage(metadata?: Record<string, string>): CreditOrder {
  return {
    id: 'order_later_package',
    closed_at: '2026-11-20T18:00:00.000Z',
    line_items: [{ name: '8 lessons', quantity: '1', base_price_money: { amount: 52000 } }],
    ...(metadata ? { metadata } : {}),
  };
}

function netCents(order: { line_items: Array<{ quantity: string; base_price_money: { amount: number } }>; discounts?: Array<{ amount_money: { amount: number } }> }) {
  const lines = order.line_items.reduce((sum, line) => sum + Number(line.quantity) * line.base_price_money.amount, 0);
  const off = (order.discounts ?? []).reduce((sum, discount) => sum + discount.amount_money.amount, 0);
  return lines - off;
}

function squareFetch(orders: CreditOrder[] | 'error') {
  return vi.fn(async (url: string) => {
    const path = String(url);
    if (path.endsWith('/customers/search')) {
      if (orders === 'error') return new Response(JSON.stringify({ errors: [{ code: 'INTERNAL_SERVER_ERROR', category: 'API_ERROR' }] }), { status: 500 });
      return Response.json({ customers: [{ id: 'CUST_CHANTAL' }] });
    }
    if (path.endsWith('/orders/search')) {
      if (orders === 'error') return new Response(JSON.stringify({ errors: [{ code: 'INTERNAL_SERVER_ERROR', category: 'API_ERROR' }] }), { status: 500 });
      return Response.json({ orders });
    }
    return Response.json({ payment_link: { url: 'https://sandbox.square.link/u/credit' } });
  });
}

function checkoutRequest(itemId: string, ip: string) {
  return new Request('https://safeswimmingschool.com/api/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
    body: JSON.stringify({ items: [{ id: itemId, quantity: 1 }], buyer: { name: 'Chantal Buchanan', email: CHANTAL_EMAIL } }),
  });
}

async function checkoutOrder(orders: CreditOrder[] | 'error', itemId: string, ip: string) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-14T18:00:00.000Z'));
  const fetchImpl = squareFetch(orders);
  vi.stubGlobal('fetch', fetchImpl);
  const response = await onCheckoutPost({ request: checkoutRequest(itemId, ip), env: checkoutEnv });
  expect(response.status).toBe(200);
  const paymentCall = fetchImpl.mock.calls.find((call) => String(call[0]).includes('/payment-links'));
  return JSON.parse(String(paymentCall?.[1]?.body)).order;
}

describe('trial lesson credit', () => {
  it('searches completed orders only, with no date cutoff', () => {
    const body = completedOrderSearchBody('LOC123', 'CUST_CHANTAL');
    expect(body.query.filter.state_filter).toEqual({ states: ['COMPLETED'] });
    expect(body.query.filter).not.toHaveProperty('date_time_filter');
  });

  it('credits Chantal Buchanan $75 on an uncredited trial from November 14, 2026', () => {
    expect(decideTrialCredit(true, [chantalTrial()])).toEqual({ apply: true, reason: 'applied', paymentId: CHANTAL_PAYMENT });
  });

  it('gives $445, $645, and $1,025 when the $75 trial is paid and uncredited', async () => {
    const expected = [
      ['pkg-8', 44500, '203.0.113.90'],
      ['pkg-12', 64500, '203.0.113.91'],
      ['pkg-20', 102500, '203.0.113.92'],
    ] as const;
    for (const [itemId, net, ip] of expected) {
      const order = await checkoutOrder([chantalTrial()], itemId, ip);
      expect(order.discounts).toEqual([
        expect.objectContaining({ name: TRIAL_CREDIT_NAME, scope: 'ORDER', amount_money: { amount: 7500, currency: 'USD' } }),
      ]);
      expect(order.metadata).toEqual({ [TRIAL_CREDIT_METADATA_KEY]: CHANTAL_PAYMENT });
      expect(order.line_items.some((line: { name: string }) => line.name === 'Annual Registration')).toBe(false);
      expect(netCents(order)).toBe(net);
    }
  });

  it('charges full price when that trial credit is already on a completed package', async () => {
    const order = await checkoutOrder(
      [chantalTrial(), laterPackage({ [TRIAL_CREDIT_METADATA_KEY]: CHANTAL_PAYMENT })],
      'pkg-8',
      '203.0.113.93',
    );
    expect(order.discounts).toBeUndefined();
    expect(netCents(order)).toBe(52000);
    expect(decideTrialCredit(true, [chantalTrial(), laterPackage({ [TRIAL_CREDIT_METADATA_KEY]: CHANTAL_PAYMENT })]).reason).toBe('credit-used');
  });

  it('charges full price when a package was bought after the trial', async () => {
    const order = await checkoutOrder([chantalTrial(), laterPackage()], 'pkg-12', '203.0.113.94');
    expect(order.discounts).toBeUndefined();
    expect(netCents(order)).toBe(72000);
    expect(decideTrialCredit(true, [chantalTrial(), laterPackage()]).reason).toBe('package-after-trial');
  });

  it('charges full price when there is no trial payment', async () => {
    const order = await checkoutOrder([], 'pkg-20', '203.0.113.95');
    expect(order.discounts).toBeUndefined();
    expect(netCents(order)).toBe(110000);
    expect(decideTrialCredit(true, []).reason).toBe('no-trial');
  });

  it('charges full price when the Square lookup fails', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((message) => { logs.push(String(message)); });
    const order = await checkoutOrder('error', 'pkg-8', '203.0.113.96');
    expect(order.discounts).toBeUndefined();
    expect(order.metadata).toBeUndefined();
    expect(netCents(order)).toBe(52000);
    const logged = logs.join('\n');
    expect(logged).not.toContain(CHANTAL_EMAIL);
    expect(logged).not.toContain('sandbox-token');
    expect(logged).not.toContain('Bearer');
  });

  it('applies the same credit on /api/book package checkout', async () => {
    const fetchImpl = squareFetch([chantalTrial()]);
    vi.stubGlobal('fetch', fetchImpl);
    const response = await onBookPost({
      request: new Request('https://safeswimmingschool.com/api/book', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          option: 'pkg-8',
          town: 'jupiter',
          day: 'Mon',
          time: '08:00',
          name: 'Chantal Buchanan',
          email: CHANTAL_EMAIL,
          phone: '561-236-8260',
          childAge: '4',
          poolAddress: '10 Lake Road',
        }),
      }),
      env: { SQUARE_ACCESS_TOKEN: 'token', SQUARE_LOCATION_ID: 'LOC123' },
    });
    expect(response.status).toBe(200);
    const paymentCall = fetchImpl.mock.calls.find((call) => String(call[1]?.body ?? '').includes('line_items'));
    const order = JSON.parse(String(paymentCall?.[1]?.body)).order;
    expect(order.line_items[0].base_price_money.amount).toBe(52000);
    expect(netCents(order)).toBe(44500);
    expect(order.metadata[TRIAL_CREDIT_METADATA_KEY]).toBe(CHANTAL_PAYMENT);
  });
});
