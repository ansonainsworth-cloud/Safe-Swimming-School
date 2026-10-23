import { SQUARE_SANDBOX_ORIGIN, SQUARE_VERSION } from './prices';
import { customerSearchBody, orderSearchBody, type SquareLookup } from './registration';

export type SquareEnv = {
  SQUARE_ENV?: string;
  SQUARE_ACCESS_TOKEN?: string;
  SQUARE_LOCATION_ID?: string;
  SQUARE_WEBHOOK_SIGNATURE_KEY?: string;
};

export class SquareRequestError extends Error {
  status: number;
  constructor(status: number) {
    super(`Square request failed (${status})`);
    this.name = 'SquareRequestError';
    this.status = status;
  }
}

export function checkoutConfigured(env: SquareEnv): boolean {
  return env.SQUARE_ENV === 'sandbox'
    && Boolean(env.SQUARE_ACCESS_TOKEN)
    && Boolean(env.SQUARE_LOCATION_ID)
    && Boolean(env.SQUARE_WEBHOOK_SIGNATURE_KEY);
}

/** Sandbox only. The host is a constant so a production token cannot redirect this call. */
export async function squarePost(env: SquareEnv, path: string, body: unknown, fetchImpl: typeof fetch = fetch): Promise<unknown> {
  if (env.SQUARE_ENV !== 'sandbox') throw new SquareRequestError(503);
  if (!path.startsWith('/v2/') || path.includes('://')) throw new SquareRequestError(400);
  const token = env.SQUARE_ACCESS_TOKEN;
  if (!token) throw new SquareRequestError(503);
  const response = await fetchImpl(SQUARE_SANDBOX_ORIGIN + path, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Square-Version': SQUARE_VERSION,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new SquareRequestError(response.status);
  return response.json();
}

export function createSquareLookup(env: SquareEnv, fetchImpl: typeof fetch = fetch): SquareLookup {
  const locationId = env.SQUARE_LOCATION_ID || '';
  return {
    searchCustomers(email) {
      return squarePost(env, '/v2/customers/search', customerSearchBody(email), fetchImpl) as Promise<{ customers?: { id?: string }[] }>;
    },
    searchOrders(customerId, closedAfter, cursor) {
      return squarePost(env, '/v2/orders/search', orderSearchBody(locationId, customerId, closedAfter, cursor), fetchImpl) as Promise<{
        orders?: { line_items?: { name?: string }[] }[];
        cursor?: string;
      }>;
    },
  };
}
