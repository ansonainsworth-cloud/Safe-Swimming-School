import { fetchGoogleAccessToken, type ServiceAccount } from './google-auth';
import { bookStartTimes, BOOK_DAYS } from '../../src/data/blocked-slots';

export const FREEBUSY_SCOPE = 'https://www.googleapis.com/auth/calendar.freebusy';
/** Google free/busy rejects ranges around 90 days. Stay under that. */
export const FREEBUSY_MAX_MS = 60 * 24 * 60 * 60 * 1000;
export const DEFAULT_CALENDAR_ID = 'anson@safeswimmingschool.com';
const FETCH_TIMEOUT_MS = 8000;
const callFetch: typeof fetch = (input, init) => fetch(input, init);

function availabilityError(err: unknown): string {
  return err instanceof Error ? err.name + ': ' + err.message : 'unknown';
}

export type BusyInterval = { start: string; end: string };

export type CalendarEnv = {
  GOOGLE_SERVICE_ACCOUNT_JSON?: string;
  GOOGLE_CALENDAR_ID?: string;
};

export type BusySlot = { day: string; start: string };

type FreeBusyChunk = { timeMin: string; timeMax: string };

export function freeBusyChunks(fromIso: string, toIso: string): FreeBusyChunk[] {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return [];
  const chunks: FreeBusyChunk[] = [];
  for (let start = from; start < to; start += FREEBUSY_MAX_MS) {
    const end = Math.min(to, start + FREEBUSY_MAX_MS);
    chunks.push({ timeMin: new Date(start).toISOString(), timeMax: new Date(end).toISOString() });
  }
  return chunks;
}

function newYorkParts(date: Date): { day: string; minutes: number } | null {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value || '';
  const day = value('weekday').slice(0, 3);
  const hour = Number(value('hour'));
  const minute = Number(value('minute'));
  if (!BOOK_DAYS.includes(day as typeof BOOK_DAYS[number]) || !Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return { day, minutes: hour * 60 + minute };
}

function slotKey(day: string, start: string): string {
  return `${day}|${start}`;
}

/** Weekday start times whose 30 minute lesson overlaps a busy interval. */
export function busyBookSlots(intervals: BusyInterval[]): BusySlot[] {
  const starts = new Set(bookStartTimes());
  const found = new Map<string, BusySlot>();
  for (const interval of intervals) {
    const startMs = Date.parse(interval.start);
    const endMs = Date.parse(interval.end);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue;
    for (let cursor = startMs; cursor < endMs; cursor += 30 * 60 * 1000) {
      const when = newYorkParts(new Date(cursor));
      if (!when) continue;
      const slotStart = when.minutes - (when.minutes % 30);
      const hh = String(Math.floor(slotStart / 60)).padStart(2, '0');
      const mm = String(slotStart % 60).padStart(2, '0');
      const start = `${hh}:${mm}`;
      if (!starts.has(start)) continue;
      found.set(slotKey(when.day, start), { day: when.day, start });
    }
  }
  return [...found.values()];
}

export class GoogleCalendar {
  private tokenPromise: Promise<string> | null = null;

  constructor(
    private readonly calendarId: string,
    private readonly account: ServiceAccount,
    private readonly fetchImpl: typeof fetch = callFetch,
  ) {}

  private token(): Promise<string> {
    if (!this.tokenPromise) this.tokenPromise = fetchGoogleAccessToken(this.account, FREEBUSY_SCOPE, this.fetchImpl);
    return this.tokenPromise;
  }

  async busyIntervals(fromIso: string, toIso: string): Promise<BusyInterval[]> {
    const intervals: BusyInterval[] = [];
    for (const chunk of freeBusyChunks(fromIso, toIso)) {
      intervals.push(...await this.freeBusy(chunk.timeMin, chunk.timeMax));
    }
    return intervals;
  }

  private async freeBusy(fromIso: string, toIso: string): Promise<BusyInterval[]> {
    const token = await this.token();
    const request = this.fetchImpl;
    const response = await request('https://www.googleapis.com/calendar/v3/freeBusy', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ timeMin: fromIso, timeMax: toIso, items: [{ id: this.calendarId }] }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error('google-freebusy-failed');
    const body = await response.json() as { calendars?: Record<string, { busy?: BusyInterval[]; errors?: unknown[] }> };
    const calendar = body.calendars?.[this.calendarId];
    if (!calendar || (calendar.errors && calendar.errors.length > 0)) throw new Error('google-freebusy-failed');
    return calendar.busy ?? [];
  }
}

export function calendarFromEnv(env: CalendarEnv, fetchImpl: typeof fetch = callFetch): GoogleCalendar | null {
  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON) return null;
  try {
    const account = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON) as { client_email?: string; private_key?: string };
    if (!account.client_email || !account.private_key) return null;
    return new GoogleCalendar(
      env.GOOGLE_CALENDAR_ID || DEFAULT_CALENDAR_ID,
      { client_email: account.client_email, private_key: account.private_key },
      fetchImpl,
    );
  } catch (err) {
    console.error('availability:', availabilityError(err));
    return null;
  }
}

export async function readBusyIntervals(env: CalendarEnv, fromIso: string, toIso: string, fetchImpl: typeof fetch = callFetch): Promise<BusyInterval[] | null> {
  const calendar = calendarFromEnv(env, fetchImpl);
  if (!calendar) return null;
  try {
    return await calendar.busyIntervals(fromIso, toIso);
  } catch (err) {
    console.error('availability:', availabilityError(err));
    return null;
  }
}
