/**
 * How long a paid registration keeps the fee off the next checkout.
 * Flip this to 'calendar-year' to count only registrations paid on or after
 * Jan 1 00:00 America/New_York of the current year.
 */
export const REGISTRATION_PERIOD: 'rolling-365' | 'calendar-year' = 'rolling-365';

export type RegistrationReason = 'no-customer' | 'no-recent-registration' | 'already-registered' | 'lookup-error';

export type RegistrationDecision = {
  add: boolean;
  reason: RegistrationReason;
  customerId?: string;
};

export type CustomerSearchResult = {
  customers?: Array<{ id?: string }>;
};

export type RegistrationOrder = {
  id?: string;
  state?: string;
  closed_at?: string;
  created_at?: string;
  updated_at?: string;
  customer_id?: string;
  net_amount_due_money?: { amount?: number };
  total_money?: { amount?: number };
  tenders?: Array<{ amount_money?: { amount?: number } }>;
  line_items?: Array<{ name?: string }>;
  fulfillments?: Array<{
    pickup_details?: { recipient?: { email_address?: string } };
    shipment_details?: { recipient?: { email_address?: string } };
  }>;
};

export type OrderSearchResult = {
  orders?: RegistrationOrder[];
  cursor?: string;
};

export type PaymentListResult = {
  payments?: Array<{
    id?: string;
    status?: string;
    created_at?: string;
    customer_id?: string;
    order_id?: string;
    buyer_email_address?: string;
    amount_money?: { amount?: number; currency?: string };
    total_money?: { amount?: number; currency?: string };
  }>;
  cursor?: string;
};

export type SquareLookup = {
  searchCustomers(email: string): Promise<CustomerSearchResult>;
  searchOrders(customerId: string, closedAfter: string, cursor?: string): Promise<OrderSearchResult>;
  searchOpenOrders?(customerId: string, cursor?: string): Promise<OrderSearchResult>;
  searchAllOrders?(customerId: string, cursor?: string): Promise<OrderSearchResult>;
  listPayments?(cursor?: string): Promise<PaymentListResult>;
  listRecentPayments?(beginTime: string, cursor?: string): Promise<PaymentListResult>;
  retrieveOrder?(orderId: string): Promise<{ order?: { id?: string; state?: string; line_items?: Array<{ name?: string; quantity?: string; base_price_money?: { amount?: number }; gross_sales_money?: { amount?: number }; total_money?: { amount?: number } }> } }>;
};

export function closedAfterIso(now: Date): string {
  return new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString();
}

/** Jan 1 00:00 America/New_York is 05:00 UTC. That morning is always Eastern Standard Time. */
export function registrationWindowStart(now: Date, period: typeof REGISTRATION_PERIOD = REGISTRATION_PERIOD): string {
  if (period === 'calendar-year') {
    const year = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric' }).format(now);
    return `${year}-01-01T05:00:00.000Z`;
  }
  return closedAfterIso(now);
}

export function customerSearchBody(email: string) {
  return {
    limit: 10,
    query: {
      filter: {
        email_address: { exact: email },
      },
    },
  };
}

export function orderSearchBody(locationId: string, customerId: string, closedAfter?: string, cursor?: string) {
  const filter: {
    customer_filter: { customer_ids: string[] };
    state_filter: { states: string[] };
    date_time_filter?: { closed_at: { start_at: string } };
  } = {
    customer_filter: { customer_ids: [customerId] },
    state_filter: { states: ['COMPLETED'] },
  };
  if (closedAfter) filter.date_time_filter = { closed_at: { start_at: closedAfter } };
  return {
    location_ids: [locationId],
    limit: 100,
    ...(cursor ? { cursor } : {}),
    query: { filter },
  };
}

/** Completed orders with no date cutoff, so an older trial is still visible. */
export function completedOrderSearchBody(locationId: string, customerId: string, cursor?: string) {
  return orderSearchBody(locationId, customerId, undefined, cursor);
}

export function openOrderSearchBody(locationId: string, customerId: string, cursor?: string) {
  return {
    location_ids: [locationId],
    limit: 100,
    ...(cursor ? { cursor } : {}),
    query: {
      filter: {
        customer_filter: { customer_ids: [customerId] },
        state_filter: { states: ['OPEN'] },
      },
    },
  };
}

/** A registration the buyer paid. Waived lines and gift-certificate lines do not count. */
export function lineCountsAsRegistration(name: string | undefined): boolean {
  if (!name || !/registration/i.test(name)) return false;
  if (/waived|waive/i.test(name)) return false;
  if (/gift/i.test(name)) return false;
  if (/plus registration/i.test(name)) return false;
  return true;
}

