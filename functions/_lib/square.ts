import { SQUARE_SANDBOX_ORIGIN, SQUARE_VERSION } from './prices';
import { customerSearchBody, orderSearchBody, type SquareLookup } from './registration';

/** Production Connect API. Selected only when SQUARE_ENV is exactly "production". */
export const SQUARE_PRODUCTION_ORIGIN = 'https://connect.squareup.com';

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

export function squareApiOrigin(squareEnv: string | undefined): string | null {
  if (squareEnv === 'sandbox') return SQUARE_SANDBOX_ORIGIN;
  if (squareEnv === 'production') return SQUARE_PRODUCTION_ORIGIN;
  return null;
}

export function checkoutConfigured(env: SquareEnv): boolean {
  return squareApiOrigin(env.SQUARE_ENV) !== null
    && Boolean(env.SQUARE_ACCESS_TOKEN)
    && Boolean(env.SQUARE_LOCATION_ID)
    && Boolean(env.SQUARE_WEBHOOK_SIGNATURE_KEY);
}

export function stepForSquarePath(path: string): string {
  if (path.endsWith('/customers/search')) return 'customers-search';
  if (path.endsWith('/orders/search')) return 'orders-search';
  if (path.endsWith('/payment-links')) return 'payment-link';
  return 'square';
}

/** Square error fields only. detail can contain buyer email or phone, so it is dropped. */
export function squareFailureLog(step: string, status: number, body: unknown): {
  step: string;
  status: number;
  errors: Array<{ code?: string; category?: string; field?: string }>;
} {
  const raw = body && typeof body === 'object' && Array.isArray((body as { errors?: unknown }).errors)
    ? (body as { errors: unknown[] }).errors
    : [];
  const errors: Array<{ code?: string; category?: string; field?: string }> = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const record = item as { code?: unknown; category?: unknown; field?: unknown };
    const entry: { code?: string; category?: string; field?: string } = {};
    if (typeof record.code === 'string') entry.code = record.code;
    if (typeof record.category === 'string') entry.category = record.category;
    if (typeof record.field === 'string') entry.field = record.field;
    if (entry.code || entry.category || entry.field) errors.push(entry);
  }
  return { step, status, errors };
}

/** Host is one of two constants chosen by SQUARE_ENV. Callers cannot supply a URL. */
export async function squarePost(env: SquareEnv, path: string, body: unknown, fetchImpl: typeof fetch = fetch): Promise<unknown> {
  const origin = squareApiOrigin(env.SQUARE_ENV);
  if (!origin) throw new SquareRequestError(503);
  if (!path.startsWith('/v2/') || path.includes('://')) throw new SquareRequestError(400);
  const token = env.SQUARE_ACCESS_TOKEN;
  if (!token) throw new SquareRequestError(503);
  const response = await fetchImpl(origin + path, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Square-Version': SQUARE_VERSION,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    let parsed: unknown = null;
    try {
      parsed = await response.json();
    } catch {
      parsed = null;
    }
    console.log(JSON.stringify(squareFailureLog(stepForSquarePath(path), response.status, parsed)));
    throw new SquareRequestError(response.status);
  }
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
