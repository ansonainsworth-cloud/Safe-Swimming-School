import { listSlots, type BookingEnv } from '../_lib/booking';
import { CANCELLATION_POLICY, serviceArea } from '../_lib/schedule';
import { json } from '../_lib/http';

type PagesContext = { request: Request; env: BookingEnv };

export async function onRequestGet({ request, env }: PagesContext): Promise<Response> {
  const url = new URL(request.url);
  const days = Number(url.searchParams.get('days') || '14');
  const span = Number.isInteger(days) && days >= 1 && days <= 160 ? days : 14;
  const address = url.searchParams.get('address') || undefined;
  const area = serviceArea(url.searchParams.get('area'));
  const slots = await listSlots(env, new Date(), span, address && address.length <= 200 ? address : undefined, area);
  return json({ timeZone: 'America/New_York', policy: CANCELLATION_POLICY, area, slots });
}

export async function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.method === 'GET') return onRequestGet(context);
  return json({ error: 'method-not-allowed' }, 405);
}
