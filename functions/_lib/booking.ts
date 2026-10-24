import { getCalendar, type CalendarAdapter } from './calendar';
import { createDriveTime, type DriveTimeAdapter } from './drive-time';
import {
  bookingEventMode,
  buildBookingNotice,
  buildLessonEvents,
  deliverNotice,
  etDayKey,
  eventsOnDay,
  indexBusyIntervals,
  isPackageSchedule,
  isSlotBlocked,
  noticeTarget,
  type BuiltLessonEvent,
} from './lesson-events';
import { isProductionSurface, type SquareEnv } from './square';
import {
  CANCELLATION_POLICY,
  HOLD_MS,
  canReschedule,
  datesFrom,
  isCanonicalSlot,
  nextUsualSlot,
  slotEnd,
  slotStartsOnDate,
  usesBlockedName,
} from './schedule';
import { lessonsForItem, normalizeAddress, normalizeDob, normalizeEmail, normalizeName, normalizePhone, type ItemId } from './prices';

export { CANCELLATION_POLICY };

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
  phone: string;
  child: string;
  childDob: string;
  sibling?: string;
  siblingDob?: string;
  poolAddress: string;
  itemId: ItemId;
  lessons: Lesson[];
  createdAt: string;
};

export type Hold = {
  id: string;
  email: string;
  parent: string;
  phone: string;
  child: string;
  childDob: string;
  sibling?: string;
  siblingDob?: string;
  poolAddress: string;
  itemId: ItemId;
  slots: string[];
  expiresAt: string;
};

