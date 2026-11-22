import { generateKeyPairSync } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequestGet } from '../functions/api/availability';
import { busyBookSlots, freeBusyChunks, FREEBUSY_MAX_MS, readBusyIntervals } from '../functions/_lib/calendar';

const calendarId = 'anson@safeswimmingschool.com';
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const googleEnv = {
  GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({
    client_email: 'booking@example.iam.gserviceaccount.com',
    private_key: pem,
  }),
  GOOGLE_CALENDAR_ID: calendarId,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('calendar free/busy', () => {
  it('asks Google in ranges of at most 60 days', () => {
    const from = '2026-11-16T16:00:00.000Z';
    const to = new Date(Date.parse(from) + 154 * 24 * 60 * 60 * 1000).toISOString();
    const chunks = freeBusyChunks(from, to);
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    for (const chunk of chunks) {
      expect(Date.parse(chunk.timeMax) - Date.parse(chunk.timeMin)).toBeLessThanOrEqual(FREEBUSY_MAX_MS);
    }
    expect(chunks[0].timeMin).toBe(new Date(from).toISOString());
    expect(chunks.at(-1)?.timeMax).toBe(new Date(to).toISOString());
  });

  it('turns a busy interval into the overlapping weekday start', () => {
    const slots = busyBookSlots([{ start: '2026-11-16T09:00:00-05:00', end: '2026-11-16T09:30:00-05:00' }]);
    expect(slots).toEqual([{ day: 'Mon', start: '09:00' }]);
  });

  it('falls back when credentials are missing or Google errors', async () => {
    expect(await readBusyIntervals({}, '2026-11-16T16:00:00.000Z', '2026-12-16T16:00:00.000Z')).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('oauth2.googleapis.com')) return Response.json({ access_token: 'tok' });
      return new Response('no', { status: 403 });
    }));
    expect(await readBusyIntervals(googleEnv, '2026-11-16T16:00:00.000Z', '2026-12-16T16:00:00.000Z')).toBeNull();
    const response = await onRequestGet({
      request: new Request('https://safeswimmingschool.com/api/availability'),
      env: {},
    });
    expect(await response.json()).toEqual({ source: 'fallback', busy: [] });
  });

  it('returns calendar busy times in 60 day chunks and does not replace local blocks', async () => {
    const ranges: number[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes('oauth2.googleapis.com')) return Response.json({ access_token: 'tok' });
      const body = JSON.parse(String(init?.body)) as { timeMin: string; timeMax: string };
      ranges.push(Date.parse(body.timeMax) - Date.parse(body.timeMin));
      return Response.json({
        calendars: {
          [calendarId]: { busy: [{ start: '2026-11-16T14:00:00.000Z', end: '2026-11-16T14:30:00.000Z' }] },
        },
      });
    }));
    const response = await onRequestGet({
      request: new Request('https://safeswimmingschool.com/api/availability?days=154'),
      env: googleEnv,
    });
    const body = await response.json() as { source: string; busy: Array<{ day: string; start: string }> };
    expect(ranges.length).toBeGreaterThanOrEqual(3);
    expect(Math.max(...ranges)).toBeLessThanOrEqual(FREEBUSY_MAX_MS);
    expect(body.source).toBe('calendar');
    expect(body.busy).toContainEqual({ day: 'Mon', start: '09:00' });
    expect(body.busy.some((slot) => slot.start === '15:00')).toBe(false);
  });

  it('calls fetch with an unbound this, the way Cloudflare Workers requires', async () => {
    const calls: string[] = [];
    const workersFetch = vi.fn(async function (this: unknown, url: string, init?: RequestInit) {
      if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
      calls.push(String(url));
      if (String(url).includes('oauth2.googleapis.com')) return Response.json({ access_token: 'tok' });
      return Response.json({ calendars: { [calendarId]: { busy: [{ start: '2026-11-16T14:00:00.000Z', end: '2026-11-16T14:30:00.000Z' }] } } });
    });
    const intervals = await readBusyIntervals(googleEnv, '2026-11-16T16:00:00.000Z', '2026-12-16T16:00:00.000Z', workersFetch);
    expect(intervals).toEqual([{ start: '2026-11-16T14:00:00.000Z', end: '2026-11-16T14:30:00.000Z' }]);
    expect(calls.some((url) => url.includes('freeBusy'))).toBe(true);
    expect(calls.some((url) => url.includes('oauth2.googleapis.com'))).toBe(true);
  });

  it('lists every functions/api route in _routes.json', () => {
    const routes = JSON.parse(readFileSync(new URL('../public/_routes.json', import.meta.url), 'utf8')) as { include: string[] };
    const files = readdirSync(new URL('../functions/api/', import.meta.url));
    const apiRoutes = files.filter((file) => file.endsWith('.ts')).map((file) => `/api/${file.replace(/\.ts$/, '')}`);
    expect(apiRoutes).toContain('/api/availability');
    for (const route of apiRoutes) expect(routes.include, route).toContain(route);
  });
});
