import { getCalendar, type CalendarAdapter, type CalendarEvent } from './calendar';
import { isProductionSurface, type SquareEnv } from './square';
import {
  CANCELLATION_POLICY,
  DEFAULT_EVENT_TITLE,
  HOLD_MS,
  canReschedule,
  datesFrom,
  eventTitle,
  isCanonicalSlot,
  nextUsualSlot,
  slotEnd,
  slotStartsOnDate,
  usesBlockedName,
} from './schedule';
import { lessonsForItem, normalizeEmail, normalizeName, type ItemId } from './prices';

export { CANCELLATION_POLICY, DEFAULT_EVENT_TITLE };

export const PREVIEW_BOOKING_KEY = 'preview-mock-booking-key';
export const MAIL_FROM = 'info@safeswimmingschool.com';

export type LessonStatus = 'scheduled' | 'taught';

export type Lesson = {
  id: string;
  start: string;
  end: string;
  status: LessonStatus;
};

export type Booking = {
  id: string;
  email: string;
  parent: string;
  child: string;
  itemId: ItemId;
  lessons: Lesson[];
  createdAt: string;
};

export type Hold = {
  id: string;
  email: string;
  parent: string;
  child: string;
  itemId: ItemId;
  slots: string[];
  expiresAt: string;
};

export type BookingEnv = SquareEnv & {
  BOOKING_TOKEN_SECRET?: string;
  BOOKING_EVENT_TITLE?: string;
  GOOGLE_SERVICE_ACCOUNT_JSON?: string;
  GOOGLE_CALENDAR_ID?: string;
  GOOGLE_SHEET_ID?: string;
};

export function bookingSecret(env: BookingEnv, requestUrl: string): string | null {
  if (env.BOOKING_TOKEN_SECRET) return env.BOOKING_TOKEN_SECRET;
  if (isProductionSurface(env, requestUrl)) return null;
  return PREVIEW_BOOKING_KEY;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmac(secret: string, body: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i += 1) mismatch |= left[i] ^ right[i];
  return mismatch === 0;
}

export async function signToken(payload: unknown, secret: string): Promise<string> {
  const body = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await hmac(secret, body);
  return `${body}.${bytesToBase64Url(signature)}`;
}

export async function readToken<T>(token: string, secret: string): Promise<T | null> {
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const expected = await hmac(secret, parts[0]);
  let actual: Uint8Array;
  try {
    actual = base64UrlToBytes(parts[1]);
  } catch {
    return null;
  }
  if (!sameBytes(expected, actual)) return null;
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlToBytes(parts[0]))) as T;
  } catch {
    return null;
  }
}

export interface BookingStore {
  saveHold(hold: Hold): Promise<void>;
  getHold(id: string): Promise<Hold | null>;
  deleteHold(id: string): Promise<void>;
  activeHoldStarts(now: Date): Promise<string[]>;
}

export class MemoryBookingStore implements BookingStore {
  holds = new Map<string, Hold>();

  async saveHold(hold: Hold): Promise<void> {
    this.holds.set(hold.id, hold);
  }

  async getHold(id: string): Promise<Hold | null> {
    return this.holds.get(id) ?? null;
  }

  async deleteHold(id: string): Promise<void> {
    this.holds.delete(id);
  }

  async activeHoldStarts(now: Date): Promise<string[]> {
    const starts: string[] = [];
    for (const hold of this.holds.values()) {
      if (Date.parse(hold.expiresAt) <= now.getTime()) continue;
      starts.push(...hold.slots);
    }
    return starts;
  }
}

type StoreGlobal = typeof globalThis & { __sssStore?: MemoryBookingStore };

export function resetBookingState(): void {
  (globalThis as StoreGlobal).__sssStore = new MemoryBookingStore();
}

export function getStore(): BookingStore {
  const g = globalThis as StoreGlobal;
  if (!g.__sssStore) g.__sssStore = new MemoryBookingStore();
  return g.__sssStore;
}

function calendarOf(env: BookingEnv): CalendarAdapter {
  return getCalendar(env);
}

