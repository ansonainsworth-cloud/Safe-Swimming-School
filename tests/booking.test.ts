import { readFileSync } from 'node:fs';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { onRequestPost } from '../functions/api/checkout';
import { onRequestPost as bookingPost } from '../functions/api/booking';
import {
  confirmHold,
  countLesson,
  getStore,
  issueHold,
  moveLessonToEnd,
  rescheduleLesson,
  resetBookingState,
  verifyHold,
  type BookingEnv,
} from '../functions/_lib/booking';
import { resetCalendar } from '../functions/_lib/calendar';
import { sheetValuesPath } from '../functions/_lib/family-registry';
import { lessonsForLines } from '../functions/_lib/prices';
import { resetRateLimit } from '../functions/_lib/rate-limit';
import {
  CANCELLATION_POLICY,
  DEFAULT_EVENT_TITLE,
  eventTitle,
  isCanonicalSlot,
  slotEnd,
  slotStartsOnDate,
} from '../functions/_lib/schedule';

const env = {
  SQUARE_ENVIRONMENT: 'sandbox',
  CF_PAGES_BRANCH: 'booking-payments-live',
} as BookingEnv;

const now = new Date();

afterEach(() => {
  resetRateLimit();
  resetBookingState();
  resetCalendar();
  vi.unstubAllGlobals();
});

function eightMorningSlots(): string[] {
  const slots = [];
  for (let day = 26; day <= 31; day += 1) slots.push(slotStartsOnDate(2026, 10, day)[0]);
  slots.push(slotStartsOnDate(2026, 11, 1)[0]);
  slots.push(slotStartsOnDate(2026, 11, 2)[0]);
  return slots;
}

describe('lesson times', () => {
  it('offers 30-minute starts from 8:00 AM through 6:30 PM ET, including after the clocks change', () => {
    const summer = slotStartsOnDate(2026, 10, 26);
    const winter = slotStartsOnDate(2026, 11, 3);
    expect(summer).toHaveLength(22);
    expect(summer[0]).toBe('2026-10-26T12:00:00.000Z');
    expect(summer[summer.length - 1]).toBe('2026-10-26T22:30:00.000Z');
    expect(winter[0]).toBe('2026-11-03T13:00:00.000Z');
    expect(winter[winter.length - 1]).toBe('2026-11-03T23:30:00.000Z');
    expect(isCanonicalSlot('2026-10-26T12:15:00.000Z')).toBe(false);
    expect(isCanonicalSlot('2026-10-26T23:00:00.000Z')).toBe(false);
    expect(Date.parse(slotEnd(summer[0])) - Date.parse(summer[0])).toBe(30 * 60 * 1000);
  });

  it('counts two back-to-back lessons as two lessons and requires every package lesson', () => {
    expect(lessonsForLines([{ id: 'pkg-8', quantity: 1 }])).toBe(8);
    expect(lessonsForLines([{ id: 'pkg-12', quantity: 1 }])).toBe(12);
    expect(lessonsForLines([{ id: 'pkg-20', quantity: 1 }])).toBe(20);
    expect(lessonsForLines([{ id: 'trial', quantity: 1 }])).toBe(1);
    const pair = [slotStartsOnDate(2026, 11, 16)[0], slotStartsOnDate(2026, 11, 16)[1]];
    expect(Date.parse(pair[1]) - Date.parse(pair[0])).toBe(30 * 60 * 1000);
    expect(pair).toHaveLength(2);
  });
});

