import {
  createSmsAdapter,
  GoogleCalendarAdapter,
  GoogleLessonTracker,
  MockCalendarAdapter,
  MockLessonTracker,
  trackerWriteStatement,
  type CalendarAdapter,
  type GoogleConfigInput,
  type LessonTracker,
  type SmsConfigInput,
} from "./adapters";
import { balanceAfterClockOut, balanceAfterUndo, type BalanceOutcome, type ClockSource } from "./clock-rules";
import { HttpError } from "./errors";
import { phaseAfterClockIn, phaseAfterClockOut, retentionCutoffIso } from "./live-location";
import { henryFamily, instructorAccount, parentAccount } from "./mock-data";
import { firstNameOnly } from "./names";
import { readSecret } from "./secrets";
import { defaultsFromEnv, settingsFromRows, settingKey, type AppSettings } from "./settings";
import type { CalendarLesson } from "./schedule";
import { addMinutesIso } from "./time";
import { randomId } from "./tokens";

export interface CurrentUser {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
  familyId: string | null;
}

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  roles: string;
  family_id: string | null;
}

export interface LessonRecord {
  id: string;
  family_id: string;
  instructor_user_id: string;
  child_first_name: string;
  starts_at: string;
  ends_at: string;
  address: string;
  lat: number;
  lng: number;
  status: string;
  family_name: string;
  lessons_remaining: number;
  clock_in_at: string | null;
  clock_out_at: string | null;
  clock_in_distance_yards: number | null;
}

export interface ParentLessonRecord {
  id: string;
  family_id: string;
  child_first_name: string;
  starts_at: string;
  ends_at: string;
  address: string;
  status: string;
  instructor_name: string;
}

export interface ReportRecord {
  lesson_id: string;
  child_first_name: string;
  starts_at: string;
  ends_at: string;
  status: string;
  family_id: string;
  family_name: string;
  lessons_remaining: number;
  clock_in_at: string | null;
  clock_out_at: string | null;
  adjustment_id: string | null;
}

function text(value: string): string {
  return value;
}

function googleConfig(env: Env): GoogleConfigInput {
  return {
    DATA_SOURCE: text(env.DATA_SOURCE),
    CALENDAR_ID: env.CALENDAR_ID,
    LESSON_TRACKER_SPREADSHEET_ID: env.LESSON_TRACKER_SPREADSHEET_ID,
    LESSON_TRACKER_RANGE: env.LESSON_TRACKER_RANGE,
    GOOGLE_SERVICE_ACCOUNT_EMAIL: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    privateKey: readSecret(env, "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY"),
  };
}

export function calendarAdapter(env: Env): CalendarAdapter {
  if (text(env.DATA_SOURCE) === "google") return new GoogleCalendarAdapter(googleConfig(env));
  return new MockCalendarAdapter(env.TIMEZONE || "America/New_York");
}

export function lessonTracker(env: Env): LessonTracker {
  if (text(env.DATA_SOURCE) === "google") return new GoogleLessonTracker(googleConfig(env));
  return new MockLessonTracker();
}

export function smsConfig(env: Env): SmsConfigInput {
  return {
    SMS_PROVIDER: env.SMS_PROVIDER,
    SMS_FROM_NUMBER: env.SMS_FROM_NUMBER,
    accountSid: readSecret(env, "SMS_ACCOUNT_SID"),
    authToken: readSecret(env, "SMS_AUTH_TOKEN"),
  };
}

export function practiceData(env: Env): boolean {
  return text(env.DATA_SOURCE) !== "google";
}

function wrote(result: D1Result): boolean {
  const changes = result.meta.changes ?? result.meta.rows_written ?? 0;
  return changes > 0;
}

function mapUser(row: UserRow): CurrentUser {
  const roles = JSON.parse(row.roles) as string[];
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    roles,
    familyId: row.family_id,
  };
}

export async function purgeLocationPoints(db: D1Database, now: Date): Promise<void> {
  await db.prepare("DELETE FROM location_points WHERE recorded_at <= ?").bind(retentionCutoffIso(now)).run();
}

