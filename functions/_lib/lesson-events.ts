import { getItem } from './prices';
import { etParts, formatSlot, SLOT_MINUTES, TIME_ZONE } from './schedule';
import { DRIVE_BUFFER_MINUTES, samePlace, type DriveTimeAdapter } from './drive-time';

export type BookingEventMode = 'notice' | 'direct';

export function bookingEventMode(env: { BOOKING_EVENT_MODE?: string }): BookingEventMode {
  return env.BOOKING_EVENT_MODE === 'direct' ? 'direct' : 'notice';
}

export function noticeTarget(env: { BOOKING_NOTICE_TARGET?: string }): string {
  const target = env.BOOKING_NOTICE_TARGET?.trim();
  return target || 'swim-calendar';
}

/** Package lessons use the child's full name. A single lesson is a trial. */
export function lessonEventTitle(itemId: string, child: string): string {
  if (itemId === 'trial') return `Trial lesson – ${child}`;
  return child;
}

export function lessonEventDescription(input: {
  parent: string;
  phone: string;
  email: string;
  childDob: string;
  packageName: string;
  poolAddress: string;
}): string {
  return [
    `Parent: ${input.parent}`,
    `Phone: ${input.phone}`,
    `Email: ${input.email}`,
    `Child date of birth: ${input.childDob}`,
    `Package: ${input.packageName}`,
    `Pool address: ${input.poolAddress}`,
  ].join('\n');
}

export type LessonEventInput = {
  itemId: string;
  parent: string;
  phone: string;
  email: string;
  child: string;
  childDob: string;
  sibling?: string;
  siblingDob?: string;
  poolAddress: string;
  slots: Array<{ start: string; end: string }>;
};

export type BuiltLessonEvent = {
  start: string;
  end: string;
  title: string;
  location: string;
  description: string;
  attendeeEmail: string;
  child: string;
};

export function packageName(itemId: string): string {
  return getItem(itemId)?.name || itemId;
}

function weekGapDays(left: string, right: string): number {
  return (Date.parse(right) - Date.parse(left)) / (24 * 60 * 60 * 1000);
}

export function isWeeklySeries(slots: string[]): boolean {
  const sorted = [...slots].sort((a, b) => Date.parse(a) - Date.parse(b));
  if (!sorted.length) return false;
  const first = etParts(new Date(sorted[0]));
  for (let i = 0; i < sorted.length; i += 1) {
    const parts = etParts(new Date(sorted[i]));
    if (parts.weekday !== first.weekday || parts.hour !== first.hour || parts.minute !== first.minute) return false;
    if (i > 0) {
      const gap = weekGapDays(sorted[i - 1], sorted[i]);
      if (gap < 6.5 || gap > 7.5) return false;
    }
  }
  return true;
}

/** A package is one weekly time. A sibling takes the following 30 minutes each week. */
export function isPackageSchedule(slots: string[], sibling: boolean): boolean {
  const sorted = [...slots].sort((a, b) => Date.parse(a) - Date.parse(b));
  if (!sibling) return isWeeklySeries(sorted);
  if (sorted.length < 2 || sorted.length % 2 !== 0) return false;
  const firsts: string[] = [];
  for (let i = 0; i < sorted.length; i += 2) {
    const gap = Date.parse(sorted[i + 1]) - Date.parse(sorted[i]);
    if (gap !== SLOT_MINUTES * 60 * 1000) return false;
    const left = etParts(new Date(sorted[i]));
    const right = etParts(new Date(sorted[i + 1]));
    if (left.year !== right.year || left.month !== right.month || left.day !== right.day) return false;
    firsts.push(sorted[i]);
  }
  return isWeeklySeries(firsts);
}

export function buildLessonEvents(input: LessonEventInput): BuiltLessonEvent[] {
  const sorted = [...input.slots].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const name = packageName(input.itemId);
  return sorted.map((slot, index) => {
    const siblingSlot = Boolean(input.sibling) && index % 2 === 1;
    const child = siblingSlot && input.sibling ? input.sibling : input.child;
    const childDob = siblingSlot && input.siblingDob ? input.siblingDob : input.childDob;
    return {
      start: slot.start,
      end: slot.end,
      title: lessonEventTitle(input.itemId, child),
      location: input.poolAddress,
      description: lessonEventDescription({
        parent: input.parent,
        phone: input.phone,
        email: input.email,
        childDob,
        packageName: name,
        poolAddress: input.poolAddress,
      }),
      attendeeEmail: input.email,
      child,
    };
  });
}

