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