export async function getSettings(env: Env): Promise<AppSettings> {
  const fallback = defaultsFromEnv(env);
  const rows = await env.DB.prepare("SELECT key, value FROM settings").all<{ key: string; value: string }>();
  return settingsFromRows(rows.results ?? [], fallback);
}

export async function saveSettings(env: Env, settings: AppSettings): Promise<void> {
  const entries = Object.entries({
    [settingKey("clockInRadiusYards")]: String(settings.clockInRadiusYards),
    [settingKey("lateThresholdMinutes")]: String(settings.lateThresholdMinutes),
    [settingKey("autoDecrementOnClockOut")]: String(settings.autoDecrementOnClockOut),
    [settingKey("arrivalTextEnabled")]: String(settings.arrivalTextEnabled),
    [settingKey("arrivalTextMinutes")]: String(settings.arrivalTextMinutes),
  });
  await env.DB.batch(
    entries.map(([key, value]) =>
      env.DB.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(key, value),
    ),
  );
}

export async function ensureReady(env: Env, now = new Date()): Promise<void> {
  await purgeLocationPoints(env.DB, now);
  await seedDirectory(env, now);
  await syncLessons(env, now);
}

async function seedDirectory(env: Env, now: Date): Promise<void> {
  const existing = await env.DB.prepare("SELECT value FROM settings WHERE key = 'seeded_at'").first<{ value: string }>();
  if (existing) return;
  const createdAt = now.toISOString();
  const settings = defaultsFromEnv(env);
  const childName = firstNameOnly(henryFamily.childFirstName);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO users (id, email, display_name, roles, family_id, created_at) VALUES (?, ?, ?, ?, NULL, ?)`,
    ).bind(instructorAccount.id, instructorAccount.email, instructorAccount.displayName, JSON.stringify(instructorAccount.roles), createdAt),
    env.DB.prepare(
      `INSERT OR IGNORE INTO users (id, email, display_name, roles, family_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(parentAccount.id, parentAccount.email, parentAccount.displayName, JSON.stringify(parentAccount.roles), henryFamily.id, createdAt),
    env.DB.prepare(
      `INSERT OR IGNORE INTO families (id, name, instructor_user_id, parent_user_id, phone, lessons_remaining, balance_initialized, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
    ).bind(
      henryFamily.id,
      henryFamily.name,
      instructorAccount.id,
      parentAccount.id,
      henryFamily.phone,
      henryFamily.lessonsRemaining,
      createdAt,
    ),
    env.DB.prepare("INSERT OR IGNORE INTO children (id, family_id, first_name) VALUES (?, ?, ?)").bind(henryFamily.childId, henryFamily.id, childName),
    env.DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('seeded_at', ?)").bind(createdAt),
    env.DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)").bind(settingKey("clockInRadiusYards"), String(settings.clockInRadiusYards)),
    env.DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)").bind(settingKey("lateThresholdMinutes"), String(settings.lateThresholdMinutes)),
    env.DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)").bind(settingKey("autoDecrementOnClockOut"), String(settings.autoDecrementOnClockOut)),
    env.DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)").bind(settingKey("arrivalTextEnabled"), String(settings.arrivalTextEnabled)),
    env.DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)").bind(settingKey("arrivalTextMinutes"), String(settings.arrivalTextMinutes)),
    trackerWriteStatement(env.DB, {
      id: `track_open_${henryFamily.id}`,
      familyId: henryFamily.id,
      lessonsRemaining: henryFamily.lessonsRemaining,
      reason: "Opening balance from the lesson tracker",
      createdAt,
    }, "stub"),
  ]);
}

async function syncLessons(env: Env, now: Date): Promise<void> {
  const lessons = await calendarAdapter(env).listLessons(now);
  const instructor = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(instructorAccount.email).first<{ id: string }>();
  if (!instructor) return;
  for (const lesson of lessons) {
    await upsertLesson(env, lesson, instructor.id, now);
    if (lesson.demoHistory && Date.parse(lesson.endsAt) < now.getTime()) {
      await applyDemoHistory(env, lesson, instructor.id, now);
    }
  }
}

async function upsertLesson(env: Env, lesson: CalendarLesson, instructorId: string, now: Date): Promise<void> {
  const child = firstNameOnly(lesson.childFirstName);
  await env.DB.prepare(
    `INSERT INTO lessons (
      id, calendar_event_id, family_id, instructor_user_id, child_first_name, starts_at, ends_at, address, lat, lng, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?)
    ON CONFLICT(calendar_event_id) DO UPDATE SET
      starts_at = excluded.starts_at,
      ends_at = excluded.ends_at,
      address = excluded.address,
      lat = excluded.lat,
      lng = excluded.lng,
      child_first_name = excluded.child_first_name
    WHERE lessons.status = 'scheduled'`,
  ).bind(
    lesson.calendarEventId,
    lesson.calendarEventId,
    lesson.familyId,
    instructorId,
    child,
    lesson.startsAt,
    lesson.endsAt,
    lesson.address,
    lesson.lat,
    lesson.lng,
    now.toISOString(),
  ).run();
}

async function applyDemoHistory(env: Env, lesson: CalendarLesson, instructorId: string, now: Date): Promise<void> {
  if (!lesson.demoHistory) return;
  const existing = await env.DB.prepare("SELECT id FROM time_entries WHERE lesson_id = ?").bind(lesson.calendarEventId).first<{ id: string }>();
  if (existing) return;
  const clockIn = addMinutesIso(lesson.startsAt, lesson.demoHistory.clockInOffsetMinutes);
  const clockOut = addMinutesIso(lesson.startsAt, lesson.demoHistory.clockOutOffsetMinutes);
  const createdAt = now.toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO time_entries (
        id, lesson_id, instructor_user_id, clock_in_at, clock_out_at, clock_in_distance_yards, clock_out_distance_yards, clock_in_source, clock_out_source, created_at
      ) VALUES (?, ?, ?, ?, ?, 0, 0, 'preview', 'preview', ?)`,
    ).bind(`time_${lesson.calendarEventId}`, lesson.calendarEventId, instructorId, clockIn, clockOut, createdAt),
    env.DB.prepare("UPDATE lessons SET status = 'completed' WHERE id = ? AND status = 'scheduled'").bind(lesson.calendarEventId),
    env.DB.prepare(
      `INSERT OR IGNORE INTO balance_adjustments (id, family_id, lesson_id, delta, reason, created_at, undone_at)
       VALUES (?, ?, ?, -1, ?, ?, NULL)`,
    ).bind(
      `adj_${lesson.calendarEventId}`,
      lesson.familyId,
      lesson.calendarEventId,
      "Practice lesson already counted in the opening balance",
      createdAt,
    ),
  ]);
}

