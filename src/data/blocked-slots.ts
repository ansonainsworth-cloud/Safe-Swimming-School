// Source: the Safe Swim Lesson Tracker sheet, synced by hand for now.
import blockedSlots from './blocked-slots.json';

export type BlockedSlot = {
  days: string[];
  start: string;
  end: string;
  until?: string;
};

export const BLOCKED_SLOTS = blockedSlots as BlockedSlot[];

export const BOOK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export const BOOK_DAY_LABELS: Record<(typeof BOOK_DAYS)[number], string> = {
  Mon: 'Monday',
  Tue: 'Tuesday',
  Wed: 'Wednesday',
  Thu: 'Thursday',
  Fri: 'Friday',
  Sat: 'Saturday',
  Sun: 'Sunday',
};

/** 30 minute start times from 8:00 AM through 6:00 PM. */
export function bookStartTimes(): string[] {
  const times: string[] = [];
  for (let minutes = 8 * 60; minutes <= 18 * 60; minutes += 30) {
    const hour = Math.floor(minutes / 60);
    const minute = minutes % 60;
    times.push(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
  }
  return times;
}

export function formatBookTime(hhmm: string): string {
  const [hourText, minuteText] = hhmm.split(':');
  const hour = Number(hourText);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const shown = hour % 12 === 0 ? 12 : hour % 12;
  return `${shown}:${minuteText} ${suffix}`;
}

function minutes(hhmm: string): number {
  const [hour, minute] = hhmm.split(':').map(Number);
  return hour * 60 + minute;
}

export function newYorkDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function isBookSlotBlocked(day: string, start: string, now = new Date()): boolean {
  const startMin = minutes(start);
  const endMin = startMin + 30;
  const today = newYorkDate(now);
  return BLOCKED_SLOTS.some((block) => {
    if (!block.days.includes(day)) return false;
    if (block.until && today > block.until) return false;
    const blockStart = minutes(block.start);
    const blockEnd = minutes(block.end);
    return startMin < blockEnd && endMin > blockStart;
  });
}
