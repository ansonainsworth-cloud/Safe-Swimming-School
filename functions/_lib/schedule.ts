export const TIME_ZONE = 'America/New_York';
export const SLOT_MINUTES = 30;
export const DAY_START_MINUTES = 8 * 60;
export const DAY_END_MINUTES = 19 * 60;
export const HOLD_MS = 15 * 60 * 1000;
export const CANCELLATION_POLICY = "Cancel at least 24 hours ahead to reschedule online. Cancellations within 24 hours count as a lesson taught. If you don't pick a new time, we'll add the lesson to the end of your package.";
export const WEATHER_CANCELLATION_POLICY = "When the school cancels a lesson for cold weather, it does not count as a lesson taught. We'll offer the next agreeable time. If you don't choose one, or none is open, we'll add the lesson to the end of your package.";

const BLOCKED_NAMES = ['asher', 'gavin', 'malachi'];

export function usesBlockedName(value: string): boolean {
  const haystack = value.toLowerCase();
  return BLOCKED_NAMES.some((name) => haystack.includes(name));
}

const ET_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  hourCycle: 'h23',
  weekday: 'short',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function zonedParts(instant: Date, timeZone: string): Record<string, string> {
  const fmt = timeZone === TIME_ZONE
    ? ET_FORMATTER
    : new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  return Object.fromEntries(fmt.formatToParts(instant).map((part) => [part.type, part.value]));
}

export function timeZoneOffsetMs(instant: Date, timeZone = TIME_ZONE): number {
  const parts = zonedParts(instant, timeZone);
  let hour = Number(parts.hour);
  let day = Number(parts.day);
  if (hour === 24) hour = 0;
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, day, hour, Number(parts.minute), Number(parts.second));
  return asUtc - instant.getTime();
}

export function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone = TIME_ZONE): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const utc = new Date(guess.getTime() - timeZoneOffsetMs(guess, timeZone));
  return new Date(guess.getTime() - timeZoneOffsetMs(utc, timeZone));
}

export type EtParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: string;
};

export function etParts(instant: Date, timeZone = TIME_ZONE): EtParts {
  const parts = zonedParts(instant, timeZone);
  let hour = Number(parts.hour);
  if (hour === 24) hour = 0;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour,
    minute: Number(parts.minute),
    weekday: parts.weekday,
  };
}

export function slotStartsOnDate(year: number, month: number, day: number): string[] {
  const starts: string[] = [];
  for (let minutes = DAY_START_MINUTES; minutes < DAY_END_MINUTES; minutes += SLOT_MINUTES) {
    const hour = Math.floor(minutes / 60);
    const minute = minutes % 60;
    starts.push(zonedTimeToUtc(year, month, day, hour, minute).toISOString());
  }
  return starts;
}

export function isCanonicalSlot(startIso: string): boolean {
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) return false;
  const parts = etParts(start);
  if (parts.minute % SLOT_MINUTES !== 0) return false;
  const minutes = parts.hour * 60 + parts.minute;
  if (minutes < DAY_START_MINUTES || minutes >= DAY_END_MINUTES) return false;
  const canonical = zonedTimeToUtc(parts.year, parts.month, parts.day, parts.hour, parts.minute).toISOString();
  return canonical === start.toISOString();
}

export function slotEnd(startIso: string): string {
  return new Date(Date.parse(startIso) + SLOT_MINUTES * 60 * 1000).toISOString();
}

export function datesFrom(now: Date, days: number): Array<{ year: number; month: number; day: number }> {
  const first = etParts(now);
  const start = zonedTimeToUtc(first.year, first.month, first.day, 12, 0);
  const dates = [];
  for (let i = 0; i < days; i += 1) {
    const parts = etParts(new Date(start.getTime() + i * 24 * 60 * 60 * 1000));
    dates.push({ year: parts.year, month: parts.month, day: parts.day });
  }
  return dates;
}

export function mockBusyStarts(dates: Array<{ year: number; month: number; day: number }>): string[] {
  const starts: string[] = [];
  for (const date of dates) {
    starts.push(zonedTimeToUtc(date.year, date.month, date.day, 12, 0).toISOString());
    starts.push(zonedTimeToUtc(date.year, date.month, date.day, 12, 30).toISOString());
  }
  return starts;
}

export function canReschedule(startIso: string, now: Date): boolean {
  return Date.parse(startIso) - now.getTime() >= 24 * 60 * 60 * 1000;
}

export function formatSlot(startIso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(startIso));
}

/** First open slot after `afterIso` on the same ET weekday and clock time as `usualStartIso`. */
export function nextUsualSlot(afterIso: string, usualStartIso: string, taken: Set<string>): string | null {
  const usual = etParts(new Date(usualStartIso));
  const after = Date.parse(afterIso);
  const afterParts = etParts(new Date(afterIso));
  const cursor = zonedTimeToUtc(afterParts.year, afterParts.month, afterParts.day, 12, 0);
  for (let day = 0; day <= 366; day += 1) {
    const parts = etParts(new Date(cursor.getTime() + day * 24 * 60 * 60 * 1000));
    if (parts.weekday !== usual.weekday) continue;
    const start = zonedTimeToUtc(parts.year, parts.month, parts.day, usual.hour, usual.minute).toISOString();
    if (Date.parse(start) <= after) continue;
    if (!isCanonicalSlot(start)) continue;
    if (taken.has(start)) continue;
    return start;
  }
  return null;
}
