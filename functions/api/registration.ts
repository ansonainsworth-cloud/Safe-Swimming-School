import { createFamilyRegistry, decideRegistration } from '../_lib/family-registry';
import { normalizeEmail } from '../_lib/prices';
import { allowCheckout } from '../_lib/rate-limit';
import { json } from '../_lib/http';
import type { BookingEnv } from '../_lib/booking';

type PagesContext = { request: Request; env: BookingEnv };

export async function onRequestPost({ request, env }: PagesContext): Promise<Response> {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  if (!allowCheckout(ip)) return json({ error: 'too-many-requests' }, 429);
  let body: { email?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid-json' }, 400);
  }
  const email = normalizeEmail(body.email);
  if (!email) return json({ error: 'invalid-buyer' }, 400);
  const decision = await decideRegistration(email, createFamilyRegistry(env));
  return json(decision);
}

export async function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.method === 'POST') return onRequestPost(context);
  return json({ error: 'method-not-allowed' }, 405);
}
