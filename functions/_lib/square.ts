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
  if (/^\/v2\/locations\/[^/]+$/.test(path)) return 'location';
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

/** Square JSON is small. Refuse anything large enough to exhaust the isolate. */
const MAX_SQUARE_BODY = 262144;

function logSquareFailure(step: string, status: number, body: unknown): void {
  const payload = squareFailureLog(step, status, body);
  try {
    console.log(JSON.stringify(payload));
  } catch {
    try {
      console.log(JSON.stringify({ step, status, errors: [] }));
    } catch {
      // A log failure must not become the Pages "error code: 502" page.
    }
  }
}

/**
 * Read the body as text. response.json() throws on the plain-text proxy body
 * "error code: 502", and a compressed body that the Workers runtime cannot
 * decode can fail the invocation even inside catch. Callers send
 * Accept-Encoding: identity so the body is uncompressed JSON.
 */
async function readSquareBody(response: Response): Promise<unknown> {
  try {
    const text = await response.text();
    if (!text || text.length > MAX_SQUARE_BODY) return null;
    return JSON.parse(text) as unknown;
  } catch {
    try {
      await response.body?.cancel();
    } catch {
      // The stream already failed.
    }
    return null;
  }
}

/** Host is one of two constants chosen by SQUARE_ENV. Callers cannot supply a URL. */
export async function squareRequest(
  env: SquareEnv,
  method: 'GET' | 'POST',
  path: string,
  body: unknown,
  fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
  const origin = squareApiOrigin(env.SQUARE_ENV);
  if (!origin) throw new SquareRequestError(503);
  if (!path.startsWith('/v2/') || path.includes('://') || path.includes('..')) throw new SquareRequestError(400);
  const token = env.SQUARE_ACCESS_TOKEN;
  if (!token) throw new SquareRequestError(503);
  const step = stepForSquarePath(path);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'Accept-Encoding': 'identity',
    'Square-Version': SQUARE_VERSION,
  };
  if (method === 'POST') headers['Content-Type'] = 'application/json';
  const payload = method === 'POST' ? JSON.stringify(body) : undefined;

  let response: Response;
  try {
    response = await fetchImpl(origin + path, {
      method,
      headers,
      redirect: 'manual',
      cache: 'no-store',
      ...(payload !== undefined ? { body: payload } : {}),
    });
  } catch {
    logSquareFailure(step, 0, null);
    throw new SquareRequestError(0);
  }

  const parsed = await readSquareBody(response);
  if (!response.ok || parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    logSquareFailure(step, response.status, parsed);
    throw new SquareRequestError(response.status);
  }
  return parsed;
}

export async function squarePost(env: SquareEnv, path: string, body: unknown, fetchImpl: typeof fetch = fetch): Promise<unknown> {
  return squareRequest(env, 'POST', path, body, fetchImpl);
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