function orderHasRegistration(order: { line_items?: Array<{ name?: string }> }): boolean {
  return (order.line_items ?? []).some((line) => lineCountsAsRegistration(line.name));
}

/** COMPLETED orders are paid. An OPEN order counts when nothing is still due, tenders cover the total, or a COMPLETED payment points at it. */
export function orderIsSettled(order: RegistrationOrder, linkedPaymentCompleted = false): boolean {
  if (linkedPaymentCompleted || order.state === 'COMPLETED') return true;
  if (order.state !== 'OPEN') return false;
  if (order.net_amount_due_money?.amount === 0) return true;
  const total = order.total_money?.amount;
  const tendered = (order.tenders ?? []).reduce((sum, tender) => sum + (tender.amount_money?.amount ?? 0), 0);
  return typeof total === 'number' && total > 0 && tendered >= total;
}

function paidAt(order: RegistrationOrder, paymentCreatedAt?: string): string {
  return order.closed_at || paymentCreatedAt || order.updated_at || order.created_at || '';
}

function onOrAfter(iso: string, windowStart: string): boolean {
  return Boolean(iso) && iso >= windowStart;
}

function fulfillmentEmails(order: RegistrationOrder): string[] {
  const emails: string[] = [];
  for (const fulfillment of order.fulfillments ?? []) {
    const pickup = fulfillment.pickup_details?.recipient?.email_address;
    const shipment = fulfillment.shipment_details?.recipient?.email_address;
    if (pickup) emails.push(pickup.toLowerCase());
    if (shipment) emails.push(shipment.toLowerCase());
  }
  return emails;
}

function logLookupError(): void {
  console.log(JSON.stringify({ event: 'registration-lookup-error' }));
}

async function pageOrders(
  load: (cursor?: string) => Promise<OrderSearchResult>,
  keep: (order: RegistrationOrder) => boolean,
): Promise<boolean> {
  let cursor: string | undefined;
  let page = 0;
  do {
    const result = await load(cursor);
    page += 1;
    if ((result.orders ?? []).some(keep)) return true;
    cursor = result.cursor || undefined;
  } while (cursor && page < 10);
  return false;
}

export async function decideRegistration(
  email: string,
  lookup: SquareLookup,
  now = new Date(),
  period: typeof REGISTRATION_PERIOD = REGISTRATION_PERIOD,
): Promise<RegistrationDecision> {
  const windowStart = registrationWindowStart(now, period);
  const normalized = email.trim().toLowerCase();
  try {
    const customers = await lookup.searchCustomers(normalized);
    if (!customers || typeof customers !== 'object' || Array.isArray(customers)) {
      logLookupError();
      return { add: true, reason: 'lookup-error' };
    }
    const ids = (customers.customers ?? []).map((customer) => customer.id).filter((id): id is string => Boolean(id));

    for (const customerId of ids) {
      const completed = await pageOrders(
        (cursor) => lookup.searchOrders(customerId, windowStart, cursor),
        orderHasRegistration,
      );
      if (completed) return { add: false, reason: 'already-registered', customerId };
      if (lookup.searchOpenOrders) {
        const openPaid = await pageOrders(
          (cursor) => lookup.searchOpenOrders!(customerId, cursor),
          (order) => orderHasRegistration(order) && orderIsSettled(order) && onOrAfter(paidAt(order), windowStart),
        );
        if (openPaid) return { add: false, reason: 'already-registered', customerId };
      }
    }

    if (lookup.listRecentPayments && lookup.retrieveOrder) {
      let cursor: string | undefined;
      let page = 0;
      do {
        const listed = await lookup.listRecentPayments(windowStart, cursor);
        page += 1;
        for (const payment of listed.payments ?? []) {
          if (payment.status !== 'COMPLETED' || !payment.order_id) continue;
          const paymentEmail = (payment.buyer_email_address || '').toLowerCase();
          if (paymentEmail && paymentEmail !== normalized) continue;
          const retrieved = await lookup.retrieveOrder(payment.order_id);
          const order = retrieved.order as RegistrationOrder | undefined;
          if (!order || !orderHasRegistration(order) || !orderIsSettled(order, true)) continue;
          const emails = [paymentEmail, ...fulfillmentEmails(order)].filter(Boolean);
          if (!emails.includes(normalized)) continue;
          if (!onOrAfter(paidAt(order, payment.created_at), windowStart)) continue;
          return { add: false, reason: 'already-registered', customerId: order.customer_id || payment.customer_id || ids[0] };
        }
        cursor = listed.cursor || undefined;
      } while (cursor && page < 10);
    }

    if (ids.length === 0) return { add: true, reason: 'no-customer' };
    return { add: true, reason: 'no-recent-registration', customerId: ids[0] };
  } catch {
    logLookupError();
    return { add: true, reason: 'lookup-error' };
  }
}
