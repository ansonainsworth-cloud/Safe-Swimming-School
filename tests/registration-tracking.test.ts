import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequestPost as onBookPost } from '../functions/api/book';
import { priceClientLines } from '../functions/_lib/prices';
import {
  decideRegistration,
  lineCountsAsRegistration,
  orderIsSettled,
  REGISTRATION_PERIOD,
  registrationWindowStart,
  type RegistrationOrder,
  type SquareLookup,
} from '../functions/_lib/registration';
import { isSingleLessonOrder } from '../functions/_lib/trial-credit';

const email = 'info@safeswimmingschool.com';
const now = new Date('2026-06-01T15:00:00.000Z');

function lookup(partial: Partial<SquareLookup>): SquareLookup {
  return {
    searchCustomers: async () => ({ customers: [{ id: 'CUST1' }] }),
    searchOrders: async () => ({ orders: [] }),
    searchOpenOrders: async () => ({ orders: [] }),
    listRecentPayments: async () => ({ payments: [] }),
    retrieveOrder: async () => ({ order: undefined }),
    ...partial,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('registration line names', () => {
  it('counts registration names and skips waived, gift, and plus-registration lines', () => {
    for (const name of [
      'Annual Registration',
      'Annual registration (2 siblings)',
      'Registration Fee',
      '2024 Registration',
      '2024 Sibling Registration',
      '2024 Family Registration',
    ]) {
      expect(lineCountsAsRegistration(name), name).toBe(true);
    }
    expect(lineCountsAsRegistration('8 private lessons, registration waived')).toBe(false);
    expect(lineCountsAsRegistration('Registration waive for lock in')).toBe(false);
    expect(lineCountsAsRegistration('Gift certificate, registration included')).toBe(false);
    expect(lineCountsAsRegistration('8 lessons plus registration')).toBe(false);
    expect(lineCountsAsRegistration('Single lesson')).toBe(false);
  });
});

describe('paid orders', () => {
  it('treats a completed order, a zero balance, covering tenders, or a completed payment as paid', () => {
    expect(orderIsSettled({ state: 'COMPLETED' })).toBe(true);
    expect(orderIsSettled({ state: 'OPEN', net_amount_due_money: { amount: 0 } })).toBe(true);
    expect(orderIsSettled({ state: 'OPEN', total_money: { amount: 3500 }, tenders: [{ amount_money: { amount: 3500 } }] })).toBe(true);
    expect(orderIsSettled({ state: 'OPEN', net_amount_due_money: { amount: 3500 } }, true)).toBe(true);
    expect(orderIsSettled({ state: 'OPEN', net_amount_due_money: { amount: 3500 } })).toBe(false);
    expect(orderIsSettled({ state: 'OPEN', total_money: { amount: 3500 }, tenders: [{ amount_money: { amount: 1000 } }] })).toBe(false);
  });

  it('counts a paid open order and ignores an unpaid open order', async () => {
    const paid = await decideRegistration(email, lookup({
      searchOpenOrders: async () => ({
        orders: [{
          state: 'OPEN',
          created_at: '2026-03-01T15:00:00.000Z',
          net_amount_due_money: { amount: 0 },
          line_items: [{ name: '2024 Family Registration' }],
        }],
      }),
    }), now);
    expect(paid).toEqual({ add: false, reason: 'already-registered', customerId: 'CUST1' });

    const unpaid = await decideRegistration(email, lookup({
      searchOpenOrders: async () => ({
        orders: [{
          state: 'OPEN',
          created_at: '2026-03-01T15:00:00.000Z',
          net_amount_due_money: { amount: 3500 },
          line_items: [{ name: 'Registration Fee' }],
        }],
      }),
    }), now);
    expect(unpaid).toEqual({ add: true, reason: 'no-recent-registration', customerId: 'CUST1' });
  });

  it('counts a completed payment for an open order found by buyer email when there is no customer id', async () => {
    const decision = await decideRegistration(email, lookup({
      searchCustomers: async () => ({ customers: [] }),
      listRecentPayments: async () => ({
        payments: [{
          id: 'PAY1',
          status: 'COMPLETED',
          created_at: '2026-04-02T15:00:00.000Z',
          order_id: 'ORDER1',
          buyer_email_address: 'Info@SafeSwimmingSchool.com',
        }],
      }),
      retrieveOrder: async () => ({
        order: {
          id: 'ORDER1',
          state: 'OPEN',
          net_amount_due_money: { amount: 3500 },
          line_items: [{ name: 'Registration Fee' }],
          fulfillments: [{ pickup_details: { recipient: { email_address: email } } }],
        } satisfies RegistrationOrder,
      }),
    }), now);
    expect(decision).toEqual({ add: false, reason: 'already-registered' });
  });

  it('does not count an unpaid payment or a registration outside the email', async () => {
    const decision = await decideRegistration(email, lookup({
      searchCustomers: async () => ({ customers: [] }),
      listRecentPayments: async () => ({
        payments: [
          { id: 'PAY2', status: 'APPROVED', created_at: '2026-04-02T15:00:00.000Z', order_id: 'ORDER2', buyer_email_address: email },
          { id: 'PAY3', status: 'COMPLETED', created_at: '2026-04-02T15:00:00.000Z', order_id: 'ORDER3', buyer_email_address: 'other@safeswimmingschool.com' },
        ],
      }),
      retrieveOrder: async () => {
        throw new Error('should not retrieve an unpaid or other-email payment');
      },
    }), now);
    expect(decision).toEqual({ add: true, reason: 'no-customer' });
  });
});

describe('registration period', () => {
  it('stays on a rolling 365 days until the setting is flipped', () => {
    expect(REGISTRATION_PERIOD).toBe('rolling-365');
    expect(registrationWindowStart(now)).toBe(registrationWindowStart(now, 'rolling-365'));
    expect(registrationWindowStart(now, 'rolling-365')).toBe('2025-06-01T15:00:00.000Z');
    expect(registrationWindowStart(now, 'calendar-year')).toBe('2026-01-01T05:00:00.000Z');
    expect(registrationWindowStart(new Date('2026-01-01T04:59:59.999Z'), 'calendar-year')).toBe('2025-01-01T05:00:00.000Z');
    expect(registrationWindowStart(new Date('2026-01-01T05:00:00.000Z'), 'calendar-year')).toBe('2026-01-01T05:00:00.000Z');
  });

  it('counts a December registration under rolling-365 and not under the calendar year', async () => {
    const closedAt = '2025-12-15T15:00:00.000Z';
    const searchOrders = vi.fn(async (_customerId: string, start: string) => ({
      orders: start <= closedAt ? [{ closed_at: closedAt, line_items: [{ name: '2024 Registration' }] }] : [],
    }));
    const shared = lookup({ searchOrders });
    const rolling = await decideRegistration(email, shared, now, 'rolling-365');
    const calendar = await decideRegistration(email, shared, now, 'calendar-year');
    expect(rolling).toEqual({ add: false, reason: 'already-registered', customerId: 'CUST1' });
    expect(calendar).toEqual({ add: true, reason: 'no-recent-registration', customerId: 'CUST1' });
    expect(searchOrders).toHaveBeenCalledWith('CUST1', '2025-06-01T15:00:00.000Z', undefined);
    expect(searchOrders).toHaveBeenCalledWith('CUST1', '2026-01-01T05:00:00.000Z', undefined);
  });
});

describe('registration lookup errors', () => {
  it('adds the fee and logs the failure without the buyer email', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((message) => { logs.push(String(message)); });
    const decision = await decideRegistration(email, lookup({
      searchCustomers: async () => { throw new Error('square down'); },
    }), now);
    expect(decision).toEqual({ add: true, reason: 'lookup-error' });
    expect(logs.join('\n')).toContain('registration-lookup-error');
    expect(logs.join('\n')).not.toContain(email);
  });
});

describe('/api/book registration', () => {
  const env = { SQUARE_ACCESS_TOKEN: 'token', SQUARE_LOCATION_ID: 'LOC123' };

  function request(option: string, when: string) {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(when));
    return new Request('https://safeswimmingschool.com/api/book', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        option,
        town: 'jupiter',
        day: 'Mon',
        time: '08:00',
        name: 'Pat Parent',
        email,
        phone: '561-236-8260',
        childAge: '4',
        poolAddress: '10 Lake Road',
      }),
    });
  }

  function sentOrder(fetchMock: ReturnType<typeof vi.fn>, nth = 0) {
    const calls = fetchMock.mock.calls.filter((entry) => String(entry[1]?.body ?? '').includes('line_items'));
    return JSON.parse(String(calls[nth][1]?.body)).order;
  }

  it('adds registration to a single lesson and waives it on a package before the cutoff', async () => {
    const fetchMock = vi.fn(async () => Response.json({ payment_link: { url: 'https://square.test/pay' } }));
    vi.stubGlobal('fetch', fetchMock);
    const single = await onBookPost({ request: request('single', '2026-12-31T23:59:59.000-05:00'), env });
    expect(single.status).toBe(200);
    const singleOrder = sentOrder(fetchMock);
    expect(singleOrder.line_items.map((line: { name: string; base_price_money: { amount: number } }) => [line.name, line.base_price_money.amount])).toEqual([
      ['Single lesson', 7500],
      ['Annual Registration', 3500],
    ]);

    const pack = await onBookPost({ request: request('pkg-8', '2026-12-31T23:59:59.000-05:00'), env });
    expect(pack.status).toBe(200);
    const packOrder = sentOrder(fetchMock, 1);
    expect(packOrder.line_items).toHaveLength(1);
    expect(packOrder.line_items[0].base_price_money.amount).toBe(52000);
  });

  it('adds registration to a package once the waiver has ended', async () => {
    const fetchMock = vi.fn(async () => Response.json({ payment_link: { url: 'https://square.test/pay' } }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await onBookPost({ request: request('pkg-12', '2027-01-01T05:00:00.000Z'), env });
    expect(response.status).toBe(200);
    const order = sentOrder(fetchMock);
    expect(order.line_items.map((line: { name: string; base_price_money: { amount: number } }) => [line.name, line.base_price_money.amount])).toEqual([
      ['12 lessons', 72000],
      ['Annual Registration', 3500],
    ]);
  });
});

describe('cart trial credit name', () => {
  it('prices the cart trial as Single lesson so the credit matcher can see it beside registration', () => {
    expect(priceClientLines([{ id: 'trial', quantity: 1 }], true)).toEqual([
      { name: 'Single lesson', quantity: 1, priceCents: 7500 },
      { name: 'Annual Registration', quantity: 1, priceCents: 3500 },
    ]);
    expect(isSingleLessonOrder({
      state: 'OPEN',
      line_items: [
        { name: 'Single lesson', quantity: '1', base_price_money: { amount: 7500 } },
        { name: 'Annual Registration', quantity: '1', base_price_money: { amount: 3500 } },
      ],
    })).toBe(true);
  });
});
