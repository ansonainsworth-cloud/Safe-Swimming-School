import { issueHold, type BookingEnv } from '../_lib/booking';
import { allowCheckout } from '../_lib/rate-limit';
import { json } from '../_lib/http';

type PagesContext = { request: Request; env: BookingEnv };

export async function onRequestPost({ request, env }: PagesContext): Promise<Response> {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  if (!allowCheckout(ip)) return json({ error: 'too-many-requests' }, 429);
  let body: {
    email?: unknown;
    parent?: unknown;
    phone?: unknown;
    child?: unknown;
    childDob?: unknown;
    sibling?: unknown;
    siblingDob?: unknown;
    poolAddress?: unknown;
    itemId?: unknown;
    quantity?: unknown;
    slots?: unknown;
    area?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid-json' }, 400);
  }
  const slots = Array.isArray(body.slots) ? body.slots.filter((slot): slot is string => typeof slot === 'string') : [];
  const result = await issueHold({
    env,
    requestUrl: request.url,
    email: typeof body.email === 'string' ? body.email : '',
    parent: typeof body.parent === 'string' ? body.parent : '',
    phone: typeof body.phone === 'string' ? body.phone : '',
    child: typeof body.child === 'string' ? body.child : '',
    childDob: typeof body.childDob === 'string' ? body.childDob : '',
    sibling: typeof body.sibling === 'string' ? body.sibling : '',
    siblingDob: typeof body.siblingDob === 'string' ? body.siblingDob : '',
    poolAddress: typeof body.poolAddress === 'string' ? body.poolAddress : '',
    itemId: typeof body.itemId === 'string' ? body.itemId : '',
    quantity: typeof body.quantity === 'number' ? body.quantity : 1,
    slots,
    area: typeof body.area === 'string' ? body.area : '',
  });
  if ('error' in result) return json({ error: result.error }, result.error === 'unavailable' ? 503 : 400);
  return json({ holdToken: result.token, expiresAt: result.hold.expiresAt, slots: result.hold.slots });
}

export async function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.method === 'POST') return onRequestPost(context);
  return json({ error: 'method-not-allowed' }, 405);
}
