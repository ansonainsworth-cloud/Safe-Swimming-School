// src/geo.ts
var EARTH_RADIUS_METERS = 6371e3;
var METERS_PER_YARD = 0.9144;
function distanceYards(from, to) {
  const toRad = (degrees) => degrees * Math.PI / 180;
  const dLat = toRad(to.lat - from.lat);
  const dLng = toRad(to.lng - from.lng);
  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const meters = 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
  return meters / METERS_PER_YARD;
}
function readLatLng(lat, lng) {
  if (!isLatLng(lat, lng) || typeof lng !== "number") return null;
  return { lat, lng };
}
function isLatLng(lat, lng) {
  return typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

// src/errors.ts
var HttpError = class extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.name = "HttpError";
  }
  status;
};

// src/http.ts
var MAX_BODY = 65536;
function json(data, status = 200, extra) {
  const headers = new Headers(extra);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  return new Response(JSON.stringify(data), { status, headers });
}
async function readJson(request) {
  const claimed = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(claimed) && claimed > MAX_BODY) {
    throw new HttpError(413, "That request is too large.");
  }
  const text2 = await request.text();
  if (text2.length > MAX_BODY) throw new HttpError(413, "That request is too large.");
  if (!text2.trim()) return {};
  try {
    return JSON.parse(text2);
  } catch {
    throw new HttpError(400, "That request could not be read.");
  }
}
function readCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}
function sessionCookie(token, maxAgeSeconds, secure) {
  const parts = [`sss_session=${encodeURIComponent(token)}`, "HttpOnly", "Path=/", "SameSite=Lax", `Max-Age=${maxAgeSeconds}`];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}
function assertSameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const expected = new URL(request.url).origin;
  if (origin !== expected) throw new HttpError(403, "Sign in again.");
}

// src/messages.ts
var messages = {
  emailRequired: "Enter an email address.",
  emailInvalid: "Enter a valid email address.",
  linkReady: "If that email is on the list, a sign in link is ready.",
  linkInvalid: "This sign in link is not valid anymore. Request a new one.",
  signInAgain: "Sign in again.",
  clockInFirst: "Clock in before you clock out.",
  alreadyFinished: "This lesson is already finished.",
  alreadyClockedIn: "This lesson is already clocked in.",
  otherLessonOpen: "Clock out of the open lesson before you clock in to another.",
  previewOff: "Preview location is turned off.",
  locationRequired: "Location is required to clock in.",
  locationRequiredOut: "Location is required to clock out.",
  notYourLesson: "That lesson is not on your list.",
  instructorOnly: "Only an instructor can do that.",
  adminOnly: "Only an admin can open that.",
  parentOnly: "Only a parent can open that.",
  notToday: "Clock in is available on the day of the lesson.",
  clockedIn: "Clocked in.",
  clockedOutSubtracted: "Clocked out. One lesson was subtracted from the family count.",
  clockedOutUnchanged: "Clocked out. The lesson count was not changed.",
  clockedOutNoneLeft: "Clocked out. No lessons were left to subtract.",
  nothingToUndo: "There is no lesson count change to undo.",
  undone: "The lesson count was restored.",
  saved: "Saved.",
  radiusRange: "Enter a radius between 25 and 500 yards.",
  lateRange: "Enter a late threshold between 0 and 30 minutes.",
  arrivalRange: "Enter a text time between 1 and 30 minutes.",
  badSettings: "Check the settings and try again.",
  genericError: "Something went wrong. Try again.",
  notAvailable: "That action is not available.",
  tooLarge: "That request is too large.",
  badJson: "That request could not be read.",
  calendarNotConnected: "The lesson calendar is not connected yet.",
  trackerNotConnected: "The lesson tracker is not connected yet.",
  smsNotConfigured: "Text messages are not configured yet.",
  practiceData: "Practice data until the calendar and lesson tracker are connected.",
  onTime: "On time",
  late: "Late",
  notYet: "Not yet",
  stillInLesson: "Still in the lesson",
  upcoming: "Upcoming",
  inProgress: "In progress",
  finished: "Finished",
  notClockedIn: "Not clocked in"
};
function tooFarMessage(action, yards, limit) {
  return `You are about ${Math.round(yards)} yards away. Stay within ${limit} yards of the pool to ${action}.`;
}
function minutesLateLabel(minutes) {
  const rounded = Math.max(1, Math.round(minutes));
  return rounded === 1 ? "1 minute late" : `${rounded} minutes late`;
}

// src/mock-data.ts
var instructorAccount = {
  id: "user_anson",
  email: "anson@example.com",
  displayName: "Anson Ainsworth",
  roles: ["instructor", "admin"]
};
var parentAccount = {
  id: "user_henry_family",
  email: "henry.family@example.com",
  displayName: "Henry's family",
  roles: ["parent"]
};
var henryFamily = {
  id: "family_henry",
  name: "Henry's family",
  phone: "+15555501098",
  lessonsRemaining: 8,
  childId: "child_henry",
  childFirstName: "Henry",
  address: "100 Sample Court, Jupiter, FL 33458",
  lat: 26.9342,
  lng: -80.0942
};
var previewAccounts = [
  { label: "Anson", email: instructorAccount.email },
  { label: "Henry's family", email: parentAccount.email }
];