export type BookingEnv = SquareEnv & {
  BOOKING_TOKEN_SECRET?: string;
  BOOKING_EVENT_MODE?: string;
  BOOKING_NOTICE_TARGET?: string;
  DRIVE_TIME_MINUTES?: string;
  DRIVE_TIME_PROVIDER?: string;
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

function rememberDrive(drive: DriveTimeAdapter): DriveTimeAdapter {
  const cache = new Map<string, Promise<number>>();
  return {
    estimateMinutes(fromAddress, toAddress) {
      const key = `${fromAddress}\n${toAddress}`;
      const existing = cache.get(key);
      if (existing) return existing;
      const pending = drive.estimateMinutes(fromAddress, toAddress);
      cache.set(key, pending);
      return pending;
    },
  };
}

export async function listSlots(env: BookingEnv, now = new Date(), days = 14, poolAddress?: string): Promise<Array<{ start: string; end: string; state: 'open' | 'busy' }>> {
  const dates = datesFrom(now, days);
  const dated = dates.flatMap((date) => {
    const day = `${date.year}-${date.month}-${date.day}`;
    return slotStartsOnDate(date.year, date.month, date.day).map((start) => ({ start, day }));
  });
  const from = dated[0]?.start ?? now.toISOString();
  const to = dated.length ? slotEnd(dated[dated.length - 1].start) : now.toISOString();
  const busy = await calendarOf(env).busyIntervals(from, to);
  const held = new Set(await getStore().activeHoldStarts(now));
  const drive = rememberDrive(createDriveTime(env));
  const indexed = indexBusyIntervals(busy);
  const upcoming = dated.filter((slot) => Date.parse(slot.start) > now.getTime());
  const states = await Promise.all(upcoming.map(async (slot) => {
    const end = slotEnd(slot.start);
    const blocked = held.has(slot.start) || await isSlotBlocked(slot.start, end, poolAddress, eventsOnDay(indexed, slot.day), drive);
    return { start: slot.start, end, state: blocked ? 'busy' as const : 'open' as const };
  }));
  return states;
}

export async function issueHold(input: {
  env: BookingEnv;
  requestUrl: string;
  email: string;
  parent: string;
  phone: string;
  child: string;
  childDob: string;
  sibling?: string;
  siblingDob?: string;
  poolAddress: string;
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
  const phone = normalizePhone(input.phone);
  const childDob = normalizeDob(input.childDob);
  const poolAddress = normalizeAddress(input.poolAddress);
  const sibling = input.sibling ? normalizeName(input.sibling) : undefined;
  const siblingDob = input.sibling ? normalizeDob(input.siblingDob) : undefined;
  if (!email || !parent || !child || !phone || !childDob || !poolAddress) return { error: 'invalid-buyer' };
  if (input.sibling && (!sibling || !siblingDob)) return { error: 'invalid-buyer' };
  if (usesBlockedName(parent) || usesBlockedName(child) || (sibling && usesBlockedName(sibling))) return { error: 'invalid-buyer' };
  const itemId = input.itemId as ItemId;
  const perItem = lessonsForItem(itemId);
  if (!perItem || !Number.isInteger(input.quantity) || input.quantity < 1) return { error: 'invalid-package' };
  if (sibling && perItem === 1) return { error: 'invalid-package' };
  const needed = perItem * input.quantity;
  if (input.slots.length !== needed) return { error: 'invalid-slot-count' };
  if (new Set(input.slots).size !== input.slots.length) return { error: 'invalid-slot' };
  if (perItem > 1 && !isPackageSchedule(input.slots, Boolean(sibling))) return { error: 'invalid-slot' };
  const now = input.now ?? new Date();
  const latest = input.slots.reduce((max, start) => Math.max(max, Date.parse(start)), now.getTime());
  const days = Math.min(160, Math.max(14, Math.ceil((latest - now.getTime()) / (24 * 60 * 60 * 1000)) + 3));
  const open = new Set((await listSlots(input.env, now, days, poolAddress)).filter((slot) => slot.state === 'open').map((slot) => slot.start));
  for (const start of input.slots) {
    if (!isCanonicalSlot(start) || !open.has(start)) return { error: 'invalid-slot' };
  }
  const hold: Hold = {
    id: crypto.randomUUID(),
    email,
    parent,
    phone,
    child,
    childDob,
    sibling,
    siblingDob,
    poolAddress,
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

function lessonEvents(booking: Booking): BuiltLessonEvent[] {
  return buildLessonEvents({
    itemId: booking.itemId,
    parent: booking.parent,
    phone: booking.phone,
    email: booking.email,
    child: booking.child,
    childDob: booking.childDob,
    sibling: booking.sibling,
    siblingDob: booking.siblingDob,
    poolAddress: booking.poolAddress,
    slots: [...booking.lessons].sort((a, b) => Date.parse(a.start) - Date.parse(b.start)).map((lesson) => ({ start: lesson.start, end: lesson.end })),
  });
}

async function publishSchedule(env: BookingEnv, booking: Booking, changed: BuiltLessonEvent[]): Promise<void> {
  if (bookingEventMode(env) === 'direct') {
    if (changed.length) await calendarOf(env).saveEvents(changed);
    return;
  }
  const events = lessonEvents(booking);
  const notice = buildBookingNotice({
    target: noticeTarget(env),
    id: booking.id,
    itemId: booking.itemId,
    parent: booking.parent,
    phone: booking.phone,
    email: booking.email,
    child: booking.child,
    childDob: booking.childDob,
    sibling: booking.sibling,
    poolAddress: booking.poolAddress,
    lessons: booking.lessons.map((lesson) => {
      const event = events.find((item) => item.start === lesson.start);
      return {
        start: lesson.start,
        end: lesson.end,
        child: event?.child || booking.child,
        title: event?.title || booking.child,
        status: lesson.status,
      };
    }),
  });
  await deliverNotice(notice);
}

export async function syncBooking(env: BookingEnv, booking: Booking): Promise<void> {
  await publishSchedule(env, booking, []);
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
    phone: input.hold.phone,
    child: input.hold.child,
    childDob: input.hold.childDob,
    sibling: input.hold.sibling,
    siblingDob: input.hold.siblingDob,
    poolAddress: input.hold.poolAddress,
    itemId: input.hold.itemId,
    lessons: lessonsFromSlots(input.hold.slots),
    createdAt: now.toISOString(),
  };
  await publishSchedule(input.env, booking, lessonEvents(booking));
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
  const changed = lessonEvents(input.booking).filter((event) => event.start === lesson.start);
  await publishSchedule(input.env, input.booking, changed);
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
  const drive = createDriveTime(input.env);
  const indexed = indexBusyIntervals(busy);
  let cursor = last;
  let start: string | null = null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const candidate = nextUsualSlot(cursor, lesson.start, taken);
    if (!candidate) return { error: 'no-slot' };
    const blocked = await isSlotBlocked(candidate, slotEnd(candidate), input.booking.poolAddress, eventsOnDay(indexed, etDayKey(candidate)), drive);
    if (!blocked) {
      start = candidate;
      break;
    }
    taken.add(candidate);
    cursor = candidate;
  }
  if (!start) return { error: 'no-slot' };
  lesson.start = start;
  lesson.end = slotEnd(start);
  const changed = lessonEvents(input.booking).filter((event) => event.start === lesson.start);
  await publishSchedule(input.env, input.booking, changed);
  return { booking: input.booking, start };
}