export async function listSlots(env: BookingEnv, now = new Date(), days = 14): Promise<Array<{ start: string; end: string; state: 'open' | 'busy' }>> {
  const dates = datesFrom(now, days);
  const starts = dates.flatMap((date) => slotStartsOnDate(date.year, date.month, date.day));
  const from = starts[0] ?? now.toISOString();
  const to = starts.length ? slotEnd(starts[starts.length - 1]) : now.toISOString();
  const busy = await calendarOf(env).busyIntervals(from, to);
  const held = new Set(await getStore().activeHoldStarts(now));
  return starts.filter((start) => Date.parse(start) > now.getTime()).map((start) => {
    const end = slotEnd(start);
    const overlaps = busy.some((interval) => interval.start < end && interval.end > start);
    const state = overlaps || held.has(start) ? 'busy' : 'open';
    return { start, end, state };
  });
}

export async function issueHold(input: {
  env: BookingEnv;
  requestUrl: string;
  email: string;
  parent: string;
  child: string;
  itemId: string;
  quantity: number;
  slots: string[];
  now?: Date;
}): Promise<{ token: string; hold: Hold } | { error: string }> {
  const secret = bookingSecret(input.env, input.requestUrl);
  if (!secret) return { error: 'unavailable' };
  const email = normalizeEmail(input.email);
  const parent = normalizeName(input.parent);
  const child = normalizeName(input.child);
  if (!email || !parent || !child) return { error: 'invalid-buyer' };
  if (usesBlockedName(parent) || usesBlockedName(child)) return { error: 'invalid-buyer' };
  const itemId = input.itemId as ItemId;
  const perItem = lessonsForItem(itemId);
  if (!perItem || !Number.isInteger(input.quantity) || input.quantity < 1) return { error: 'invalid-package' };
  const needed = perItem * input.quantity;
  if (input.slots.length !== needed) return { error: 'invalid-slot-count' };
  if (new Set(input.slots).size !== input.slots.length) return { error: 'invalid-slot' };
  const now = input.now ?? new Date();
  const open = new Set((await listSlots(input.env, now)).filter((slot) => slot.state === 'open').map((slot) => slot.start));
  for (const start of input.slots) {
    if (!isCanonicalSlot(start) || !open.has(start)) return { error: 'invalid-slot' };
  }
  const hold: Hold = {
    id: crypto.randomUUID(),
    email,
    parent,
    child,
    itemId,
    slots: [...input.slots].sort(),
    expiresAt: new Date(now.getTime() + HOLD_MS).toISOString(),
  };
  await getStore().saveHold(hold);
  return { token: await signToken(hold, secret), hold };
}

export async function verifyHold(token: string, secret: string, now = new Date()): Promise<Hold | null> {
  const hold = await readToken<Hold>(token, secret);
  if (!hold || typeof hold.id !== 'string' || !Array.isArray(hold.slots) || typeof hold.expiresAt !== 'string') return null;
  if (Date.parse(hold.expiresAt) <= now.getTime()) return null;
  return hold;
}

export async function releaseHold(holdId: string): Promise<void> {
  await getStore().deleteHold(holdId);
}

export function lessonsFromSlots(slots: string[]): Lesson[] {
  return [...slots].sort().map((start) => ({
    id: crypto.randomUUID(),
    start,
    end: slotEnd(start),
    status: 'scheduled' as const,
  }));
}

export async function confirmHold(input: {
  env: BookingEnv;
  requestUrl: string;
  hold: Hold;
  origin: string;
  now?: Date;
}): Promise<{ booking: Booking; token: string; manageUrl: string; confirmationUrl: string }> {
  const secret = bookingSecret(input.env, input.requestUrl);
  if (!secret) throw new Error('missing booking secret');
  const now = input.now ?? new Date();
  const booking: Booking = {
    id: crypto.randomUUID(),
    email: input.hold.email,
    parent: input.hold.parent,
    child: input.hold.child,
    itemId: input.hold.itemId,
    lessons: lessonsFromSlots(input.hold.slots),
    createdAt: now.toISOString(),
  };
  const template = input.env.BOOKING_EVENT_TITLE || DEFAULT_EVENT_TITLE;
  const events: CalendarEvent[] = booking.lessons.map((lesson) => ({
    start: lesson.start,
    end: lesson.end,
    title: eventTitle(template, booking.child, booking.parent),
  }));
  await calendarOf(input.env).saveEvents(events);
  await releaseHold(input.hold.id);
  const token = await signToken(booking, secret);
  const manageUrl = `${input.origin}/booking/manage/?token=${encodeURIComponent(token)}`;
  const confirmationUrl = `${input.origin}/booking/confirmed/?token=${encodeURIComponent(token)}`;
  console.log(JSON.stringify({ mail: 'stubbed', from: MAIL_FROM }));
  return { booking, token, manageUrl, confirmationUrl };
}

