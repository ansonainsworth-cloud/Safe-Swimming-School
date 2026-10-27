export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const bag = Object.fromEntries(fmt.formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  let hour = Number(bag.hour);
  if (hour === 24) hour = 0;
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour,
    minute: Number(bag.minute),
    second: Number(bag.second),
  };
}

/** Wall clock time in `timeZone` as a UTC Date. */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  let utc = Date.UTC(year, month - 1, day, hour, minute, 0);
  const target = utc;
  for (let pass = 0; pass < 3; pass += 1) {
    const parts = zonedParts(new Date(utc), timeZone);
    const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const delta = target - asUtc;
    if (delta === 0) break;
    utc += delta;
  }
  return new Date(utc);
}

export function addDays(year: number, month: number, day: number, delta: number): { year: number; month: number; day: number } {
  const shifted = new Date(Date.UTC(year, month - 1, day + delta));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

export function addMinutesIso(iso: string, minutes: number): string {
  return new Date(Date.parse(iso) + minutes * 60_000).toISOString();
}

export function localDayBounds(now: Date, timeZone: string): { startIso: string; endIso: string } {
  const parts = zonedParts(now, timeZone);
  const start = zonedTimeToUtc(parts.year, parts.month, parts.day, 0, 0, timeZone);
  const next = addDays(parts.year, parts.month, parts.day, 1);
  const end = zonedTimeToUtc(next.year, next.month, next.day, 0, 0, timeZone);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

export function isSameLocalDay(iso: string, now: Date, timeZone: string): boolean {
  const lesson = zonedParts(new Date(iso), timeZone);
  const current = zonedParts(now, timeZone);
  return lesson.year === current.year && lesson.month === current.month && lesson.day === current.day;
}

function cleanSpaces(value: string): string {
  return value.replace(/[\u202f\u00a0]/g, " ");
}

export function formatTime(iso: string, timeZone: string): string {
  return cleanSpaces(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso)),
  );
}

export function formatDay(iso: string, timeZone: string): string {
  return cleanSpaces(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(new Date(iso)),
  );
}

export function formatTimeRange(startIso: string, endIso: string, timeZone: string): string {
  return `${formatTime(startIso, timeZone)} to ${formatTime(endIso, timeZone)}`;
}

export function minutesAfter(actualIso: string, scheduledIso: string): number {
  return (Date.parse(actualIso) - Date.parse(scheduledIso)) / 60_000;
}
