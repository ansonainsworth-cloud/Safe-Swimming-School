import { fetchGoogleAccessToken, type ServiceAccount } from './google-auth';
import { datesFrom, mockBusyStarts, SLOT_MINUTES } from './schedule';

export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar';

export type BusyInterval = { start: string; end: string };

export type CalendarEvent = {
  start: string;
  end: string;
  title: string;
};

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
    const saved = this.saved.map((event) => ({ start: event.start, end: event.end }));
    return [...fixture, ...saved].filter((interval) => interval.end > fromIso && interval.start < toIso);
  }

  async saveEvents(events: CalendarEvent[]): Promise<void> {
    this.saved.push(...events);
  }
}

export class GoogleCalendar implements CalendarAdapter {
  constructor(
    private readonly calendarId: string,
    private readonly account: ServiceAccount,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async token(): Promise<string> {
    return fetchGoogleAccessToken(this.account, CALENDAR_SCOPE, this.fetchImpl);
  }

  async busyIntervals(fromIso: string, toIso: string): Promise<BusyInterval[]> {
    const token = await this.token();
    const response = await this.fetchImpl('https://www.googleapis.com/calendar/v3/freeBusy', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ timeMin: fromIso, timeMax: toIso, items: [{ id: this.calendarId }] }),
    });
    if (!response.ok) throw new Error('Calendar free/busy failed');
    const body = await response.json() as { calendars?: Record<string, { busy?: BusyInterval[] }> };
    return body.calendars?.[this.calendarId]?.busy ?? [];
  }

  async saveEvents(events: CalendarEvent[]): Promise<void> {
    const token = await this.token();
    for (const event of events) {
      const response = await this.fetchImpl(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(this.calendarId)}/events`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          summary: event.title,
          start: { dateTime: event.start, timeZone: 'America/New_York' },
          end: { dateTime: event.end, timeZone: 'America/New_York' },
        }),
      });
      if (!response.ok) throw new Error('Calendar event create failed');
    }
  }
}

export type CalendarEnv = {
  GOOGLE_SERVICE_ACCOUNT_JSON?: string;
  GOOGLE_CALENDAR_ID?: string;
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
        return new GoogleCalendar(env.GOOGLE_CALENDAR_ID, { client_email: account.client_email, private_key: account.private_key }, fetchImpl);
      }
    } catch {
      // Fall through to the mock when the secret is not usable JSON.
    }
  }
  const g = globalThis as CalendarGlobal;
  if (!g.__sssCalendar) g.__sssCalendar = new MockCalendar();
  return g.__sssCalendar;
}