export type BookingNotice = {
  target: string;
  summary: string;
  booking: {
    id: string;
    parent: string;
    phone: string;
    email: string;
    child: string;
    childDob: string;
    sibling?: string;
    poolAddress: string;
    packageName: string;
    itemId: string;
    lessons: Array<{ start: string; end: string; child: string; title: string; status?: string }>;
  };
};

export function buildBookingNotice(input: {
  target: string;
  id: string;
  itemId: string;
  parent: string;
  phone: string;
  email: string;
  child: string;
  childDob: string;
  sibling?: string;
  poolAddress: string;
  lessons: Array<{ start: string; end: string; child: string; title: string; status?: string }>;
}): BookingNotice {
  const name = packageName(input.itemId);
  const summary = [
    `${name} for ${input.child}${input.sibling ? ` and ${input.sibling}` : ''}`,
    `Parent: ${input.parent}`,
    `Phone: ${input.phone}`,
    `Email: ${input.email}`,
    `Child date of birth: ${input.childDob}`,
    `Pool address: ${input.poolAddress}`,
    ...input.lessons.map((lesson) => `${lesson.title} — ${formatSlot(lesson.start)}${lesson.status === 'taught' ? ' (counted as a lesson taught)' : ''}`),
  ].join('\n');
  return {
    target: input.target,
    summary,
    booking: {
      id: input.id,
      parent: input.parent,
      phone: input.phone,
      email: input.email,
      child: input.child,
      childDob: input.childDob,
      sibling: input.sibling,
      poolAddress: input.poolAddress,
      packageName: name,
      itemId: input.itemId,
      lessons: input.lessons,
    },
  };
}

type NoticeGlobal = typeof globalThis & { __sssNotices?: BookingNotice[] };

export function resetNotices(): void {
  (globalThis as NoticeGlobal).__sssNotices = [];
}

export function sentNotices(): BookingNotice[] {
  const g = globalThis as NoticeGlobal;
  if (!g.__sssNotices) g.__sssNotices = [];
  return g.__sssNotices;
}

export async function deliverNotice(notice: BookingNotice): Promise<void> {
  sentNotices().push(notice);
  console.log(JSON.stringify({ notice: 'stubbed', target: notice.target }));
}

export function googleEventInsert(calendarId: string, event: BuiltLessonEvent): { url: string; body: Record<string, unknown> } {
  const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
  url.searchParams.set('sendUpdates', 'none');
  return {
    url: url.toString(),
    body: {
      summary: event.title,
      location: event.location,
      description: event.description,
      start: { dateTime: event.start, timeZone: TIME_ZONE },
      end: { dateTime: event.end, timeZone: TIME_ZONE },
      attendees: [{ email: event.attendeeEmail }],
    },
  };
}

export type LocatedInterval = { start: string; end: string; location?: string };

function dayKey(iso: string): string {
  const parts = etParts(new Date(iso));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Overlap blocks the slot. Drive time applies only between lessons that have pool addresses, and not before the day's first lesson. */
export async function isSlotBlocked(
  start: string,
  end: string,
  poolAddress: string | undefined,
  events: LocatedInterval[],
  drive: DriveTimeAdapter,
): Promise<boolean> {
  if (events.some((interval) => interval.start < end && interval.end > start)) return true;
  if (!poolAddress) return false;
  const day = dayKey(start);
  const lessons = events.filter((interval) => interval.location && dayKey(interval.start) === day);
  const previous = lessons.filter((interval) => interval.end <= start).sort((a, b) => Date.parse(b.end) - Date.parse(a.end))[0];
  const next = lessons.filter((interval) => interval.start >= end).sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0];
  if (previous?.location && !samePlace(previous.location, poolAddress)) {
    const minutes = DRIVE_BUFFER_MINUTES + await drive.estimateMinutes(previous.location, poolAddress);
    if (Date.parse(start) < Date.parse(previous.end) + minutes * 60 * 1000) return true;
  }
  if (next?.location && !samePlace(poolAddress, next.location)) {
    const minutes = DRIVE_BUFFER_MINUTES + await drive.estimateMinutes(poolAddress, next.location);
    if (Date.parse(next.start) < Date.parse(end) + minutes * 60 * 1000) return true;
  }
  return false;
}