export async function findUserByEmail(env: Env, email: string): Promise<CurrentUser | null> {
  const row = await env.DB.prepare("SELECT id, email, display_name, roles, family_id FROM users WHERE email = ?").bind(email).first<UserRow>();
  return row ? mapUser(row) : null;
}

export async function userFromSession(env: Env, tokenHash: string, now: Date): Promise<CurrentUser | null> {
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.display_name, u.roles, u.family_id, s.expires_at, s.id AS session_id
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
  ).bind(tokenHash).first<UserRow & { expires_at: string; session_id: string }>();
  if (!row) return null;
  if (Date.parse(row.expires_at) <= now.getTime()) {
    await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(row.session_id).run();
    return null;
  }
  return mapUser(row);
}

export async function latestUnusedLink(env: Env, email: string, now: Date): Promise<{ token_hash: string; created_at: string } | null> {
  return env.DB.prepare(
    `SELECT token_hash, created_at FROM magic_links
     WHERE email = ? AND used_at IS NULL AND expires_at > ?
     ORDER BY created_at DESC LIMIT 1`,
  ).bind(email, now.toISOString()).first<{ token_hash: string; created_at: string }>();
}

export async function saveMagicLink(env: Env, email: string, tokenHash: string, expiresAt: string, now: Date): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO magic_links (id, email, token_hash, expires_at, used_at, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
  ).bind(randomId("link"), email, tokenHash, expiresAt, now.toISOString()).run();
}

