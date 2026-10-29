import { generateKeyPairSync } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequestGet } from '../functions/api/availability';
import { listSlots, resetBookingState, type BookingEnv } from '../functions/_lib/booking';
import { resetCalendar } from '../functions/_lib/calendar';
import { etParts } from '../functions/_lib/schedule';

const now = new Date('2026-10-29T16:00:00.000Z');
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const calendarId = 'anson@safeswimmingschool.com';

const googleEnv = {
  GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({
    client_email: 'booking@example.iam.gserviceaccount.com',
    private_key: pem,
  }),
  GOOGLE_CALENDAR_ID: calendarId,
} as BookingEnv;

afterEach(() => {
  resetBookingState();
  resetCalendar();
  vi.unstubAllGlobals();
});

function noonBusy(slots: Array<{ start: string; state: string }>): boolean {
  const noon = slots.filter((slot) => {
    const parts = etParts(new Date(slot.start));
    return parts.hour === 12 && parts.minute === 0;
  });
  return noon.length > 0 && noon.every((slot) => slot.state === 'busy');
}

function openMondayMornings(slots: Array<{ start: string; state: string }>): number {
  return slots.filter((slot) => {
    const parts = etParts(new Date(slot.start));
    return parts.weekday === 'Mon' && parts.hour === 8 && parts.minute === 0 && slot.state === 'open';
  }).length;
}

describe('availability', () => {
  it('returns eight open Monday mornings from the mock calendar', async () => {
    const slots = await listSlots({}, now, 154);
    expect(slots.length).toBeGreaterThan(3000);
    expect(openMondayMornings(slots)).toBeGreaterThanOrEqual(8);
    expect(noonBusy(slots)).toBe(true);

    const response = await onRequestGet({
      request: new Request('https://preview.example/api/availability?days=154'),
      env: {},
    });
    expect(response.status).toBe(200);
    const body = await response.json() as { slots: Array<{ start: string; state: string }> };
    expect(openMondayMornings(body.slots)).toBeGreaterThanOrEqual(8);
  });

  it('falls back to the mock calendar when Google free/busy fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('oauth2.googleapis.com')) {
        return new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 });
      }
      return new Response('no', { status: 403 });
    }));
    const slots = await listSlots(googleEnv, now, 14);
    expect(openMondayMornings(slots)).toBeGreaterThanOrEqual(1);
    expect(noonBusy(slots)).toBe(true);
  });

  it('asks Google free/busy in ranges of at most 60 days', async () => {
    const ranges: number[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes('oauth2.googleapis.com')) {
        return new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 });
      }
      const body = JSON.parse(String(init?.body)) as { timeMin: string; timeMax: string };
      ranges.push(Date.parse(body.timeMax) - Date.parse(body.timeMin));
      return new Response(JSON.stringify({ calendars: { [calendarId]: { busy: [] } } }), { status: 200 });
    }));
    const slots = await listSlots(googleEnv, now, 154);
    expect(ranges.length).toBeGreaterThanOrEqual(3);
    expect(Math.max(...ranges)).toBeLessThanOrEqual(60 * 24 * 60 * 60 * 1000);
    expect(noonBusy(slots)).toBe(false);
    expect(openMondayMornings(slots)).toBeGreaterThanOrEqual(8);
  });
});
