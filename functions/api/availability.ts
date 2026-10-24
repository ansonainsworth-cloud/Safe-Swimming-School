import { listSlots, type BookingEnv } from '../_lib/booking';
import { CANCELLATION_POLICY } from '../_lib/schedule';
import { json } from '../_lib/http';

type PagesContext = { request: Request; env: BookingEnv };

export async function onRequestGet({ request, env }: PagesContext): Promise<Response> {
  const days = Number(new URL(request.url).searchParams.get('days') || '14');
  const span = Number.isInteger(days) && days >= 1 && days <= 21 ? days : 14;
  const slots = await listSlots(env, new Date(), span);
  return json({ timeZone: 'America/New_York', policy: CANCELLATION_POLICY, slots });
}

export async function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.method === 'GET') return onRequestGet(context);
  return json({ error: 'method-not-allowed' }, 405);
}