export async function consumeMagicLink(env: Env, tokenHash: string, now: Date): Promise<string | null> {
  const row = await env.DB.prepare(
    "SELECT id, email, expires_at, used_at FROM magic_links WHERE token_hash = ?",
  ).bind(tokenHash).first<{ id: string; email: string; expires_at: string; used_at: string | null }>();
  if (!row || row.used_at || Date.parse(row.expires_at) <= now.getTime()) return null;
  const result = await env.DB.prepare("UPDATE magic_links SET used_at = ? WHERE id = ? AND used_at IS NULL").bind(now.toISOString(), row.id).run();
  if (!wrote(result)) return null;
  return row.email;
}

export async function saveSession(env: Env, userId: string, tokenHash: string, expiresAt: string, now: Date): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
  ).bind(randomId("session"), userId, tokenHash, expiresAt, now.toISOString()).run();
}

export async function deleteSession(env: Env, tokenHash: string): Promise<void> {
  await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
}

export async function saveOutbound(env: Env, channel: string, recipient: string, body: string, provider: string, status: string, now: Date): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO outbound_messages (id, channel, recipient, body, provider, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).bind(randomId("msg"), channel, recipient, body, provider, status, now.toISOString()).run();
}

export async function parentHome(env: Env, familyId: string, dayStartIso: string): Promise<{
  familyName: string;
  lessonsRemaining: number;
  instructorName: string;
  children: string[];
  lessons: ParentLessonRecord[];
} | null> {
  const family = await env.DB.prepare(
    `SELECT f.name, f.lessons_remaining, u.display_name AS instructor_name
     FROM families f JOIN users u ON u.id = f.instructor_user_id WHERE f.id = ?`,
  ).bind(familyId).first<{ name: string; lessons_remaining: number; instructor_name: string }>();
  if (!family) return null;
  const children = await env.DB.prepare("SELECT first_name FROM children WHERE family_id = ? ORDER BY first_name").bind(familyId).all<{ first_name: string }>();
  const lessons = await env.DB.prepare(
    `SELECT l.id, l.family_id, l.child_first_name, l.starts_at, l.ends_at, l.address, l.status, u.display_name AS instructor_name
     FROM lessons l JOIN users u ON u.id = l.instructor_user_id
     WHERE l.family_id = ? AND l.status IN ('scheduled', 'in_progress') AND l.starts_at >= ?
     ORDER BY l.starts_at`,
  ).bind(familyId, dayStartIso).all<ParentLessonRecord>();
  return {
    familyName: family.name,
    lessonsRemaining: family.lessons_remaining,
    instructorName: family.instructor_name,
    children: (children.results ?? []).map((row) => row.first_name),
    lessons: lessons.results ?? [],
  };
}

export async function instructorToday(env: Env, instructorId: string, startIso: string, endIso: string): Promise<LessonRecord[]> {
  const rows = await env.DB.prepare(
    `SELECT l.id, l.family_id, l.instructor_user_id, l.child_first_name, l.starts_at, l.ends_at, l.address, l.lat, l.lng, l.status,
            f.name AS family_name, f.lessons_remaining, t.clock_in_at, t.clock_out_at, t.clock_in_distance_yards
     FROM lessons l
     JOIN families f ON f.id = l.family_id
     LEFT JOIN time_entries t ON t.lesson_id = l.id
     WHERE l.instructor_user_id = ? AND l.starts_at >= ? AND l.starts_at < ?
     ORDER BY l.starts_at`,
  ).bind(instructorId, startIso, endIso).all<LessonRecord>();
  return rows.results ?? [];
}

async function ownedLesson(env: Env, lessonId: string, instructorId: string): Promise<LessonRecord | null> {
  return env.DB.prepare(
    `SELECT l.id, l.family_id, l.instructor_user_id, l.child_first_name, l.starts_at, l.ends_at, l.address, l.lat, l.lng, l.status,
            f.name AS family_name, f.lessons_remaining, t.clock_in_at, t.clock_out_at, t.clock_in_distance_yards
     FROM lessons l
     JOIN families f ON f.id = l.family_id
     LEFT JOIN time_entries t ON t.lesson_id = l.id
     WHERE l.id = ? AND l.instructor_user_id = ?`,
  ).bind(lessonId, instructorId).first<LessonRecord>();
}

