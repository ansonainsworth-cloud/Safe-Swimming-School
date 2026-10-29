import { fetchGoogleAccessToken, type ServiceAccount } from './google-auth';
import { bookingEventMode, googleEventInsert, type BookingEventMode, type BuiltLessonEvent } from './lesson-events';
import { datesFrom, mockBusyStarts, SLOT_MINUTES, zonedTimeToUtc } from './schedule';

export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar';
export const FREEBUSY_SCOPE = 'https://www.googleapis.com/auth/calendar.freebusy';
/** Google free/busy rejects ranges around 90 days. Stay under that. */
const FREEBUSY_MAX_MS = 60 * 24 * 60 * 60 * 1000;

export type BusyInterval = { start: string; end: string; location?: string };

export type CalendarEvent = BuiltLessonEvent;

export interface CalendarAdapter {
  busyIntervals(fromIso: string, toIso: string): Promise<BusyInterval[]>;
  saveEvents(events: CalendarEvent[]): Promise<void>;
}

export class MockCalendar implements CalendarAdapter {
  saved: CalendarEvent[] = [];

  async busyIntervals(fromIso: string, toIso: string): Promise<BusyInterval[]> {
    const from = new Date(fromIso);
    const to = new Date(toIso);
    const days = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)) + 1);
    const fixture = mockBusyStarts(datesFrom(from, days)).map((start) => ({
      start,
      end: new Date(Date.parse(start) + SLOT_MINUTES * 60 * 1000).toISOString(),
    }));
    const saved = this.saved.map((event) => ({ start: event.start, end: event.end, location: event.location }));
    return [...fixture, ...saved].filter((interval) => interval.end > fromIso && interval.start < toIso);
  }

  async saveEvents(events: CalendarEvent[]): Promise<void> {
    this.saved.push(...events);
  }
}

type GoogleEvent = {
  status?: string;
  location?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
};

function allDayBounds(startDate: string, endDate: string): BusyInterval | null {
  const startMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startDate);
  const endMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(endDate);
  if (!startMatch || !endMatch) return null;
  const start = zonedTimeToUtc(Number(startMatch[1]), Number(startMatch[2]), Number(startMatch[3]), 0, 0).toISOString();
  const end = zonedTimeToUtc(Number(endMatch[1]), Number(endMatch[2]), Number(endMatch[3]), 0, 0).toISOString();
  return { start, end };
}

export function intervalFromGoogleEvent(event: GoogleEvent): BusyInterval | null {
  if (event.status === 'cancelled') return null;
  if (event.start?.dateTime && event.end?.dateTime) {
    return { start: event.start.dateTime, end: event.end.dateTime, location: event.location || undefined };
  }
  if (event.start?.date && event.end?.date) {
    const bounds = allDayBounds(event.start.date, event.end.date);
    if (!bounds) return null;
    return { ...bounds, location: event.location || undefined };
  }
  return null;
}