// src/clock-rules.ts
function evaluateClockIn(input) {
  if (input.status === "completed") return { ok: false, error: "This lesson is already finished." };
  if (input.status === "in_progress") return { ok: false, error: "This lesson is already clocked in." };
  if (!input.sameDay) return { ok: false, error: "Clock in is available on the day of the lesson." };
  if (input.anotherOpen) return { ok: false, error: "Clock out of the open lesson before you clock in to another." };
  return checkPlace(input, "clock in");
}
function evaluateClockOut(input) {
  if (input.status === "completed") return { ok: false, error: "This lesson is already finished." };
  if (input.status !== "in_progress") return { ok: false, error: "Clock in before you clock out." };
  return checkPlace(input, "clock out");
}
function checkPlace(input, action) {
  if (input.preview) {
    if (!input.previewAllowed) return { ok: false, error: "Preview location is turned off." };
    return { ok: true, source: "preview", distanceYards: 0 };
  }
  if (!input.hasDeviceLocation || input.distanceYards == null) {
    return { ok: false, error: action === "clock in" ? "Location is required to clock in." : "Location is required to clock out." };
  }
  if (input.distanceYards > input.radiusYards) {
    return { ok: false, error: tooFarMessage(action, input.distanceYards, input.radiusYards) };
  }
  return { ok: true, source: "device", distanceYards: input.distanceYards };
}
function balanceAfterClockOut(input) {
  if (!input.auto || input.alreadyDecremented) {
    return { balance: input.current, delta: 0, outcome: "unchanged" };
  }
  if (input.current <= 0) {
    return { balance: 0, delta: 0, outcome: "none_left" };
  }
  return { balance: input.current - 1, delta: -1, outcome: "subtracted" };
}
function balanceAfterUndo(current) {
  return current + 1;
}
function timingStatus(actualIso, scheduledIso, thresholdMinutes) {
  if (!actualIso) return "Not yet";
  const minutes = (Date.parse(actualIso) - Date.parse(scheduledIso)) / 6e4;
  return minutes > thresholdMinutes ? "Late" : "On time";
}

// src/time.ts
function zonedParts(date, timeZone2) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timeZone2,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
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
    second: Number(bag.second)
  };
}
function zonedTimeToUtc(year, month, day, hour, minute, timeZone2) {
  let utc = Date.UTC(year, month - 1, day, hour, minute, 0);
  const target = utc;
  for (let pass = 0; pass < 3; pass += 1) {
    const parts = zonedParts(new Date(utc), timeZone2);
    const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const delta = target - asUtc;
    if (delta === 0) break;
    utc += delta;
  }
  return new Date(utc);
}
function addDays(year, month, day, delta) {
  const shifted = new Date(Date.UTC(year, month - 1, day + delta));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}
function addMinutesIso(iso, minutes) {
  return new Date(Date.parse(iso) + minutes * 6e4).toISOString();
}
function localDayBounds(now, timeZone2) {
  const parts = zonedParts(now, timeZone2);
  const start = zonedTimeToUtc(parts.year, parts.month, parts.day, 0, 0, timeZone2);
  const next = addDays(parts.year, parts.month, parts.day, 1);
  const end = zonedTimeToUtc(next.year, next.month, next.day, 0, 0, timeZone2);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}
function isSameLocalDay(iso, now, timeZone2) {
  const lesson = zonedParts(new Date(iso), timeZone2);
  const current = zonedParts(now, timeZone2);
  return lesson.year === current.year && lesson.month === current.month && lesson.day === current.day;
}
function cleanSpaces(value) {
  return value.replace(/[\u202f\u00a0]/g, " ");
}
function formatTime(iso, timeZone2) {
  return cleanSpaces(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone2,
      hour: "numeric",
      minute: "2-digit"
    }).format(new Date(iso))
  );
}
function formatDay(iso, timeZone2) {
  return cleanSpaces(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone2,
      weekday: "short",
      month: "short",
      day: "numeric"
    }).format(new Date(iso))
  );
}
function formatTimeRange(startIso, endIso, timeZone2) {
  return `${formatTime(startIso, timeZone2)} to ${formatTime(endIso, timeZone2)}`;
}
function minutesAfter(actualIso, scheduledIso) {
  return (Date.parse(actualIso) - Date.parse(scheduledIso)) / 6e4;
}

// src/present.ts
function lateDetail(actualIso, scheduledIso, status) {
  if (status !== messages.late || !actualIso) return "";
  return minutesLateLabel(minutesAfter(actualIso, scheduledIso));
}
function lessonStatusLabel(status, startsAt, now) {
  if (status === "completed") return messages.finished;
  if (status === "in_progress") return messages.inProgress;
  if (Date.parse(startsAt) < now.getTime()) return messages.notClockedIn;
  return messages.upcoming;
}
function presentParentLesson(lesson, timeZone2, now) {
  return {
    id: lesson.id,
    childFirstName: lesson.child_first_name,
    instructorName: lesson.instructor_name,
    address: lesson.address,
    dateLabel: formatDay(lesson.starts_at, timeZone2),
    timeLabel: formatTimeRange(lesson.starts_at, lesson.ends_at, timeZone2),
    statusLabel: lessonStatusLabel(lesson.status, lesson.starts_at, now)
  };
}
function presentInstructorLesson(lesson, timeZone2, now) {
  return {
    id: lesson.id,
    childFirstName: lesson.child_first_name,
    familyName: lesson.family_name,
    address: lesson.address,
    latitude: lesson.lat,
    longitude: lesson.lng,
    lessonsRemaining: lesson.lessons_remaining,
    dateLabel: formatDay(lesson.starts_at, timeZone2),
    timeLabel: formatTimeRange(lesson.starts_at, lesson.ends_at, timeZone2),
    statusLabel: lessonStatusLabel(lesson.status, lesson.starts_at, now),
    clockInLabel: lesson.clock_in_at ? formatTime(lesson.clock_in_at, timeZone2) : "",
    clockOutLabel: lesson.clock_out_at ? formatTime(lesson.clock_out_at, timeZone2) : "",
    canClockIn: lesson.status === "scheduled",
    canClockOut: lesson.status === "in_progress"
  };
}
function presentReportRow(row, thresholdMinutes, timeZone2) {
  const startStatus = timingStatus(row.clock_in_at, row.starts_at, thresholdMinutes);
  const endStatus = timingStatus(row.clock_out_at, row.ends_at, thresholdMinutes);
  let actualEndLabel = messages.notYet;
  if (row.clock_out_at) actualEndLabel = formatTime(row.clock_out_at, timeZone2);
  else if (row.status === "in_progress") actualEndLabel = messages.stillInLesson;
  return {
    lessonId: row.lesson_id,
    childFirstName: row.child_first_name,
    familyName: row.family_name,
    dateLabel: formatDay(row.starts_at, timeZone2),
    scheduledStartLabel: formatTime(row.starts_at, timeZone2),
    actualStartLabel: row.clock_in_at ? formatTime(row.clock_in_at, timeZone2) : messages.notYet,
    startStatus,
    startDetail: lateDetail(row.clock_in_at, row.starts_at, startStatus),
    scheduledEndLabel: formatTime(row.ends_at, timeZone2),
    actualEndLabel,
    endStatus: row.clock_out_at ? endStatus : messages.notYet,
    endDetail: row.clock_out_at ? lateDetail(row.clock_out_at, row.ends_at, endStatus) : "",
    canUndo: Boolean(row.adjustment_id)
  };
}