describe('holds and preview checkout', () => {
  it('holds the chosen slots and releases them when payment fails', async () => {
    const slots = eightMorningSlots();
    const issued = await issueHold({
      env,
      requestUrl: 'https://preview.example/api/hold',
      email: 'jordan@example.com',
      parent: 'Jordan',
      child: 'Alex',
      itemId: 'pkg-8',
      quantity: 1,
      slots,
      now,
    });
    if ('error' in issued) throw new Error(issued.error);
    expect(await verifyHold(issued.token, 'preview-mock-booking-key', now)).not.toBeNull();
    expect(await verifyHold(issued.token, 'preview-mock-booking-key', new Date(now.getTime() + 16 * 60 * 1000))).toBeNull();
    const again = await issueHold({
      env,
      requestUrl: 'https://preview.example/api/hold',
      email: 'jordan@example.com',
      parent: 'Jordan',
      child: 'Alex',
      itemId: 'pkg-8',
      quantity: 1,
      slots,
      now,
    });
    expect(again).toEqual({ error: 'invalid-slot' });

    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    const request = new Request('https://preview.example/api/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.21' },
      body: JSON.stringify({
        items: [{ id: 'pkg-8', quantity: 1 }],
        buyer: { name: 'Jordan', email: 'jordan@example.com' },
        child: 'Alex',
        holdToken: issued.token,
      }),
    });
    const response = await onRequestPost({
      request,
      env: { ...env, SQUARE_ENVIRONMENT: 'sandbox', SQUARE_ACCESS_TOKEN: 'sandbox-token', SQUARE_LOCATION_ID: 'LOC123', SQUARE_WEBHOOK_SIGNATURE_KEY: 'sig' },
    });
    expect(response.status).toBe(502);
    expect(await getStore().getHold(issued.hold.id)).toBeNull();
  });

  it('saves a mock booking on the preview when Square is not configured, and does not do that on the live host', async () => {
    const slot = slotStartsOnDate(2026, 10, 27)[4];
    const issued = await issueHold({
      env,
      requestUrl: 'https://preview.example/api/hold',
      email: 'jordan@example.com',
      parent: 'Jordan',
      child: 'Alex',
      itemId: 'trial',
      quantity: 1,
      slots: [slot],
      now,
    });
    if ('error' in issued) throw new Error(issued.error);
    const preview = await onRequestPost({
      request: new Request('https://preview.example/api/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.22' },
        body: JSON.stringify({
          items: [{ id: 'trial', quantity: 1 }],
          buyer: { name: 'Jordan', email: 'jordan@example.com' },
          child: 'Alex',
          holdToken: issued.token,
        }),
      }),
      env,
    });
    expect(preview.status).toBe(503);
    const saved = await preview.json() as { confirmationUrl?: string; registrationAdded?: boolean };
    expect(saved.registrationAdded).toBe(true);
    expect(saved.confirmationUrl).toContain('/booking/confirmed/?token=');
    expect(saved.confirmationUrl).toContain('mock=1');

    const liveEnv = { ...env, BOOKING_TOKEN_SECRET: 'live-test-secret' };
    const liveHold = await issueHold({
      env: liveEnv,
      requestUrl: 'https://safeswimmingschool.com/api/hold',
      email: 'jordan@example.com',
      parent: 'Jordan',
      child: 'Alex',
      itemId: 'trial',
      quantity: 1,
      slots: [slotStartsOnDate(2026, 10, 28)[1]],
      now,
    });
    if ('error' in liveHold) throw new Error(liveHold.error);
    const live = await onRequestPost({
      request: new Request('https://safeswimmingschool.com/api/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.23' },
        body: JSON.stringify({
          items: [{ id: 'trial', quantity: 1 }],
          buyer: { name: 'Jordan', email: 'jordan@example.com' },
          child: 'Alex',
          holdToken: liveHold.token,
        }),
      }),
      env: liveEnv,
    });
    const liveBody = await live.json() as { confirmationUrl?: string };
    expect(live.status).toBe(503);
    expect(liveBody.confirmationUrl).toBeUndefined();
    expect(await getStore().getHold(liveHold.hold.id)).toBeNull();
  });

  it('rejects the blocked names and keeps them out of the booking pages', async () => {
    const result = await issueHold({
      env,
      requestUrl: 'https://preview.example/api/hold',
      email: 'jordan@example.com',
      parent: 'Jordan',
      child: 'Asher',
      itemId: 'trial',
      quantity: 1,
      slots: [slotStartsOnDate(2026, 11, 18)[0]],
      now,
    });
    expect(result).toEqual({ error: 'invalid-buyer' });
    const pages = ['src/pages/book.astro', 'src/pages/booking/manage.astro', 'public/js/book.js', 'public/js/manage.js']
      .map((file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8').toLowerCase())
      .join('\n');
    expect(pages).not.toMatch(/asher|gavin|malachi/);
  });
});

