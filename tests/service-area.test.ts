import { afterEach, describe, expect, it } from 'vitest';
import { listSlots, resetBookingState } from '../functions/_lib/booking';
import { getCalendar, MockCalendar, resetCalendar } from '../functions/_lib/calendar';
import {
  BLACKOUT_DATES,
  CORAL_AREA,
  etParts,
  isOfferedSlot,
  slotEnd,
  slotStartsOnDate,
} from '../functions/_lib/schedule';

function at(year: number, month: number, day: number, hour: number, minute: number, area?: string) {
  return slotStartsOnDate(year, month, day, area).find((start) => {
    const parts = etParts(new Date(start));
    return parts.hour === hour && parts.minute === minute;
  });
}

afterEach(() => {
  resetBookingState();
  resetCalendar();
});

describe('Coral Springs and Parkland windows', () => {
  it('keeps Tuesday and Friday inside 2:30 PM through 6:00 PM and leaves the full day everywhere else', () => {
    expect(at(2026, 11, 3, 14, 0, CORAL_AREA)).toBeUndefined();
    expect(at(2026, 11, 3, 14, 30, CORAL_AREA)).toBeTruthy();
    expect(at(2026, 11, 3, 18, 0, CORAL_AREA)).toBeTruthy();
    expect(at(2026, 11, 3, 18, 30, CORAL_AREA)).toBeUndefined();
    expect(at(2026, 11, 6, 14, 0, CORAL_AREA)).toBeUndefined();
    expect(at(2026, 11, 6, 14, 30, CORAL_AREA)).toBeTruthy();
    expect(at(2026, 11, 6, 18, 0, CORAL_AREA)).toBeTruthy();
    expect(at(2026, 11, 6, 18, 30, CORAL_AREA)).toBeUndefined();
    expect(slotStartsOnDate(2026, 11, 4, CORAL_AREA)).toEqual([]);
    expect(at(2026, 11, 3, 8, 0)).toBeTruthy();
    expect(at(2026, 11, 3, 18, 30)).toBeTruthy();
  });

  it('does not offer a Thursday 10:00 AM start', () => {
    expect(at(2026, 11, 5, 8, 0, CORAL_AREA)).toBeTruthy();
    expect(at(2026, 11, 5, 9, 30, CORAL_AREA)).toBeTruthy();
    expect(at(2026, 11, 5, 10, 0, CORAL_AREA)).toBeUndefined();
    expect(isOfferedSlot(slotStartsOnDate(2026, 11, 5).find((start) => etParts(new Date(start)).hour === 10)!, CORAL_AREA)).toBe(false);
  });

  it('excludes the Nov 7 2026 blackout for every area', () => {
    expect(BLACKOUT_DATES).toEqual(['2026-11-07']);
    expect(slotStartsOnDate(2026, 11, 7)).toEqual([]);
    expect(slotStartsOnDate(2026, 11, 7, CORAL_AREA)).toEqual([]);
    expect(slotStartsOnDate(2026, 11, 8).length).toBeGreaterThan(0);
  });

  it('still marks a Coral Springs slot busy when the calendar is busy', async () => {
    const start = at(2026, 11, 5, 8, 0, CORAL_AREA)!;
    const calendar = getCalendar({}) as MockCalendar;
    calendar.saved.push({
      start,
      end: slotEnd(start),
      title: 'Alex',
      location: '100 Example Lane, Parkland, FL',
      description: 'Parent: Pat',
      attendeeEmail: 'pat@example.com',
      child: 'Alex',
    });
    const slots = await listSlots({}, new Date('2026-11-04T16:00:00.000Z'), 4, '200 Other Road, Coral Springs, FL', CORAL_AREA);
    expect(slots.find((slot) => slot.start === start)?.state).toBe('busy');
    expect(slots.some((slot) => etParts(new Date(slot.start)).day === 7)).toBe(false);
  });
});
