import { REGISTRATION_NAME } from './prices';

export type RegistrationReason = 'no-customer' | 'no-recent-registration' | 'already-registered' | 'lookup-error';

export type RegistrationDecision = {
  add: boolean;
  reason: RegistrationReason;
  customerId?: string;
};

export type CustomerSearchResult = {
  customers?: Array<{ id?: string }>;
};

export type OrderSearchResult = {
  orders?: Array<{ line_items?: Array<{ name?: string }> }>;
  cursor?: string;
};

export type SquareLookup = {
  searchCustomers(email: string): Promise<CustomerSearchResult>;
  searchOrders(customerId: string, closedAfter: string, cursor?: string): Promise<OrderSearchResult>;
};

export function closedAfterIso(now: Date): string {
  return new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString();
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

export function orderSearchBody(locationId: string, customerId: string, closedAfter: string, cursor?: string) {
  return {
    location_ids: [locationId],
    limit: 100,
    ...(cursor ? { cursor } : {}),
    query: {
      filter: {
        customer_filter: { customer_ids: [customerId] },
        state_filter: { states: ['COMPLETED'] },
        date_time_filter: {
          closed_at: { start_at: closedAfter },
        },
      },
    },
  };
}

function orderHasRegistration(order: { line_items?: Array<{ name?: string }> }): boolean {
  return (order.line_items ?? []).some((line) => line.name === REGISTRATION_NAME);
}

export async function decideRegistration(email: string, lookup: SquareLookup, now = new Date()): Promise<RegistrationDecision> {
  const closedAfter = closedAfterIso(now);
  let customers: CustomerSearchResult;
  try {
    customers = await lookup.searchCustomers(email);
  } catch {
    return { add: true, reason: 'lookup-error' };
  }
  const ids = (customers.customers ?? []).map((customer) => customer.id).filter((id): id is string => Boolean(id));
  if (ids.length === 0) return { add: true, reason: 'no-customer' };

  for (const customerId of ids) {
    let cursor: string | undefined;
    let page = 0;
    try {
      do {
        const result = await lookup.searchOrders(customerId, closedAfter, cursor);
        page += 1;
        if ((result.orders ?? []).some(orderHasRegistration)) {
          return { add: false, reason: 'already-registered', customerId };
        }
        cursor = result.cursor || undefined;
      } while (cursor && page < 10);
    } catch {
      return { add: true, reason: 'lookup-error' };
    }
  }
  return { add: true, reason: 'no-recent-registration', customerId: ids[0] };
}
