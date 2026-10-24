import { readFileSync } from 'node:fs';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { onRequestPost } from '../functions/api/checkout';
import { onRequestPost as bookingPost } from '../functions/api/booking';
import {
  confirmHold,
  countLesson,
  getStore,
  issueHold,
  listSlots,
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
import { getCalendar, MockCalendar } from '../functions/_lib/calendar';
import { googleEventInsert, isPackageSchedule, lessonEventTitle, resetNotices, sentNotices } from '../functions/_lib/lesson-events';
import {
  CANCELLATION_POLICY,
  etParts,
  isCanonicalSlot,
  slotEnd,
  slotStartsOnDate,
  zonedTimeToUtc,
} from '../functions/_lib/schedule';

const env = {
  SQUARE_ENVIRONMENT: 'sandbox',
  CF_PAGES_BRANCH: 'booking-payments-live',
} as BookingEnv;

const now = new Date();

const family = {
  phone: '561-555-0134',
  childDob: '2022-06-15',
  poolAddress: '100 Example Lane, Jupiter, FL',
};

afterEach(() => {
  resetRateLimit();
  resetBookingState();
  resetCalendar();
  resetNotices();
  vi.unstubAllGlobals();
});

function eightMondaySlots(): string[] {
  const slots: string[] = [];
  let year = 2026;
  let month = 10;
  let day = 26;
  for (let week = 0; week < 8; week += 1) {
    const start = slotStartsOnDate(year, month, day).find((iso) => {
      const parts = etParts(new Date(iso));
      return parts.hour === 8 && parts.minute === 0;
    });
    if (!start) throw new Error('missing Monday 8:00');
    slots.push(start);
    const next = etParts(new Date(zonedTimeToUtc(year, month, day, 12, 0).getTime() + 7 * 24 * 60 * 60 * 1000));
    year = next.year;
    month = next.month;
    day = next.day;
  }
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
    const slots = eightMondaySlots();
    const issued = await issueHold({
      env,
      requestUrl: 'https://preview.example/api/hold',
      email: 'jordan@example.com',
      parent: 'Jordan',
      child: 'Alex',
      ...family,
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
      ...family,
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
      ...family,
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
      ...family,
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
      ...family,
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
      ...family,
      itemId: 'pkg-8',
      quantity: 1,
      slots: eightMondaySlots(),
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
    expect(moved.start).toBe('2026-12-21T13:00:00.000Z');
    expect(moved.booking.lessons.find((lesson) => lesson.id === first.id)?.start).toBe(moved.start);
  });

  it('uses the supplied cancellation words and title template', () => {
    expect(CANCELLATION_POLICY).toBe("Cancel at least 24 hours ahead to reschedule online. Cancellations within 24 hours count as a lesson taught. If you don't pick a new time, we'll add the lesson to the end of your package.");
    for (const file of ['src/pages/book.astro', 'src/pages/booking/manage.astro', 'src/pages/booking/confirmed.astro']) {
      expect(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')).toContain('{CANCELLATION_POLICY}');
    }
    expect(lessonEventTitle('pkg-8', 'Alex Jordan')).toBe('Alex Jordan');
    expect(lessonEventTitle('trial', 'Alex Jordan')).toBe('Trial lesson – Alex Jordan');
    const form = readFileSync(new URL('../src/pages/book.astro', import.meta.url), 'utf8');
    expect(form).toContain('Pool address');
    expect(form).toContain('Child date of birth');
    expect(form).toContain('id="sss-phone"');
    expect(sheetValuesPath()).toContain('1Yk8WRnrqm2zXhLUdAKVNClUv1pq4VQAs2LP6eg08T40');
    expect(sheetValuesPath()).toContain('Tracker');
  });
});

describe('swim calendar rules', () => {
  it('keeps a package on one weekly day and time, with a sibling in the next 30 minutes', async () => {
    const mixed = [];
    for (let day = 26; day <= 31; day += 1) mixed.push(slotStartsOnDate(2026, 10, day)[0]);
    mixed.push(slotStartsOnDate(2026, 11, 1)[0], slotStartsOnDate(2026, 11, 2)[0]);
    const rejected = await issueHold({
      env,
      requestUrl: 'https://preview.example/api/hold',
      email: 'jordan@example.com',
      parent: 'Jordan',
      child: 'Alex',
      ...family,
      itemId: 'pkg-8',
      quantity: 1,
      slots: mixed,
      now,
    });
    expect(rejected).toEqual({ error: 'invalid-slot' });
    expect(isPackageSchedule(eightMondaySlots(), false)).toBe(true);
    const pairs = eightMondaySlots().flatMap((start) => [start, new Date(Date.parse(start) + 30 * 60 * 1000).toISOString()]);
    expect(isPackageSchedule(pairs, true)).toBe(true);
    expect(isPackageSchedule(eightMondaySlots(), true)).toBe(false);
  });

  it('adds a 10-minute buffer plus drive time between different pools, and not before the first lesson', async () => {
    const calendar = getCalendar(env) as MockCalendar;
    const morning = slotStartsOnDate(2026, 10, 26);
    calendar.saved.push({
      start: morning[0],
      end: morning[1],
      title: 'Alex Jordan',
      location: '200 Other Road, Jupiter, FL',
      description: 'Parent: Pat',
      attendeeEmail: 'pat@example.com',
      child: 'Alex Jordan',
    });
    const otherPool = await listSlots({ ...env, DRIVE_TIME_MINUTES: '15' }, now, 21, '100 Example Lane, Jupiter, FL');
    expect(otherPool.find((slot) => slot.start === morning[1])?.state).toBe('busy');
    expect(otherPool.find((slot) => slot.start === morning[2])?.state).toBe('open');
    const samePool = await listSlots({ ...env, DRIVE_TIME_MINUTES: '15' }, now, 21, '200 Other Road, Jupiter, FL');
    expect(samePool.find((slot) => slot.start === morning[1])?.state).toBe('open');

    resetCalendar();
    const fresh = getCalendar(env) as MockCalendar;
    const previousEvening = slotStartsOnDate(2026, 10, 25).at(-1)!;
    fresh.saved.push({
      start: previousEvening,
      end: slotEnd(previousEvening),
      title: 'Alex Jordan',
      location: '200 Other Road, Jupiter, FL',
      description: 'Parent: Pat',
      attendeeEmail: 'pat@example.com',
      child: 'Alex Jordan',
    });
    const nextDay = await listSlots({ ...env, DRIVE_TIME_MINUTES: '15' }, now, 21, '100 Example Lane, Jupiter, FL');
    expect(nextDay.find((slot) => slot.start === morning[0])?.state).toBe('open');

    resetCalendar();
    const personal = getCalendar(env) as MockCalendar;
    personal.saved.push({
      start: morning[0],
      end: morning[1],
      title: 'Personal',
      location: '',
      description: '',
      attendeeEmail: 'pat@example.com',
      child: '',
    });
    const afterPersonal = await listSlots(env, now, 21, family.poolAddress);
    expect(afterPersonal.find((slot) => slot.start === morning[1])?.state).toBe('open');
  });

  it('sends a booking notice by default and writes the swim calendar event only in direct mode', async () => {
    const slot = slotStartsOnDate(2026, 10, 27)[4];
    const issued = await issueHold({
      env,
      requestUrl: 'https://preview.example/api/hold',
      email: 'jordan@example.com',
      parent: 'Jordan Lee',
      child: 'Alex Jordan',
      ...family,
      itemId: 'trial',
      quantity: 1,
      slots: [slot],
      now,
    });
    if ('error' in issued) throw new Error(issued.error);
    await confirmHold({ env, requestUrl: 'https://preview.example/api/checkout', hold: issued.hold, origin: 'https://preview.example', now });
    expect((getCalendar(env) as MockCalendar).saved).toHaveLength(0);
    expect(sentNotices()[0]?.target).toBe('swim-calendar');
    expect(sentNotices()[0]?.summary).toContain('Trial lesson – Alex Jordan');
    expect(sentNotices()[0]?.summary).toContain(family.poolAddress);
    expect(sentNotices()[0]?.booking.phone).toBe(family.phone);

    resetNotices();
    resetCalendar();
    const directEnv = { ...env, BOOKING_EVENT_MODE: 'direct', BOOKING_NOTICE_TARGET: 'anson-bot' };
    const second = await issueHold({
      env: directEnv,
      requestUrl: 'https://preview.example/api/hold',
      email: 'jordan@example.com',
      parent: 'Jordan Lee',
      child: 'Alex Jordan',
      ...family,
      itemId: 'trial',
      quantity: 1,
      slots: [slotStartsOnDate(2026, 10, 27)[6]],
      now,
    });
    if ('error' in second) throw new Error(second.error);
    await confirmHold({ env: directEnv, requestUrl: 'https://preview.example/api/checkout', hold: second.hold, origin: 'https://preview.example', now });
    const saved = (getCalendar(directEnv) as MockCalendar).saved;
    expect(saved).toHaveLength(1);
    expect(saved[0]?.title).toBe('Trial lesson – Alex Jordan');
    expect(saved[0]?.location).toBe(family.poolAddress);
    expect(saved[0]?.attendeeEmail).toBe('jordan@example.com');
    expect(saved[0]?.description).toContain('Parent: Jordan Lee');
    expect(saved[0]?.description).toContain('Phone: 561-555-0134');
    expect(saved[0]?.description).toContain('Child date of birth: 2022-06-15');
    expect(saved[0]?.description).toContain('Package: Single lesson');
    expect(Date.parse(saved[0]!.end) - Date.parse(saved[0]!.start)).toBe(30 * 60 * 1000);
    expect(sentNotices()).toHaveLength(0);
    const insert = googleEventInsert('anson-calendar', saved[0]!);
    expect(insert.url).toContain('sendUpdates=none');
    expect(insert.body.attendees).toEqual([{ email: 'jordan@example.com' }]);
    expect(insert.body.start).toEqual({ dateTime: saved[0]!.start, timeZone: 'America/New_York' });
    expect(JSON.stringify(insert.body)).not.toContain('sendUpdates');
  });
});
