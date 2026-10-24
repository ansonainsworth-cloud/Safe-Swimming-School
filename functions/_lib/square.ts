import { SQUARE_VERSION } from './prices';
import { customerSearchBody, orderSearchBody, type SquareLookup } from './registration';

export const SQUARE_SANDBOX_ORIGIN = 'https://connect.squareupsandbox.com';
export const SQUARE_PRODUCTION_ORIGIN = 'https://connect.squareup.com';

export type SquareEnvironmentName = 'sandbox' | 'production';

export type SquareEnv = {
  SQUARE_ENVIRONMENT?: string;
  SQUARE_ACCESS_TOKEN?: string;
  SQUARE_LOCATION_ID?: string;
  SQUARE_WEBHOOK_SIGNATURE_KEY?: string;
  CF_PAGES_BRANCH?: string;
};

export type SquareErrorInfo = { status: number; errors: string[] };

export class SquareRequestError extends Error {
  status: number;
  errors: string[];
  constructor(status: number, errors: string[] = []) {
    super(`Square request failed (${status})`);
    this.name = 'SquareRequestError';
    this.status = status;
    this.errors = errors;
  }
}

async function squareErrorInfo(response: Response): Promise<string[]> {
  try {
    const body = await response.json() as { errors?: Array<{ category?: string; code?: string; field?: string; detail?: string }> };
    return (body.errors ?? []).slice(0, 5).map((error) => [error.category, error.code, error.field, error.detail].filter(Boolean).join(' '));
  } catch {
    return [];
  }
}

export function squareEnvironment(env: SquareEnv): SquareEnvironmentName | null {
  if (env.SQUARE_ENVIRONMENT === 'sandbox' || env.SQUARE_ENVIRONMENT === 'production') return env.SQUARE_ENVIRONMENT;
  return null;
}

export function squareOrigin(environment: SquareEnvironmentName): string {
  return environment === 'production' ? SQUARE_PRODUCTION_ORIGIN : SQUARE_SANDBOX_ORIGIN;
}

/** Live host or the production branch. Preview branches stay on the sandbox host. */
export function isProductionSurface(env: SquareEnv, requestUrl: string): boolean {
  if (env.CF_PAGES_BRANCH === 'main') return true;
  try {
    const host = new URL(requestUrl).hostname.toLowerCase();
    return host === 'safeswimmingschool.com' || host === 'www.safeswimmingschool.com';
  } catch {
    return false;
  }
}

export function checkoutConfigured(env: SquareEnv): boolean {
  return squareEnvironment(env) !== null
    && Boolean(env.SQUARE_ACCESS_TOKEN)
    && Boolean(env.SQUARE_LOCATION_ID);
}

/**
 * Sandbox credentials only run off the production branch and off the live host.
 * Production credentials only run on that branch or host.
 * Either mismatch, or a missing variable, fails closed.
 */
export function checkoutAllowed(env: SquareEnv, requestUrl: string): boolean {
  const environment = squareEnvironment(env);
  if (!environment || !env.SQUARE_ACCESS_TOKEN || !env.SQUARE_LOCATION_ID) return false;
  const production = isProductionSurface(env, requestUrl);
  if (environment === 'sandbox') return !production;
  return production;
}

/** Host follows SQUARE_ENVIRONMENT. An unknown environment fails before any request. */
export async function squarePost(env: SquareEnv, path: string, body: unknown, fetchImpl: typeof fetch = fetch): Promise<unknown> {
  const environment = squareEnvironment(env);
  if (!environment) throw new SquareRequestError(503);
  if (!path.startsWith('/v2/') || path.includes('://')) throw new SquareRequestError(400);
  const token = env.SQUARE_ACCESS_TOKEN?.trim();
  if (!token) throw new SquareRequestError(503);
  const response = await fetchImpl(squareOrigin(environment) + path, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Square-Version': SQUARE_VERSION,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new SquareRequestError(response.status, await squareErrorInfo(response));
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