export class GoogleCalendar implements CalendarAdapter {
  constructor(
    private readonly calendarId: string,
    private readonly account: ServiceAccount,
    private readonly mode: BookingEventMode,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

private tokenPromise: Promise<string> | null = null;

  private token(): Promise<string> {
    if (!this.tokenPromise) {
      const scope = this.mode === 'notice' ? FREEBUSY_SCOPE : CALENDAR_SCOPE;
      this.tokenPromise = fetchGoogleAccessToken(this.account, scope, this.fetchImpl);
    }
    return this.tokenPromise;
  }

  async busyIntervals(fromIso: string, toIso: string): Promise<BusyInterval[]> {
    if (this.mode === 'notice') return this.freeBusySpan(fromIso, toIso);
    return this.listedEvents(fromIso, toIso);
  }

  private async freeBusySpan(fromIso: string, toIso: string): Promise<BusyInterval[]> {
    const from = Date.parse(fromIso);
    const to = Date.parse(toIso);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return this.freeBusy(fromIso, toIso);
    const intervals: BusyInterval[] = [];
    for (let start = from; start < to; start += FREEBUSY_MAX_MS) {
      const end = Math.min(to, start + FREEBUSY_MAX_MS);
      intervals.push(...await this.freeBusy(new Date(start).toISOString(), new Date(end).toISOString()));
    }
    return intervals;
  }

  private async freeBusy(fromIso: string, toIso: string): Promise<BusyInterval[]> {
    const token = await this.token();
    const response = await this.fetchImpl('https://www.googleapis.com/calendar/v3/freeBusy', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ timeMin: fromIso, timeMax: toIso, items: [{ id: this.calendarId }] }),
    });
    if (!response.ok) throw new Error(`Calendar free/busy failed (${response.status})`);
    const body = await response.json() as { calendars?: Record<string, { busy?: BusyInterval[]; errors?: unknown[] }> };
    const calendar = body.calendars?.[this.calendarId];
    if (!calendar || (calendar.errors && calendar.errors.length > 0)) throw new Error('Calendar free/busy failed');
    return calendar.busy ?? [];
  }

  private async listedEvents(fromIso: string, toIso: string): Promise<BusyInterval[]> {
    const token = await this.token();
    const intervals: BusyInterval[] = [];
    let pageToken = '';
    for (let page = 0; page < 5; page += 1) {
      const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(this.calendarId)}/events`);
      url.searchParams.set('singleEvents', 'true');
      url.searchParams.set('orderBy', 'startTime');
      url.searchParams.set('timeMin', fromIso);
      url.searchParams.set('timeMax', toIso);
      url.searchParams.set('maxResults', '2500');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const response = await this.fetchImpl(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error('Calendar event list failed');
      const body = await response.json() as { items?: GoogleEvent[]; nextPageToken?: string };
      for (const event of body.items ?? []) {
        const interval = intervalFromGoogleEvent(event);
        if (interval) intervals.push(interval);
      }
      if (!body.nextPageToken) break;
      pageToken = body.nextPageToken;
    }
    return intervals;
  }

  async saveEvents(events: CalendarEvent[]): Promise<void> {
    const token = await this.token();
    for (const event of events) {
      const insert = googleEventInsert(this.calendarId, event);
      const response = await this.fetchImpl(insert.url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(insert.body),
      });
      if (!response.ok) throw new Error('Calendar event create failed');
    }
  }
}

export type CalendarEnv = {
  GOOGLE_SERVICE_ACCOUNT_JSON?: string;
  GOOGLE_CALENDAR_ID?: string;
  BOOKING_EVENT_MODE?: string;
};

type CalendarGlobal = typeof globalThis & { __sssCalendar?: MockCalendar };

export function resetCalendar(): void {
  (globalThis as CalendarGlobal).__sssCalendar = new MockCalendar();
}

export function getCalendar(env: CalendarEnv = {}, fetchImpl: typeof fetch = fetch): CalendarAdapter {
  if (env.GOOGLE_SERVICE_ACCOUNT_JSON && env.GOOGLE_CALENDAR_ID) {
    try {
      const account = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON) as { client_email?: string; private_key?: string };
      if (account.client_email && account.private_key) {
        return new GoogleCalendar(
          env.GOOGLE_CALENDAR_ID,
          { client_email: account.client_email, private_key: account.private_key },
          bookingEventMode(env),
          fetchImpl,
        );
      }
    } catch {
      // Fall through to the mock when the secret is not usable JSON.
    }
  }
  const g = globalThis as CalendarGlobal;
  if (!g.__sssCalendar) g.__sssCalendar = new MockCalendar();
  return g.__sssCalendar;
}

/** Real calendar when it answers. Otherwise the mock busy times, so a failed Google read does not 500. */
export async function readBusyIntervals(env: CalendarEnv, fromIso: string, toIso: string): Promise<BusyInterval[]> {
  try {
    return await getCalendar(env).busyIntervals(fromIso, toIso);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'calendar-failed';
    console.log(JSON.stringify({ calendar: 'mock-fallback', message }));
    return new MockCalendar().busyIntervals(fromIso, toIso);
  }
}