// src/schedule.ts
function pad(value) {
  return String(value).padStart(2, "0");
}
function at(day, hour, minute, timeZone2) {
  return zonedTimeToUtc(day.year, day.month, day.day, hour, minute, timeZone2).toISOString();
}
function buildMockLessons(now, timeZone2) {
  const todayParts = zonedParts(now, timeZone2);
  const today = { year: todayParts.year, month: todayParts.month, day: todayParts.day };
  const yesterday = addDays(today.year, today.month, today.day, -1);
  const tomorrow = addDays(today.year, today.month, today.day, 1);
  const shared = {
    familyId: henryFamily.id,
    instructorEmail: instructorAccount.email,
    childFirstName: henryFamily.childFirstName,
    address: henryFamily.address,
    lat: henryFamily.lat,
    lng: henryFamily.lng
  };
  const yesterdayStart = at(yesterday, 16, 0, timeZone2);
  const todayStart = at(today, 17, 0, timeZone2);
  const tomorrowStart = at(tomorrow, 10, 0, timeZone2);
  return [
    {
      ...shared,
      calendarEventId: `henry-${yesterday.year}${pad(yesterday.month)}${pad(yesterday.day)}-1600`,
      startsAt: yesterdayStart,
      endsAt: addMinutesIso(yesterdayStart, 30),
      demoHistory: { clockInOffsetMinutes: 12, clockOutOffsetMinutes: 31 }
    },
    {
      ...shared,
      calendarEventId: `henry-${today.year}${pad(today.month)}${pad(today.day)}-1700`,
      startsAt: todayStart,
      endsAt: addMinutesIso(todayStart, 30)
    },
    {
      ...shared,
      calendarEventId: `henry-${tomorrow.year}${pad(tomorrow.month)}${pad(tomorrow.day)}-1000`,
      startsAt: tomorrowStart,
      endsAt: addMinutesIso(tomorrowStart, 30)
    }
  ];
}