describe('cancellation', () => {
  async function packageBooking() {
    const issued = await issueHold({
      env,
      requestUrl: 'https://preview.example/api/hold',
      email: 'jordan@example.com',
      parent: 'Jordan',
      child: 'Alex',
      itemId: 'pkg-8',
      quantity: 1,
      slots: eightMorningSlots(),
      now,
    });
    if ('error' in issued) throw new Error(issued.error);
    return confirmHold({ env, requestUrl: 'https://preview.example/api/checkout', hold: issued.hold, origin: 'https://preview.example', now });
  }

  it('reschedules a lesson that is more than 24 hours away', async () => {
    const saved = await packageBooking();
    const lesson = saved.booking.lessons[0];
    const replacement = slotStartsOnDate(2026, 11, 20)[4];
    const moved = await rescheduleLesson({ env, booking: saved.booking, lessonId: lesson.id, start: replacement, now });
    if ('error' in moved) throw new Error(moved.error);
    expect(moved.booking.lessons.find((item) => item.id === lesson.id)?.start).toBe(replacement);
  });

  it('counts a cancellation inside 24 hours as a lesson taught', async () => {
    const saved = await packageBooking();
    const soon = saved.booking.lessons.find((lesson) => lesson.start === '2026-10-26T12:00:00.000Z');
    expect(soon).toBeTruthy();
    const laterNow = new Date('2026-10-26T00:00:00.000Z');
    const counted = await countLesson(saved.booking, soon!.id, laterNow);
    if ('error' in counted) throw new Error(counted.error);
    expect(counted.booking.lessons.find((lesson) => lesson.id === soon!.id)?.status).toBe('taught');
    const request = new Request('https://preview.example/api/booking', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.31' },
      body: JSON.stringify({ token: saved.token, action: 'count', lessonId: saved.booking.lessons[1].id }),
    });
    const response = await bookingPost({ request, env });
    expect(response.status).toBe(400);
  });

  it('moves a skipped lesson to the same weekday and time after the last lesson', async () => {
    const saved = await packageBooking();
    const first = saved.booking.lessons[0];
    const moved = await moveLessonToEnd({ env, booking: saved.booking, lessonId: first.id, now });
    if ('error' in moved) throw new Error(moved.error);
    expect(moved.start).toBe('2026-11-09T13:00:00.000Z');
    expect(moved.booking.lessons.find((lesson) => lesson.id === first.id)?.start).toBe(moved.start);
  });

  it('uses the supplied cancellation words and title template', () => {
    expect(CANCELLATION_POLICY).toBe("Cancel at least 24 hours ahead to reschedule online. Cancellations within 24 hours count as a lesson taught. If you don't pick a new time, we'll add the lesson to the end of your package.");
    for (const file of ['src/pages/book.astro', 'src/pages/booking/manage.astro', 'src/pages/booking/confirmed.astro']) {
      expect(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')).toContain('{CANCELLATION_POLICY}');
    }
    expect(DEFAULT_EVENT_TITLE).toBe('Swim: [Child] ([Parent])');
    expect(eventTitle(DEFAULT_EVENT_TITLE, 'Alex', 'Jordan')).toBe('Swim: Alex (Jordan)');
    expect(sheetValuesPath()).toContain('1Yk8WRnrqm2zXhLUdAKVNClUv1pq4VQAs2LP6eg08T40');
    expect(sheetValuesPath()).toContain('Tracker');
  });
});