export async function hasOtherOpenLesson(env: Env, instructorId: string, lessonId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    "SELECT id FROM lessons WHERE instructor_user_id = ? AND status = 'in_progress' AND id != ? LIMIT 1",
  ).bind(instructorId, lessonId).first<{ id: string }>();
  return Boolean(row);
}

export async function clockInLesson(
  env: Env,
  lesson: LessonRecord,
  source: ClockSource,
  distanceYards: number,
  now: Date,
): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO time_entries (
        id, lesson_id, instructor_user_id, clock_in_at, clock_out_at, clock_in_distance_yards, clock_out_distance_yards, clock_in_source, clock_out_source, created_at
      ) VALUES (?, ?, ?, ?, NULL, ?, NULL, ?, NULL, ?)`,
    ).bind(randomId("time"), lesson.id, lesson.instructor_user_id, now.toISOString(), distanceYards, source, now.toISOString()),
    env.DB.prepare("UPDATE lessons SET status = 'in_progress' WHERE id = ? AND status = 'scheduled'").bind(lesson.id),
    env.DB.prepare("UPDATE en_route_sessions SET phase = ? WHERE lesson_id = ? AND ended_at IS NULL").bind(phaseAfterClockIn(), lesson.id),
  ]);
}

export async function clockOutLesson(
  env: Env,
  lesson: LessonRecord,
  source: ClockSource,
  distanceYards: number,
  now: Date,
): Promise<{ outcome: BalanceOutcome; lessonsRemaining: number }> {
  const settings = await getSettings(env);
  const adjustment = await env.DB.prepare(
    "SELECT id FROM balance_adjustments WHERE lesson_id = ? AND delta < 0 AND undone_at IS NULL",
  ).bind(lesson.id).first<{ id: string }>();
  const family = await env.DB.prepare("SELECT lessons_remaining FROM families WHERE id = ?").bind(lesson.family_id).first<{ lessons_remaining: number }>();
  const current = family?.lessons_remaining ?? 0;
  const next = balanceAfterClockOut({
    current,
    auto: settings.autoDecrementOnClockOut,
    alreadyDecremented: Boolean(adjustment),
  });
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      "UPDATE time_entries SET clock_out_at = ?, clock_out_distance_yards = ?, clock_out_source = ? WHERE lesson_id = ?",
    ).bind(now.toISOString(), distanceYards, source, lesson.id),
    env.DB.prepare("UPDATE lessons SET status = 'completed' WHERE id = ?").bind(lesson.id),
    env.DB.prepare(
      "UPDATE en_route_sessions SET phase = ?, ended_at = ?, end_reason = 'clock_out' WHERE lesson_id = ? AND ended_at IS NULL",
    ).bind(phaseAfterClockOut(), now.toISOString(), lesson.id),
  ];
  if (next.delta !== 0 && text(env.DATA_SOURCE) !== "google") {
    statements.push(
      env.DB.prepare("UPDATE families SET lessons_remaining = ? WHERE id = ?").bind(next.balance, lesson.family_id),
      env.DB.prepare(
        "INSERT INTO balance_adjustments (id, family_id, lesson_id, delta, reason, created_at, undone_at) VALUES (?, ?, ?, ?, ?, ?, NULL)",
      ).bind(randomId("adj"), lesson.family_id, lesson.id, next.delta, "Subtracted at clock out", now.toISOString()),
      trackerWriteStatement(env.DB, {
        id: randomId("track"),
        familyId: lesson.family_id,
        lessonsRemaining: next.balance,
        reason: "Subtracted at clock out",
        createdAt: now.toISOString(),
      }, "stub"),
    );
  } else if (next.delta !== 0) {
    statements.push(
      env.DB.prepare("UPDATE families SET lessons_remaining = ? WHERE id = ?").bind(next.balance, lesson.family_id),
      env.DB.prepare(
        "INSERT INTO balance_adjustments (id, family_id, lesson_id, delta, reason, created_at, undone_at) VALUES (?, ?, ?, ?, ?, ?, NULL)",
      ).bind(randomId("adj"), lesson.family_id, lesson.id, next.delta, "Subtracted at clock out", now.toISOString()),
    );
  }
  if (next.delta !== 0 && text(env.DATA_SOURCE) === "google") {
    await lessonTracker(env).writeBalance(env.DB, {
      id: randomId("track"),
      familyId: lesson.family_id,
      lessonsRemaining: next.balance,
      reason: "Subtracted at clock out",
      createdAt: now.toISOString(),
    });
  }
  await env.DB.batch(statements);
  return { outcome: next.outcome, lessonsRemaining: next.balance };
}

export async function loadOwnedLesson(env: Env, lessonId: string, instructorId: string): Promise<LessonRecord> {
  const lesson = await ownedLesson(env, lessonId, instructorId);
  if (!lesson) throw new HttpError(404, "That lesson is not on your list.");
  return lesson;
}

export async function reportRows(env: Env, startIso: string, endIso: string): Promise<{ families: Array<{ name: string; lessonsRemaining: number }>; rows: ReportRecord[] }> {
  const families = await env.DB.prepare("SELECT name, lessons_remaining FROM families ORDER BY name").all<{ name: string; lessons_remaining: number }>();
  const rows = await env.DB.prepare(
    `SELECT l.id AS lesson_id, l.child_first_name, l.starts_at, l.ends_at, l.status, l.family_id,
            f.name AS family_name, f.lessons_remaining, t.clock_in_at, t.clock_out_at, a.id AS adjustment_id
     FROM lessons l
     JOIN families f ON f.id = l.family_id
     LEFT JOIN time_entries t ON t.lesson_id = l.id
     LEFT JOIN balance_adjustments a ON a.lesson_id = l.id AND a.delta < 0 AND a.undone_at IS NULL
     WHERE l.starts_at >= ? AND l.starts_at < ?
     ORDER BY l.starts_at ASC`,
  ).bind(startIso, endIso).all<ReportRecord>();
  return {
    families: (families.results ?? []).map((row) => ({ name: row.name, lessonsRemaining: row.lessons_remaining })),
    rows: rows.results ?? [],
  };
}

export async function undoDecrement(env: Env, lessonId: string, now: Date): Promise<{ lessonsRemaining: number }> {
  const adjustment = await env.DB.prepare(
    "SELECT id, family_id, delta FROM balance_adjustments WHERE lesson_id = ? AND delta < 0 AND undone_at IS NULL",
  ).bind(lessonId).first<{ id: string; family_id: string; delta: number }>();
  if (!adjustment) throw new HttpError(409, "There is no lesson count change to undo.");
  const family = await env.DB.prepare("SELECT lessons_remaining FROM families WHERE id = ?").bind(adjustment.family_id).first<{ lessons_remaining: number }>();
  if (!family) throw new HttpError(404, "That lesson is not on your list.");
  const restored = balanceAfterUndo(family.lessons_remaining);
  if (text(env.DATA_SOURCE) === "google") {
    await lessonTracker(env).writeBalance(env.DB, {
      id: randomId("track"),
      familyId: adjustment.family_id,
      lessonsRemaining: restored,
      reason: "Admin restored the lesson count",
      createdAt: now.toISOString(),
    });
  }
  const claimed = await env.DB.prepare("UPDATE balance_adjustments SET undone_at = ? WHERE id = ? AND undone_at IS NULL").bind(now.toISOString(), adjustment.id).run();
  if (!wrote(claimed)) throw new HttpError(409, "There is no lesson count change to undo.");
  const writes: D1PreparedStatement[] = [
    env.DB.prepare("UPDATE families SET lessons_remaining = ? WHERE id = ?").bind(restored, adjustment.family_id),
  ];
  if (text(env.DATA_SOURCE) !== "google") {
    writes.push(trackerWriteStatement(env.DB, {
      id: randomId("track"),
      familyId: adjustment.family_id,
      lessonsRemaining: restored,
      reason: "Admin restored the lesson count",
      createdAt: now.toISOString(),
    }, "stub"));
  }
  await env.DB.batch(writes);
  return { lessonsRemaining: restored };
}

export function arrivalSmsAdapter(env: Env) {
  return createSmsAdapter(smsConfig(env));
}
