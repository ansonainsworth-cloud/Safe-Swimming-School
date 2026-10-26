import { allowHealth } from '../_lib/rate-limit';
import { squareApiOrigin, squareRequest, SquareRequestError, type SquareEnv } from '../_lib/square';

type PagesContext = { request: Request; env: SquareEnv };

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function envConfigured(env: SquareEnv): boolean {
  return Boolean(env.SQUARE_ENV && env.SQUARE_ACCESS_TOKEN && env.SQUARE_LOCATION_ID);
}

export async function onRequestGet({ request, env }: PagesContext): Promise<Response> {
  const envSet = envConfigured(env);
  const originChosen = squareApiOrigin(env.SQUARE_ENV) !== null;
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  if (!allowHealth(ip)) return json({ error: 'too-many-requests' }, 429);

  let locationStatus = 0;
  const locationId = env.SQUARE_LOCATION_ID || '';
  if (originChosen && env.SQUARE_ACCESS_TOKEN && /^[A-Za-z0-9]+$/.test(locationId)) {
    try {
      await squareRequest(env, 'GET', `/v2/locations/${locationId}`, undefined);
      locationStatus = 200;
    } catch (error) {
      locationStatus = error instanceof SquareRequestError ? error.status : 0;
    }
  }
  return json({ envSet, originChosen, locationStatus }, 200);
}

export async function onRequest(context: PagesContext): Promise<Response> {
  try {
    if (context.request.method === 'GET') return await onRequestGet(context);
    return json({ error: 'method-not-allowed' }, 405);
  } catch {
    return json({ envSet: false, originChosen: false, locationStatus: 0 }, 200);
  }
}