export async function readBooking(token: string, secret: string): Promise<Booking | null> {
  const booking = await readToken<Booking>(token, secret);
  if (!booking || !Array.isArray(booking.lessons) || typeof booking.email !== 'string') return null;
  return booking;
}

function occupiedStarts(booking: Booking, exceptId?: string): Set<string> {
  return new Set(booking.lessons.filter((lesson) => lesson.id !== exceptId && lesson.status === 'scheduled').map((lesson) => lesson.start));
}

export async function rescheduleLesson(input: {
  env: BookingEnv;
  booking: Booking;
  lessonId: string;
  start: string;
  now?: Date;
}): Promise<{ booking: Booking } | { error: string }> {
  const now = input.now ?? new Date();
  const lesson = input.booking.lessons.find((item) => item.id === input.lessonId);
  if (!lesson || lesson.status !== 'scheduled') return { error: 'invalid-lesson' };
  if (!canReschedule(lesson.start, now)) return { error: 'counts-as-taught' };
  if (!isCanonicalSlot(input.start)) return { error: 'invalid-slot' };
  const taken = occupiedStarts(input.booking, lesson.id);
  if (taken.has(input.start)) return { error: 'invalid-slot' };
  const open = new Set((await listSlots(input.env, now, 60)).filter((slot) => slot.state === 'open').map((slot) => slot.start));
  if (!open.has(input.start) && input.start !== lesson.start) return { error: 'invalid-slot' };
  lesson.start = input.start;
  lesson.end = slotEnd(input.start);
  const template = input.env.BOOKING_EVENT_TITLE || DEFAULT_EVENT_TITLE;
  await calendarOf(input.env).saveEvents([{
    start: lesson.start,
    end: lesson.end,
    title: eventTitle(template, input.booking.child, input.booking.parent),
  }]);
  return { booking: input.booking };
}

export async function countLesson(booking: Booking, lessonId: string, now = new Date()): Promise<{ booking: Booking } | { error: string }> {
  const lesson = booking.lessons.find((item) => item.id === lessonId);
  if (!lesson || lesson.status !== 'scheduled') return { error: 'invalid-lesson' };
  if (canReschedule(lesson.start, now)) return { error: 'outside-24-hours' };
  lesson.status = 'taught';
  return { booking };
}

export async function moveLessonToEnd(input: {
  env: BookingEnv;
  booking: Booking;
  lessonId: string;
  now?: Date;
}): Promise<{ booking: Booking; start: string } | { error: string }> {
  const now = input.now ?? new Date();
  const lesson = input.booking.lessons.find((item) => item.id === input.lessonId);
  if (!lesson || lesson.status !== 'scheduled') return { error: 'invalid-lesson' };
  if (!canReschedule(lesson.start, now)) return { error: 'counts-as-taught' };
  const last = input.booking.lessons.filter((item) => item.status === 'scheduled').map((item) => item.start).sort().at(-1);
  if (!last) return { error: 'invalid-lesson' };
  const taken = occupiedStarts(input.booking, lesson.id);
  const busy = await calendarOf(input.env).busyIntervals(last, new Date(Date.parse(last) + 370 * 24 * 60 * 60 * 1000).toISOString());
  for (const interval of busy) taken.add(interval.start);
  const start = nextUsualSlot(last, lesson.start, taken);
  if (!start) return { error: 'no-slot' };
  lesson.start = start;
  lesson.end = slotEnd(start);
  const template = input.env.BOOKING_EVENT_TITLE || DEFAULT_EVENT_TITLE;
  await calendarOf(input.env).saveEvents([{
    start: lesson.start,
    end: lesson.end,
    title: eventTitle(template, input.booking.child, input.booking.parent),
  }]);
  return { booking: input.booking, start };
}
