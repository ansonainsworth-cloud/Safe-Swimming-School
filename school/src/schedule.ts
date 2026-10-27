import { henryFamily, instructorAccount } from "./mock-data";
import { addDays, addMinutesIso, zonedParts, zonedTimeToUtc } from "./time";

export interface DemoHistory {
  clockInOffsetMinutes: number;
  clockOutOffsetMinutes: number;
}

export interface CalendarLesson {
  calendarEventId: string;
  familyId: string;
  instructorEmail: string;
  childFirstName: string;
  startsAt: string;
  endsAt: string;
  address: string;
  lat: number;
  lng: number;
  demoHistory?: DemoHistory;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function at(
  day: { year: number; month: number; day: number },
  hour: number,
  minute: number,
  timeZone: string,
): string {
  return zonedTimeToUtc(day.year, day.month, day.day, hour, minute, timeZone).toISOString();
}

/** Practice lessons anchored to the current day in Palm Beach County. */
export function buildMockLessons(now: Date, timeZone: string): CalendarLesson[] {
  const todayParts = zonedParts(now, timeZone);
  const today = { year: todayParts.year, month: todayParts.month, day: todayParts.day };
  const yesterday = addDays(today.year, today.month, today.day, -1);
  const tomorrow = addDays(today.year, today.month, today.day, 1);
  const shared = {
    familyId: henryFamily.id,
    instructorEmail: instructorAccount.email,
    childFirstName: henryFamily.childFirstName,
    address: henryFamily.address,
    lat: henryFamily.lat,
    lng: henryFamily.lng,
  };
  const yesterdayStart = at(yesterday, 16, 0, timeZone);
  const todayStart = at(today, 17, 0, timeZone);
  const tomorrowStart = at(tomorrow, 10, 0, timeZone);
  return [
    {
      ...shared,
      calendarEventId: `henry-${yesterday.year}${pad(yesterday.month)}${pad(yesterday.day)}-1600`,
      startsAt: yesterdayStart,
      endsAt: addMinutesIso(yesterdayStart, 30),
      demoHistory: { clockInOffsetMinutes: 12, clockOutOffsetMinutes: 31 },
    },
    {
      ...shared,
      calendarEventId: `henry-${today.year}${pad(today.month)}${pad(today.day)}-1700`,
      startsAt: todayStart,
      endsAt: addMinutesIso(todayStart, 30),
    },
    {
      ...shared,
      calendarEventId: `henry-${tomorrow.year}${pad(tomorrow.month)}${pad(tomorrow.day)}-1000`,
      startsAt: tomorrowStart,
      endsAt: addMinutesIso(tomorrowStart, 30),
    },
  ];
}