// src/adapters.ts
function missingGoogleFields(config) {
  const missing = [];
  if (!config.CALENDAR_ID.trim()) missing.push("CALENDAR_ID");
  if (!config.LESSON_TRACKER_SPREADSHEET_ID.trim()) missing.push("LESSON_TRACKER_SPREADSHEET_ID");
  if (!config.GOOGLE_SERVICE_ACCOUNT_EMAIL.trim()) missing.push("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  if (!config.privateKey.trim()) missing.push("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY");
  return missing;
}
var MockCalendarAdapter = class {
  constructor(timeZone2) {
    this.timeZone = timeZone2;
  }
  timeZone;
  async listLessons(now) {
    return buildMockLessons(now, this.timeZone);
  }
};
var GoogleCalendarAdapter = class {
  constructor(config) {
    this.config = config;
  }
  config;
  async listLessons(_now) {
    const missing = missingGoogleFields(this.config);
    console.log(JSON.stringify({ event: "calendar_not_connected", missing }));
    throw new HttpError(503, messages.calendarNotConnected);
  }
};
var MockLessonTracker = class {
  async writeBalance(db, input) {
    await trackerWriteStatement(db, input, "stub").run();
    return { provider: "stub" };
  }
};
var GoogleLessonTracker = class {
  constructor(config) {
    this.config = config;
  }
  config;
  async writeBalance(_db, _input) {
    const missing = missingGoogleFields(this.config);
    console.log(JSON.stringify({ event: "tracker_not_connected", missing }));
    throw new HttpError(503, messages.trackerNotConnected);
  }
};
function trackerWriteStatement(db, input, provider) {
  return db.prepare(
    `INSERT INTO tracker_writes (id, family_id, lessons_remaining, reason, provider, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(input.id, input.familyId, input.lessonsRemaining, input.reason, provider, input.createdAt);
}

// src/settings.ts
var PRODUCT_DEFAULTS = {
  clockInRadiusYards: 100,
  lateThresholdMinutes: 5,
  autoDecrementOnClockOut: true,
  arrivalTextEnabled: true,
  arrivalTextMinutes: 10
};
var LOCATION_RETENTION_HOURS = 24;
var SETTING_KEYS = {
  clockInRadiusYards: "clock_in_radius_yards",
  lateThresholdMinutes: "late_threshold_minutes",
  autoDecrementOnClockOut: "auto_decrement_on_clock_out",
  arrivalTextEnabled: "arrival_text_enabled",
  arrivalTextMinutes: "arrival_text_minutes"
};
function settingKey(name) {
  return SETTING_KEYS[name];
}
function numberOr(value, fallback) {
  if (value == null || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function boolOr(value, fallback) {
  if (value == null || value.trim() === "") return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}
function defaultsFromEnv(env) {
  return {
    clockInRadiusYards: numberOr(env.CLOCK_IN_RADIUS_YARDS, PRODUCT_DEFAULTS.clockInRadiusYards),
    lateThresholdMinutes: numberOr(env.LATE_THRESHOLD_MINUTES, PRODUCT_DEFAULTS.lateThresholdMinutes),
    autoDecrementOnClockOut: boolOr(env.AUTO_DECREMENT_ON_CLOCK_OUT, PRODUCT_DEFAULTS.autoDecrementOnClockOut),
    arrivalTextEnabled: boolOr(env.ARRIVAL_TEXT_ENABLED, PRODUCT_DEFAULTS.arrivalTextEnabled),
    arrivalTextMinutes: numberOr(env.ARRIVAL_TEXT_MINUTES, PRODUCT_DEFAULTS.arrivalTextMinutes)
  };
}
function settingsFromRows(rows, fallback) {
  const map = new Map(rows.map((row) => [row.key, row.value]));
  return {
    clockInRadiusYards: numberOr(map.get(SETTING_KEYS.clockInRadiusYards), fallback.clockInRadiusYards),
    lateThresholdMinutes: numberOr(map.get(SETTING_KEYS.lateThresholdMinutes), fallback.lateThresholdMinutes),
    autoDecrementOnClockOut: boolOr(map.get(SETTING_KEYS.autoDecrementOnClockOut), fallback.autoDecrementOnClockOut),
    arrivalTextEnabled: boolOr(map.get(SETTING_KEYS.arrivalTextEnabled), fallback.arrivalTextEnabled),
    arrivalTextMinutes: numberOr(map.get(SETTING_KEYS.arrivalTextMinutes), fallback.arrivalTextMinutes)
  };
}
function validateSettings(input) {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "Check the settings and try again." };
  }
  const body = input;
  const radius = body.clockInRadiusYards;
  const late = body.lateThresholdMinutes;
  const auto = body.autoDecrementOnClockOut;
  const arrivalEnabled = body.arrivalTextEnabled;
  const arrivalMinutes = body.arrivalTextMinutes;
  if (typeof radius !== "number" || !Number.isInteger(radius) || radius < 25 || radius > 500) {
    return { ok: false, error: "Enter a radius between 25 and 500 yards." };
  }
  if (typeof late !== "number" || !Number.isInteger(late) || late < 0 || late > 30) {
    return { ok: false, error: "Enter a late threshold between 0 and 30 minutes." };
  }
  if (typeof arrivalMinutes !== "number" || !Number.isInteger(arrivalMinutes) || arrivalMinutes < 1 || arrivalMinutes > 30) {
    return { ok: false, error: "Enter a text time between 1 and 30 minutes." };
  }
  if (typeof auto !== "boolean" || typeof arrivalEnabled !== "boolean") {
    return { ok: false, error: "Check the settings and try again." };
  }
  return {
    ok: true,
    settings: {
      clockInRadiusYards: radius,
      lateThresholdMinutes: late,
      autoDecrementOnClockOut: auto,
      arrivalTextEnabled: arrivalEnabled,
      arrivalTextMinutes: arrivalMinutes
    }
  };
}

// src/live-location.ts
function phaseAfterClockIn() {
  return "on_shift";
}
function phaseAfterClockOut() {
  return "stopped";
}
function retentionCutoffIso(now, hours = LOCATION_RETENTION_HOURS) {
  return new Date(now.getTime() - hours * 60 * 60 * 1e3).toISOString();
}

// src/names.ts
function firstNameOnly(value) {
  const token = value.trim().split(/\s+/)[0] ?? "";
  const letters = token.replace(/[^A-Za-z]/g, "");
  if (!letters) return "";
  return letters.charAt(0).toUpperCase() + letters.slice(1).toLowerCase();
}

// src/secrets.ts
function readSecret(env, name) {
  const bag = env;
  const value = bag[name];
  return typeof value === "string" ? value.trim() : "";
}

// src/tokens.ts
function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}
function randomId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}
async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

// src/store.ts
function text(value) {
  return value;
}
function googleConfig(env) {
  return {
    DATA_SOURCE: text(env.DATA_SOURCE),
    CALENDAR_ID: env.CALENDAR_ID,
    LESSON_TRACKER_SPREADSHEET_ID: env.LESSON_TRACKER_SPREADSHEET_ID,
    LESSON_TRACKER_RANGE: env.LESSON_TRACKER_RANGE,
    GOOGLE_SERVICE_ACCOUNT_EMAIL: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    privateKey: readSecret(env, "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY")
  };
}
function calendarAdapter(env) {
  if (text(env.DATA_SOURCE) === "google") return new GoogleCalendarAdapter(googleConfig(env));
  return new MockCalendarAdapter(env.TIMEZONE || "America/New_York");
}
function lessonTracker(env) {
  if (text(env.DATA_SOURCE) === "google") return new GoogleLessonTracker(googleConfig(env));
  return new MockLessonTracker();
}
function practiceData(env) {
  return text(env.DATA_SOURCE) !== "google";
}
function wrote(result) {
  const changes = result.meta.changes ?? result.meta.rows_written ?? 0;
  return changes > 0;
}
function mapUser(row) {
  const roles = JSON.parse(row.roles);
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    roles,
    familyId: row.family_id
  };
}
async function purgeLocationPoints(db, now) {
  await db.prepare("DELETE FROM location_points WHERE recorded_at <= ?").bind(retentionCutoffIso(now)).run();
}
async function getSettings(env) {
  const fallback = defaultsFromEnv(env);
  const rows = await env.DB.prepare("SELECT key, value FROM settings").all();
  return settingsFromRows(rows.results ?? [], fallback);
}
async function saveSettings(env, settings) {
  const entries = Object.entries({
    [settingKey("clockInRadiusYards")]: String(settings.clockInRadiusYards),
    [settingKey("lateThresholdMinutes")]: String(settings.lateThresholdMinutes),
    [settingKey("autoDecrementOnClockOut")]: String(settings.autoDecrementOnClockOut),
    [settingKey("arrivalTextEnabled")]: String(settings.arrivalTextEnabled),
    [settingKey("arrivalTextMinutes")]: String(settings.arrivalTextMinutes)
  });
  await env.DB.batch(
    entries.map(
      ([key, value]) => env.DB.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(key, value)
    )
  );
}
async function ensureReady(env, now = /* @__PURE__ */ new Date()) {
  await purgeLocationPoints(env.DB, now);
  await seedDirectory(env, now);
  await syncLessons(env, now);
}
async function seedDirectory(env, now) {
  const existing = await env.DB.prepare("SELECT value FROM settings WHERE key = 'seeded_at'").first();
  if (existing) return;
  const createdAt = now.toISOString();
  const settings = defaultsFromEnv(env);
  const childName = firstNameOnly(henryFamily.childFirstName);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO users (id, email, display_name, roles, family_id, created_at) VALUES (?, ?, ?, ?, NULL, ?)`
    ).bind(instructorAccount.id, instructorAccount.email, instructorAccount.displayName, JSON.stringify(instructorAccount.roles), createdAt),
    env.DB.prepare(
      `INSERT OR IGNORE INTO users (id, email, display_name, roles, family_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(parentAccount.id, parentAccount.email, parentAccount.displayName, JSON.stringify(parentAccount.roles), henryFamily.id, createdAt),
    env.DB.prepare(
      `INSERT OR IGNORE INTO families (id, name, instructor_user_id, parent_user_id, phone, lessons_remaining, balance_initialized, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`
    ).bind(
      henryFamily.id,
      henryFamily.name,
      instructorAccount.id,
      parentAccount.id,
      henryFamily.phone,
      henryFamily.lessonsRemaining,
      createdAt
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
      createdAt
    }, "stub")
  ]);
}
async function syncLessons(env, now) {
  const lessons = await calendarAdapter(env).listLessons(now);
  const instructor = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(instructorAccount.email).first();
  if (!instructor) return;
  for (const lesson of lessons) {
    await upsertLesson(env, lesson, instructor.id, now);
    if (lesson.demoHistory && Date.parse(lesson.endsAt) < now.getTime()) {
      await applyDemoHistory(env, lesson, instructor.id, now);
    }
  }
}
async function upsertLesson(env, lesson, instructorId, now) {
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
    WHERE lessons.status = 'scheduled'`
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
    now.toISOString()
  ).run();
}
async function applyDemoHistory(env, lesson, instructorId, now) {
  if (!lesson.demoHistory) return;
  const existing = await env.DB.prepare("SELECT id FROM time_entries WHERE lesson_id = ?").bind(lesson.calendarEventId).first();
  if (existing) return;
  const clockIn = addMinutesIso(lesson.startsAt, lesson.demoHistory.clockInOffsetMinutes);
  const clockOut = addMinutesIso(lesson.startsAt, lesson.demoHistory.clockOutOffsetMinutes);
  const createdAt = now.toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO time_entries (
        id, lesson_id, instructor_user_id, clock_in_at, clock_out_at, clock_in_distance_yards, clock_out_distance_yards, clock_in_source, clock_out_source, created_at
      ) VALUES (?, ?, ?, ?, ?, 0, 0, 'preview', 'preview', ?)`
    ).bind(`time_${lesson.calendarEventId}`, lesson.calendarEventId, instructorId, clockIn, clockOut, createdAt),
    env.DB.prepare("UPDATE lessons SET status = 'completed' WHERE id = ? AND status = 'scheduled'").bind(lesson.calendarEventId),
    env.DB.prepare(
      `INSERT OR IGNORE INTO balance_adjustments (id, family_id, lesson_id, delta, reason, created_at, undone_at)
       VALUES (?, ?, ?, -1, ?, ?, NULL)`
    ).bind(
      `adj_${lesson.calendarEventId}`,
      lesson.familyId,
      lesson.calendarEventId,
      "Practice lesson already counted in the opening balance",
      createdAt
    )
  ]);
}
async function findUserByEmail(env, email) {
  const row = await env.DB.prepare("SELECT id, email, display_name, roles, family_id FROM users WHERE email = ?").bind(email).first();
  return row ? mapUser(row) : null;
}
async function userFromSession(env, tokenHash, now) {
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.display_name, u.roles, u.family_id, s.expires_at, s.id AS session_id
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`
  ).bind(tokenHash).first();
  if (!row) return null;
  if (Date.parse(row.expires_at) <= now.getTime()) {
    await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(row.session_id).run();
    return null;
  }
  return mapUser(row);
}
async function latestUnusedLink(env, email, now) {
  return env.DB.prepare(
    `SELECT token_hash, created_at FROM magic_links
     WHERE email = ? AND used_at IS NULL AND expires_at > ?
     ORDER BY created_at DESC LIMIT 1`
  ).bind(email, now.toISOString()).first();
}
async function saveMagicLink(env, email, tokenHash, expiresAt, now) {
  await env.DB.prepare(
    "INSERT INTO magic_links (id, email, token_hash, expires_at, used_at, created_at) VALUES (?, ?, ?, ?, NULL, ?)"
  ).bind(randomId("link"), email, tokenHash, expiresAt, now.toISOString()).run();
}
async function consumeMagicLink(env, tokenHash, now) {
  const row = await env.DB.prepare(
    "SELECT id, email, expires_at, used_at FROM magic_links WHERE token_hash = ?"
  ).bind(tokenHash).first();
  if (!row || row.used_at || Date.parse(row.expires_at) <= now.getTime()) return null;
  const result = await env.DB.prepare("UPDATE magic_links SET used_at = ? WHERE id = ? AND used_at IS NULL").bind(now.toISOString(), row.id).run();
  if (!wrote(result)) return null;
  return row.email;
}
async function saveSession(env, userId, tokenHash, expiresAt, now) {
  await env.DB.prepare(
    "INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)"
  ).bind(randomId("session"), userId, tokenHash, expiresAt, now.toISOString()).run();
}
async function deleteSession(env, tokenHash) {
  await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
}
async function saveOutbound(env, channel, recipient, body, provider, status, now) {
  await env.DB.prepare(
    "INSERT INTO outbound_messages (id, channel, recipient, body, provider, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).bind(randomId("msg"), channel, recipient, body, provider, status, now.toISOString()).run();
}
async function parentHome(env, familyId, dayStartIso) {
  const family = await env.DB.prepare(
    `SELECT f.name, f.lessons_remaining, u.display_name AS instructor_name
     FROM families f JOIN users u ON u.id = f.instructor_user_id WHERE f.id = ?`
  ).bind(familyId).first();
  if (!family) return null;
  const children = await env.DB.prepare("SELECT first_name FROM children WHERE family_id = ? ORDER BY first_name").bind(familyId).all();
  const lessons = await env.DB.prepare(
    `SELECT l.id, l.family_id, l.child_first_name, l.starts_at, l.ends_at, l.address, l.status, u.display_name AS instructor_name
     FROM lessons l JOIN users u ON u.id = l.instructor_user_id
     WHERE l.family_id = ? AND l.status IN ('scheduled', 'in_progress') AND l.starts_at >= ?
     ORDER BY l.starts_at`
  ).bind(familyId, dayStartIso).all();
  return {
    familyName: family.name,
    lessonsRemaining: family.lessons_remaining,
    instructorName: family.instructor_name,
    children: (children.results ?? []).map((row) => row.first_name),
    lessons: lessons.results ?? []
  };
}
async function instructorToday(env, instructorId, startIso, endIso) {
  const rows = await env.DB.prepare(
    `SELECT l.id, l.family_id, l.instructor_user_id, l.child_first_name, l.starts_at, l.ends_at, l.address, l.lat, l.lng, l.status,
            f.name AS family_name, f.lessons_remaining, t.clock_in_at, t.clock_out_at, t.clock_in_distance_yards
     FROM lessons l
     JOIN families f ON f.id = l.family_id
     LEFT JOIN time_entries t ON t.lesson_id = l.id
     WHERE l.instructor_user_id = ? AND l.starts_at >= ? AND l.starts_at < ?
     ORDER BY l.starts_at`
  ).bind(instructorId, startIso, endIso).all();
  return rows.results ?? [];
}
async function ownedLesson(env, lessonId, instructorId) {
  return env.DB.prepare(
    `SELECT l.id, l.family_id, l.instructor_user_id, l.child_first_name, l.starts_at, l.ends_at, l.address, l.lat, l.lng, l.status,
            f.name AS family_name, f.lessons_remaining, t.clock_in_at, t.clock_out_at, t.clock_in_distance_yards
     FROM lessons l
     JOIN families f ON f.id = l.family_id
     LEFT JOIN time_entries t ON t.lesson_id = l.id
     WHERE l.id = ? AND l.instructor_user_id = ?`
  ).bind(lessonId, instructorId).first();
}
async function hasOtherOpenLesson(env, instructorId, lessonId) {
  const row = await env.DB.prepare(
    "SELECT id FROM lessons WHERE instructor_user_id = ? AND status = 'in_progress' AND id != ? LIMIT 1"
  ).bind(instructorId, lessonId).first();
  return Boolean(row);
}
async function clockInLesson(env, lesson, source, distanceYards2, now) {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO time_entries (
        id, lesson_id, instructor_user_id, clock_in_at, clock_out_at, clock_in_distance_yards, clock_out_distance_yards, clock_in_source, clock_out_source, created_at
      ) VALUES (?, ?, ?, ?, NULL, ?, NULL, ?, NULL, ?)`
    ).bind(randomId("time"), lesson.id, lesson.instructor_user_id, now.toISOString(), distanceYards2, source, now.toISOString()),
    env.DB.prepare("UPDATE lessons SET status = 'in_progress' WHERE id = ? AND status = 'scheduled'").bind(lesson.id),
    env.DB.prepare("UPDATE en_route_sessions SET phase = ? WHERE lesson_id = ? AND ended_at IS NULL").bind(phaseAfterClockIn(), lesson.id)
  ]);
}
async function clockOutLesson(env, lesson, source, distanceYards2, now) {
  const settings = await getSettings(env);
  const adjustment = await env.DB.prepare(
    "SELECT id FROM balance_adjustments WHERE lesson_id = ? AND delta < 0 AND undone_at IS NULL"
  ).bind(lesson.id).first();
  const family = await env.DB.prepare("SELECT lessons_remaining FROM families WHERE id = ?").bind(lesson.family_id).first();
  const current = family?.lessons_remaining ?? 0;
  const next = balanceAfterClockOut({
    current,
    auto: settings.autoDecrementOnClockOut,
    alreadyDecremented: Boolean(adjustment)
  });
  const statements = [
    env.DB.prepare(
      "UPDATE time_entries SET clock_out_at = ?, clock_out_distance_yards = ?, clock_out_source = ? WHERE lesson_id = ?"
    ).bind(now.toISOString(), distanceYards2, source, lesson.id),
    env.DB.prepare("UPDATE lessons SET status = 'completed' WHERE id = ?").bind(lesson.id),
    env.DB.prepare(
      "UPDATE en_route_sessions SET phase = ?, ended_at = ?, end_reason = 'clock_out' WHERE lesson_id = ? AND ended_at IS NULL"
    ).bind(phaseAfterClockOut(), now.toISOString(), lesson.id)
  ];
  if (next.delta !== 0 && text(env.DATA_SOURCE) !== "google") {
    statements.push(
      env.DB.prepare("UPDATE families SET lessons_remaining = ? WHERE id = ?").bind(next.balance, lesson.family_id),
      env.DB.prepare(
        "INSERT INTO balance_adjustments (id, family_id, lesson_id, delta, reason, created_at, undone_at) VALUES (?, ?, ?, ?, ?, ?, NULL)"
      ).bind(randomId("adj"), lesson.family_id, lesson.id, next.delta, "Subtracted at clock out", now.toISOString()),
      trackerWriteStatement(env.DB, {
        id: randomId("track"),
        familyId: lesson.family_id,
        lessonsRemaining: next.balance,
        reason: "Subtracted at clock out",
        createdAt: now.toISOString()
      }, "stub")
    );
  } else if (next.delta !== 0) {
    statements.push(
      env.DB.prepare("UPDATE families SET lessons_remaining = ? WHERE id = ?").bind(next.balance, lesson.family_id),
      env.DB.prepare(
        "INSERT INTO balance_adjustments (id, family_id, lesson_id, delta, reason, created_at, undone_at) VALUES (?, ?, ?, ?, ?, ?, NULL)"
      ).bind(randomId("adj"), lesson.family_id, lesson.id, next.delta, "Subtracted at clock out", now.toISOString())
    );
  }
  if (next.delta !== 0 && text(env.DATA_SOURCE) === "google") {
    await lessonTracker(env).writeBalance(env.DB, {
      id: randomId("track"),
      familyId: lesson.family_id,
      lessonsRemaining: next.balance,
      reason: "Subtracted at clock out",
      createdAt: now.toISOString()
    });
  }
  await env.DB.batch(statements);
  return { outcome: next.outcome, lessonsRemaining: next.balance };
}
async function loadOwnedLesson(env, lessonId, instructorId) {
  const lesson = await ownedLesson(env, lessonId, instructorId);
  if (!lesson) throw new HttpError(404, "That lesson is not on your list.");
  return lesson;
}
async function reportRows(env, startIso, endIso) {
  const families = await env.DB.prepare("SELECT name, lessons_remaining FROM families ORDER BY name").all();
  const rows = await env.DB.prepare(
    `SELECT l.id AS lesson_id, l.child_first_name, l.starts_at, l.ends_at, l.status, l.family_id,
            f.name AS family_name, f.lessons_remaining, t.clock_in_at, t.clock_out_at, a.id AS adjustment_id
     FROM lessons l
     JOIN families f ON f.id = l.family_id
     LEFT JOIN time_entries t ON t.lesson_id = l.id
     LEFT JOIN balance_adjustments a ON a.lesson_id = l.id AND a.delta < 0 AND a.undone_at IS NULL
     WHERE l.starts_at >= ? AND l.starts_at < ?
     ORDER BY l.starts_at ASC`
  ).bind(startIso, endIso).all();
  return {
    families: (families.results ?? []).map((row) => ({ name: row.name, lessonsRemaining: row.lessons_remaining })),
    rows: rows.results ?? []
  };
}
async function undoDecrement(env, lessonId, now) {
  const adjustment = await env.DB.prepare(
    "SELECT id, family_id, delta FROM balance_adjustments WHERE lesson_id = ? AND delta < 0 AND undone_at IS NULL"
  ).bind(lessonId).first();
  if (!adjustment) throw new HttpError(409, "There is no lesson count change to undo.");
  const family = await env.DB.prepare("SELECT lessons_remaining FROM families WHERE id = ?").bind(adjustment.family_id).first();
  if (!family) throw new HttpError(404, "That lesson is not on your list.");
  const restored = balanceAfterUndo(family.lessons_remaining);
  if (text(env.DATA_SOURCE) === "google") {
    await lessonTracker(env).writeBalance(env.DB, {
      id: randomId("track"),
      familyId: adjustment.family_id,
      lessonsRemaining: restored,
      reason: "Admin restored the lesson count",
      createdAt: now.toISOString()
    });
  }
  const claimed = await env.DB.prepare("UPDATE balance_adjustments SET undone_at = ? WHERE id = ? AND undone_at IS NULL").bind(now.toISOString(), adjustment.id).run();
  if (!wrote(claimed)) throw new HttpError(409, "There is no lesson count change to undo.");
  const writes = [
    env.DB.prepare("UPDATE families SET lessons_remaining = ? WHERE id = ?").bind(restored, adjustment.family_id)
  ];
  if (text(env.DATA_SOURCE) !== "google") {
    writes.push(trackerWriteStatement(env.DB, {
      id: randomId("track"),
      familyId: adjustment.family_id,
      lessonsRemaining: restored,
      reason: "Admin restored the lesson count",
      createdAt: now.toISOString()
    }, "stub"));
  }
  await env.DB.batch(writes);
  return { lessonsRemaining: restored };
}

// src/api.ts
var SESSION_SECONDS = 60 * 60 * 24 * 14;
var LINK_SECONDS = 60 * 30;
var COOKIE = "sss_session";
function timeZone(env) {
  return env.TIMEZONE || "America/New_York";
}
function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}
function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
async function currentUser(request, env, now) {
  const token = readCookie(request.headers.get("cookie"), COOKIE);
  if (!token) return null;
  return userFromSession(env, await sha256(token), now);
}
function requireUser(user) {
  if (!user) throw new HttpError(401, messages.signInAgain);
  return user;
}
function requireRole(user, role, error) {
  if (!user.roles.includes(role)) throw new HttpError(403, error);
}
function clockOutCopy(outcome) {
  if (outcome === "subtracted") return messages.clockedOutSubtracted;
  if (outcome === "none_left") return messages.clockedOutNoneLeft;
  return messages.clockedOutUnchanged;
}
function reportStart(now, zone) {
  const parts = zonedParts(now, zone);
  const start = addDays(parts.year, parts.month, parts.day, -6);
  return zonedTimeToUtc(start.year, start.month, start.day, 0, 0, zone).toISOString();
}
async function handleApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = request.method;
  const now = /* @__PURE__ */ new Date();
  if (method === "GET" && path === "/api/health") {
    return json({
      ok: true,
      appName: env.APP_NAME,
      dataSource: env.DATA_SOURCE,
      calendarName: env.CALENDAR_NAME,
      practiceData: practiceData(env)
    });
  }
  if (method === "GET" && path === "/api/auth/config") {
    const preview = env.EXPOSE_DEV_MAGIC_LINK === "true";
    return json({
      previewSignIn: preview,
      accounts: preview ? previewAccounts : [],
      allowPreviewLocation: env.ALLOW_PREVIEW_LOCATION === "true"
    });
  }
  if (path.startsWith("/api/")) {
    await ensureReady(env, now);
  }
  if (method === "POST" && path === "/api/auth/request") {
    assertSameOrigin(request);
    const body = await readJson(request);
    const email = normalizeEmail(body && typeof body === "object" ? body.email : "");
    if (!email) throw new HttpError(400, messages.emailRequired);
    if (!validEmail(email)) throw new HttpError(400, messages.emailInvalid);
    const user2 = await findUserByEmail(env, email);
    if (!user2) return json({ message: messages.linkReady });
    if (env.EXPOSE_DEV_MAGIC_LINK !== "true") {
      const recent = await latestUnusedLink(env, email, now);
      if (recent && now.getTime() - Date.parse(recent.created_at) < 6e4) {
        return json({ message: messages.linkReady });
      }
    }
    const token = randomToken();
    const expires = new Date(now.getTime() + LINK_SECONDS * 1e3).toISOString();
    await saveMagicLink(env, email, await sha256(token), expires, now);
    const devLink = `${url.origin}/?token=${encodeURIComponent(token)}`;
    await saveOutbound(env, "email", email, "Sign in link", env.EMAIL_PROVIDER || "stub", "stubbed", now);
    console.log(JSON.stringify({ event: "magic_link_created", userId: user2.id }));
    return json({
      message: messages.linkReady,
      ...env.EXPOSE_DEV_MAGIC_LINK === "true" ? { devLink } : {}
    });
  }
  if (method === "POST" && path === "/api/auth/verify") {
    assertSameOrigin(request);
    const body = await readJson(request);
    const token = body && typeof body === "object" ? body.token : "";
    if (typeof token !== "string" || token.length < 20) throw new HttpError(400, messages.linkInvalid);
    const email = await consumeMagicLink(env, await sha256(token), now);
    if (!email) throw new HttpError(400, messages.linkInvalid);
    const user2 = await findUserByEmail(env, email);
    if (!user2) throw new HttpError(400, messages.linkInvalid);
    const session = randomToken();
    const expires = new Date(now.getTime() + SESSION_SECONDS * 1e3).toISOString();
    await saveSession(env, user2.id, await sha256(session), expires, now);
    return json(
      { displayName: user2.displayName, roles: user2.roles },
      200,
      { "set-cookie": sessionCookie(session, SESSION_SECONDS, url.protocol === "https:") }
    );
  }
  if (method === "POST" && path === "/api/auth/logout") {
    assertSameOrigin(request);
    const token = readCookie(request.headers.get("cookie"), COOKIE);
    if (token) await deleteSession(env, await sha256(token));
    return json({ ok: true }, 200, { "set-cookie": sessionCookie("", 0, url.protocol === "https:") });
  }
  const user = requireUser(await currentUser(request, env, now));
  if (method === "GET" && path === "/api/me") {
    return json({
      displayName: user.displayName,
      email: user.email,
      roles: user.roles,
      allowPreviewLocation: env.ALLOW_PREVIEW_LOCATION === "true",
      appName: env.APP_NAME,
      practiceData: practiceData(env)
    });
  }
  const zone = timeZone(env);
  const today = localDayBounds(now, zone);
  if (method === "GET" && path === "/api/parent/home") {
    requireRole(user, "parent", messages.parentOnly);
    if (!user.familyId) throw new HttpError(403, messages.parentOnly);
    const home = await parentHome(env, user.familyId, today.startIso);
    if (!home) throw new HttpError(404, messages.parentOnly);
    return json({
      practiceData: practiceData(env),
      familyName: home.familyName,
      lessonsRemaining: home.lessonsRemaining,
      instructorName: home.instructorName,
      children: home.children,
      lessons: home.lessons.filter((lesson) => lesson.family_id === user.familyId).map((lesson) => presentParentLesson(lesson, zone, now))
    });
  }
  if (method === "GET" && path === "/api/instructor/today") {
    requireRole(user, "instructor", messages.instructorOnly);
    const lessons = await instructorToday(env, user.id, today.startIso, today.endIso);
    return json({
      practiceData: practiceData(env),
      displayName: user.displayName,
      allowPreviewLocation: env.ALLOW_PREVIEW_LOCATION === "true",
      lessons: lessons.map((lesson) => presentInstructorLesson(lesson, zone, now))
    });
  }
  const clockInMatch = path.match(/^\/api\/instructor\/lessons\/([^/]+)\/clock-in$/);
  const clockOutMatch = path.match(/^\/api\/instructor\/lessons\/([^/]+)\/clock-out$/);
  if ((clockInMatch || clockOutMatch) && method === "POST") {
    assertSameOrigin(request);
    requireRole(user, "instructor", messages.instructorOnly);
    const lessonId = decodeURIComponent((clockInMatch ?? clockOutMatch)[1] ?? "");
    const lesson = await loadOwnedLesson(env, lessonId, user.id);
    const body = await readJson(request);
    const record = body && typeof body === "object" ? body : {};
    const preview = record.preview === true;
    const point = readLatLng(record.latitude, record.longitude);
    const settings = await getSettings(env);
    const distance = point ? distanceYards({ lat: lesson.lat, lng: lesson.lng }, point) : null;
    if (clockInMatch) {
      const decision2 = evaluateClockIn({
        status: lesson.status,
        sameDay: isSameLocalDay(lesson.starts_at, now, zone),
        anotherOpen: await hasOtherOpenLesson(env, user.id, lesson.id),
        preview,
        previewAllowed: env.ALLOW_PREVIEW_LOCATION === "true",
        hasDeviceLocation: Boolean(point),
        distanceYards: distance,
        radiusYards: settings.clockInRadiusYards
      });
      if (!decision2.ok) throw new HttpError(400, decision2.error);
      await clockInLesson(env, lesson, decision2.source, decision2.distanceYards, now);
      console.log(JSON.stringify({ event: "clock_in", lessonId: lesson.id, userId: user.id, source: decision2.source }));
      return json({ message: messages.clockedIn });
    }
    const decision = evaluateClockOut({
      status: lesson.status,
      preview,
      previewAllowed: env.ALLOW_PREVIEW_LOCATION === "true",
      hasDeviceLocation: Boolean(point),
      distanceYards: distance,
      radiusYards: settings.clockInRadiusYards
    });
    if (!decision.ok) throw new HttpError(400, decision.error);
    const result = await clockOutLesson(env, lesson, decision.source, decision.distanceYards, now);
    console.log(JSON.stringify({ event: "clock_out", lessonId: lesson.id, userId: user.id, outcome: result.outcome }));
    return json({ message: clockOutCopy(result.outcome), lessonsRemaining: result.lessonsRemaining });
  }
  if (method === "GET" && path === "/api/admin/report") {
    requireRole(user, "admin", messages.adminOnly);
    const settings = await getSettings(env);
    const report = await reportRows(env, reportStart(now, zone), today.endIso);
    return json({
      practiceData: practiceData(env),
      families: report.families,
      settings,
      rows: report.rows.map((row) => presentReportRow(row, settings.lateThresholdMinutes, zone))
    });
  }
  const undoMatch = path.match(/^\/api\/admin\/lessons\/([^/]+)\/undo$/);
  if (undoMatch && method === "POST") {
    assertSameOrigin(request);
    requireRole(user, "admin", messages.adminOnly);
    const lessonId = decodeURIComponent(undoMatch[1] ?? "");
    const result = await undoDecrement(env, lessonId, now);
    console.log(JSON.stringify({ event: "undo_decrement", lessonId, userId: user.id }));
    return json({ message: messages.undone, lessonsRemaining: result.lessonsRemaining });
  }
  if (path === "/api/admin/settings" && method === "PUT") {
    assertSameOrigin(request);
    requireRole(user, "admin", messages.adminOnly);
    const parsed = validateSettings(await readJson(request));
    if (!parsed.ok) throw new HttpError(400, parsed.error);
    await saveSettings(env, parsed.settings);
    return json({ message: messages.saved, settings: parsed.settings });
  }
  throw new HttpError(404, messages.notAvailable);
}

// src/index.ts
var index_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }
    try {
      return await handleApi(request, env);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      console.error(JSON.stringify({ event: "unhandled", message: error instanceof Error ? error.message : "error" }));
      return json({ error: messages.genericError }, 500);
    }
  },
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(purgeLocationPoints(env.DB, /* @__PURE__ */ new Date()));
  }
};
export {
  index_default as default
};
