import { countLesson, moveLessonToEnd, readBooking, rescheduleLesson, signToken, syncBooking, bookingSecret, CANCELLATION_POLICY, MAIL_FROM, type BookingEnv } from '../_lib/booking';
import { allowCheckout } from '../_lib/rate-limit';
import { json } from '../_lib/http';
import { formatSlot } from '../_lib/schedule';

type PagesContext = { request: Request; env: BookingEnv };

function present(booking: { lessons: Array<{ id: string; start: string; end: string; status: string }> }, now = new Date()) {
  return {
    ...booking,
    lessons: booking.lessons.map((lesson) => ({
      ...lesson,
      label: formatSlot(lesson.start),
      reschedule: lesson.status === 'scheduled' && Date.parse(lesson.start) - now.getTime() >= 24 * 60 * 60 * 1000,
    })),
  };
}

export async function onRequestGet({ request, env }: PagesContext): Promise<Response> {
  const secret = bookingSecret(env, request.url);
  if (!secret) return json({ error: 'unavailable' }, 503);
  const token = new URL(request.url).searchParams.get('token') || '';
  const booking = await readBooking(token, secret);
  if (!booking) return json({ error: 'invalid-token' }, 400);
  return json({ booking: present(booking), policy: CANCELLATION_POLICY, from: MAIL_FROM, token });
}

export async function onRequestPost({ request, env }: PagesContext): Promise<Response> {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  if (!allowCheckout(ip)) return json({ error: 'too-many-requests' }, 429);
  const secret = bookingSecret(env, request.url);
  if (!secret) return json({ error: 'unavailable' }, 503);
  let body: { token?: unknown; action?: unknown; lessonId?: unknown; start?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid-json' }, 400);
  }
  if (typeof body.token !== 'string' || typeof body.lessonId !== 'string' || typeof body.action !== 'string') {
    return json({ error: 'invalid-json' }, 400);
  }
  const booking = await readBooking(body.token, secret);
  if (!booking) return json({ error: 'invalid-token' }, 400);
  const now = new Date();
  let result: { booking: typeof booking } | { error: string };
  if (body.action === 'reschedule' && typeof body.start === 'string') {
    result = await rescheduleLesson({ env, booking, lessonId: body.lessonId, start: body.start, now });
  } else if (body.action === 'count') {
    result = await countLesson(booking, body.lessonId, now);
  } else if (body.action === 'skip') {
    result = await moveLessonToEnd({ env, booking, lessonId: body.lessonId, now });
  } else {
    return json({ error: 'invalid-action' }, 400);
  }
  if ('error' in result) return json({ error: result.error }, 400);
  if (body.action === 'count') await syncBooking(env, result.booking);
  const token = await signToken(result.booking, secret);
  const origin = new URL(request.url).origin;
  return json({
    token,
    booking: present(result.booking, now),
    policy: CANCELLATION_POLICY,
    manageUrl: `${origin}/booking/manage/?token=${encodeURIComponent(token)}`,
  });
}

export async function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.method === 'GET') return onRequestGet(context);
  if (context.request.method === 'POST') return onRequestPost(context);
  return json({ error: 'method-not-allowed' }, 405);
}
