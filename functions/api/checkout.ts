import { bookingSecret, confirmHold, releaseHold, verifyHold, type BookingEnv } from '../_lib/booking';
import { createFamilyRegistry, decideRegistration } from '../_lib/family-registry';
import { json } from '../_lib/http';
import { buildCreatePaymentLinkBody } from '../_lib/payment-link';
import { lessonsForLines, normalizeEmail, normalizeName, normalizePhone, priceClientLines, validateClientItems } from '../_lib/prices';
import { allowCheckout } from '../_lib/rate-limit';
import { checkoutAllowed, isProductionSurface, squarePost, SquareRequestError } from '../_lib/square';

type PagesContext = { request: Request; env: BookingEnv };

export async function onRequestPost({ request, env }: PagesContext): Promise<Response> {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  if (!allowCheckout(ip)) return json({ error: 'too-many-requests' }, 429);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'invalid-json' }, 400);
  }
  if (!payload || typeof payload !== 'object') return json({ error: 'invalid-json' }, 400);
  const body = payload as {
    items?: unknown;
    buyer?: { name?: unknown; email?: unknown; phone?: unknown };
    child?: unknown;
    holdToken?: unknown;
  };
  const items = validateClientItems(body.items);
  if (!items.ok) return json({ error: 'invalid-cart' }, 400);
  const name = normalizeName(body.buyer?.name);
  const email = normalizeEmail(body.buyer?.email);
  const phone = normalizePhone(body.buyer?.phone);
  const child = normalizeName(body.child);
  if (!name || !email || phone === null) return json({ error: 'invalid-buyer' }, 400);

  const decision = await decideRegistration(email, createFamilyRegistry(env));
  const needed = lessonsForLines(items.lines);
  const secret = bookingSecret(env, request.url);
  const hold = secret && typeof body.holdToken === 'string' ? await verifyHold(body.holdToken, secret) : null;
  const holdMatches = Boolean(hold && child && hold.email === email && hold.parent === name && hold.child === child && hold.slots.length === needed);
  const origin = new URL(request.url).origin;

  if (!checkoutAllowed(env, request.url)) {
    if (hold && holdMatches && !isProductionSurface(env, request.url)) {
      const saved = await confirmHold({ env, requestUrl: request.url, hold, origin });
      return json({
        error: 'checkout-unavailable',
        confirmationUrl: `${saved.confirmationUrl}&mock=1`,
        manageUrl: saved.manageUrl,
        registrationAdded: decision.add,
        registrationReason: decision.reason,
      }, 503);
    }
    if (hold) await releaseHold(hold.id);
    return json({ error: 'checkout-unavailable', registrationAdded: decision.add, registrationReason: decision.reason }, 503);
  }

  if (needed > 0 && !holdMatches) {
    if (hold) await releaseHold(hold.id);
    return json({ error: 'invalid-hold' }, 400);
  }

  const lines = priceClientLines(items.lines, decision.add);
  const paymentBody = buildCreatePaymentLinkBody({
    locationId: env.SQUARE_LOCATION_ID || '',
    idempotencyKey: crypto.randomUUID(),
    redirectUrl: `${origin}/checkout/thanks/`,
    buyerEmail: email,
    buyerName: name,
    buyerPhone: phone,
    lines,
  });

  let created: unknown;
  try {
    created = await squarePost(env, '/v2/online-checkout/payment-links', paymentBody);
  } catch (error) {
    if (hold) await releaseHold(hold.id);
    const squareStatus = error instanceof SquareRequestError ? error.status : 0;
    const squareErrors = error instanceof SquareRequestError ? error.errors : [];
    console.log(JSON.stringify({ checkout: 'payment-link-failed', squareStatus, squareErrors }));
    return json({ error: 'checkout-failed' }, 502);
  }
  const url = (created as { payment_link?: { url?: unknown } })?.payment_link?.url;
  if (typeof url !== 'string' || !url.startsWith('https://')) {
    if (hold) await releaseHold(hold.id);
    console.log(JSON.stringify({ checkout: 'payment-link-missing-url' }));
    return json({ error: 'checkout-failed' }, 502);
  }
  const extra: Record<string, string> = {};
  if (hold && typeof body.holdToken === 'string') {
    extra['set-cookie'] = `sss_hold=${encodeURIComponent(body.holdToken)}; Path=/; Max-Age=900; HttpOnly; Secure; SameSite=Lax`;
  }
  return json({
    url,
    registrationAdded: decision.add,
    registrationReason: decision.reason,
  }, 200, extra);
}

export async function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.method === 'POST') return onRequestPost(context);
  return json({ error: 'method-not-allowed' }, 405);
}
