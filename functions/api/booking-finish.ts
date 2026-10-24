import { bookingSecret, confirmHold, verifyHold, type BookingEnv } from '../_lib/booking';
import { json } from '../_lib/http';

type PagesContext = { request: Request; env: BookingEnv };

export async function onRequestPost({ request, env }: PagesContext): Promise<Response> {
  const secret = bookingSecret(env, request.url);
  const cookie = request.headers.get('cookie') || '';
  const match = cookie.match(/(?:^|; )sss_hold=([^;]+)/);
  if (!secret || !match) return json({ error: 'no-hold' }, 400);
  const token = decodeURIComponent(match[1]);
  const hold = await verifyHold(token, secret);
  if (!hold) return json({ error: 'invalid-hold' }, 400);
  const saved = await confirmHold({ env, requestUrl: request.url, hold, origin: new URL(request.url).origin });
  return json({ confirmationUrl: saved.confirmationUrl }, 200, { 'set-cookie': 'sss_hold=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax' });
}

export async function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.method === 'POST') return onRequestPost(context);
  return json({ error: 'method-not-allowed' }, 405);
}
