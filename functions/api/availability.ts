import { busyBookSlots, readBusyIntervals, type CalendarEnv } from '../_lib/calendar';

type PagesContext = { request: Request; env: CalendarEnv };

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

export async function onRequestGet({ request, env }: PagesContext): Promise<Response> {
  const url = new URL(request.url);
  const days = Number(url.searchParams.get('days') || '60');
  const span = Number.isInteger(days) && days >= 1 && days <= 160 ? days : 60;
  const from = new Date();
  const to = new Date(from.getTime() + span * 24 * 60 * 60 * 1000);
  const intervals = await readBusyIntervals(env, from.toISOString(), to.toISOString());
  if (!intervals) return json({ source: 'fallback', busy: [] });
  return json({ source: 'calendar', busy: busyBookSlots(intervals) });
}

export async function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.method === 'GET') return onRequestGet(context);
  return json({ error: 'method-not-allowed' }, 405);
}
