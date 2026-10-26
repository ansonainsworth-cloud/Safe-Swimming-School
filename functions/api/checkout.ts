import { normalizeEmail, normalizeName, normalizePhone, normalizeSwimmerCount, priceClientLines, registrationPriceCents, validateClientItems } from '../_lib/prices';
import { buildCreatePaymentLinkBody } from '../_lib/payment-link';
import { allowCheckout } from '../_lib/rate-limit';
import { decideRegistration } from '../_lib/registration';
import { checkoutConfigured, createSquareLookup, squarePost, type SquareEnv } from '../_lib/square';

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

export async function onRequestPost({ request, env }: PagesContext): Promise<Response> {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  if (!allowCheckout(ip)) return json({ error: 'too-many-requests' }, 429);
  if (!checkoutConfigured(env)) return json({ error: 'checkout-unavailable' }, 503);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'invalid-json' }, 400);
  }
  if (!payload || typeof payload !== 'object') return json({ error: 'invalid-json' }, 400);
  const body = payload as { items?: unknown; swimmers?: unknown; buyer?: { name?: unknown; email?: unknown; phone?: unknown } };
  const items = validateClientItems(body.items);
  if (!items.ok) return json({ error: 'invalid-cart' }, 400);
  const swimmers = normalizeSwimmerCount(body.swimmers);
  if (swimmers == null) return json({ error: 'invalid-cart' }, 400);
  const name = normalizeName(body.buyer?.name);
  const email = normalizeEmail(body.buyer?.email);
  const phone = normalizePhone(body.buyer?.phone);
  if (!name || !email || phone === null) return json({ error: 'invalid-buyer' }, 400);

  const decision = await decideRegistration(email, createSquareLookup(env));
  const lines = priceClientLines(items.lines, decision.add, swimmers);
  const registrationCents = decision.add ? registrationPriceCents(swimmers) : undefined;
  const origin = new URL(request.url).origin;
  const paymentBody = buildCreatePaymentLinkBody({
    locationId: env.SQUARE_LOCATION_ID || '',
    idempotencyKey: crypto.randomUUID(),
    redirectUrl: `${origin}/checkout/thanks/`,
    buyerEmail: email,
    buyerName: name,
    buyerPhone: phone,
    customerId: decision.customerId,
    lines,
  });

  let created: unknown;
  try {
    created = await squarePost(env, '/v2/online-checkout/payment-links', paymentBody);
  } catch {
    return json({ error: 'checkout-failed' }, 502);
  }
  const url = (created as { payment_link?: { url?: unknown } })?.payment_link?.url;
  if (typeof url !== 'string' || !url.startsWith('https://')) {
    console.log(JSON.stringify({ checkout: 'payment-link-missing-url' }));
    return json({ error: 'checkout-failed' }, 502);
  }
  return json({
    url,
    registrationAdded: decision.add,
    registrationReason: decision.reason,
    ...(registrationCents != null ? { registrationCents } : {}),
  }, 200);
}

export async function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.method === 'POST') return onRequestPost(context);
  return json({ error: 'method-not-allowed' }, 405);
}
