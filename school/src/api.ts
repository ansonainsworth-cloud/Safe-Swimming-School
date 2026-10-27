import { distanceYards, readLatLng } from "./geo";
import { assertSameOrigin, json, readCookie, readJson, sessionCookie } from "./http";
import { HttpError } from "./errors";
import { messages } from "./messages";
import { previewAccounts } from "./mock-data";
import { presentInstructorLesson, presentParentLesson, presentReportRow } from "./present";
import {
  clockInLesson,
  clockOutLesson,
  consumeMagicLink,
  deleteSession,
  ensureReady,
  findUserByEmail,
  getSettings,
  hasOtherOpenLesson,
  instructorToday,
  latestUnusedLink,
  loadOwnedLesson,
  parentHome,
  practiceData,
  reportRows,
  saveMagicLink,
  saveOutbound,
  saveSession,
  saveSettings,
  undoDecrement,
  userFromSession,
  type CurrentUser,
} from "./store";
import { evaluateClockIn, evaluateClockOut, type BalanceOutcome } from "./clock-rules";
import { validateSettings } from "./settings";
import { addDays, isSameLocalDay, localDayBounds, zonedParts, zonedTimeToUtc } from "./time";
import { randomToken, sha256 } from "./tokens";

const SESSION_SECONDS = 60 * 60 * 24 * 14;
const LINK_SECONDS = 60 * 30;
const COOKIE = "sss_session";

function timeZone(env: Env): string {
  return env.TIMEZONE || "America/New_York";
}

function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function validEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function currentUser(request: Request, env: Env, now: Date): Promise<CurrentUser | null> {
  const token = readCookie(request.headers.get("cookie"), COOKIE);
  if (!token) return null;
  return userFromSession(env, await sha256(token), now);
}

function requireUser(user: CurrentUser | null): CurrentUser {
  if (!user) throw new HttpError(401, messages.signInAgain);
  return user;
}

function requireRole(user: CurrentUser, role: string, error: string): void {
  if (!user.roles.includes(role)) throw new HttpError(403, error);
}

function clockOutCopy(outcome: BalanceOutcome): string {
  if (outcome === "subtracted") return messages.clockedOutSubtracted;
  if (outcome === "none_left") return messages.clockedOutNoneLeft;
  return messages.clockedOutUnchanged;
}

function reportStart(now: Date, zone: string): string {
  const parts = zonedParts(now, zone);
  const start = addDays(parts.year, parts.month, parts.day, -6);
  return zonedTimeToUtc(start.year, start.month, start.day, 0, 0, zone).toISOString();
}

export async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = request.method;
  const now = new Date();

  if (method === "GET" && path === "/api/health") {
    return json({
      ok: true,
      appName: env.APP_NAME,
      dataSource: env.DATA_SOURCE,
      calendarName: env.CALENDAR_NAME,
      practiceData: practiceData(env),
    });
  }

  if (method === "GET" && path === "/api/auth/config") {
    const preview = env.EXPOSE_DEV_MAGIC_LINK === "true";
    return json({
      previewSignIn: preview,
      accounts: preview ? previewAccounts : [],
      allowPreviewLocation: env.ALLOW_PREVIEW_LOCATION === "true",
    });
  }

  if (path.startsWith("/api/")) {
    await ensureReady(env, now);
  }

  if (method === "POST" && path === "/api/auth/request") {
    assertSameOrigin(request);
    const body = await readJson(request);
    const email = normalizeEmail(body && typeof body === "object" ? (body as { email?: unknown }).email : "");
    if (!email) throw new HttpError(400, messages.emailRequired);
    if (!validEmail(email)) throw new HttpError(400, messages.emailInvalid);
    const user = await findUserByEmail(env, email);
    if (!user) return json({ message: messages.linkReady });
    if (env.EXPOSE_DEV_MAGIC_LINK !== "true") {
      const recent = await latestUnusedLink(env, email, now);
      if (recent && now.getTime() - Date.parse(recent.created_at) < 60_000) {
        return json({ message: messages.linkReady });
      }
    }
    const token = randomToken();
    const expires = new Date(now.getTime() + LINK_SECONDS * 1000).toISOString();
    await saveMagicLink(env, email, await sha256(token), expires, now);
    const devLink = `${url.origin}/?token=${encodeURIComponent(token)}`;
    await saveOutbound(env, "email", email, "Sign in link", env.EMAIL_PROVIDER || "stub", "stubbed", now);
    console.log(JSON.stringify({ event: "magic_link_created", userId: user.id }));
    return json({
      message: messages.linkReady,
      ...(env.EXPOSE_DEV_MAGIC_LINK === "true" ? { devLink } : {}),
    });
  }

  if (method === "POST" && path === "/api/auth/verify") {
    assertSameOrigin(request);
    const body = await readJson(request);
    const token = body && typeof body === "object" ? (body as { token?: unknown }).token : "";
    if (typeof token !== "string" || token.length < 20) throw new HttpError(400, messages.linkInvalid);
    const email = await consumeMagicLink(env, await sha256(token), now);
    if (!email) throw new HttpError(400, messages.linkInvalid);
    const user = await findUserByEmail(env, email);
    if (!user) throw new HttpError(400, messages.linkInvalid);
    const session = randomToken();
    const expires = new Date(now.getTime() + SESSION_SECONDS * 1000).toISOString();
    await saveSession(env, user.id, await sha256(session), expires, now);
    return json(
      { displayName: user.displayName, roles: user.roles },
      200,
      { "set-cookie": sessionCookie(session, SESSION_SECONDS, url.protocol === "https:") },
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
      practiceData: practiceData(env),
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
      lessons: home.lessons
        .filter((lesson) => lesson.family_id === user.familyId)
        .map((lesson) => presentParentLesson(lesson, zone, now)),
    });
  }

  if (method === "GET" && path === "/api/instructor/today") {
    requireRole(user, "instructor", messages.instructorOnly);
    const lessons = await instructorToday(env, user.id, today.startIso, today.endIso);
    return json({
      practiceData: practiceData(env),
      displayName: user.displayName,
      allowPreviewLocation: env.ALLOW_PREVIEW_LOCATION === "true",
      lessons: lessons.map((lesson) => presentInstructorLesson(lesson, zone, now)),
    });
  }

  const clockInMatch = path.match(/^\/api\/instructor\/lessons\/([^/]+)\/clock-in$/);
  const clockOutMatch = path.match(/^\/api\/instructor\/lessons\/([^/]+)\/clock-out$/);
  if ((clockInMatch || clockOutMatch) && method === "POST") {
    assertSameOrigin(request);
    requireRole(user, "instructor", messages.instructorOnly);
    const lessonId = decodeURIComponent((clockInMatch ?? clockOutMatch)![1] ?? "");
    const lesson = await loadOwnedLesson(env, lessonId, user.id);
    const body = await readJson(request);
    const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const preview = record.preview === true;
    const point = readLatLng(record.latitude, record.longitude);
    const settings = await getSettings(env);
    const distance = point ? distanceYards({ lat: lesson.lat, lng: lesson.lng }, point) : null;
    if (clockInMatch) {
      const decision = evaluateClockIn({
        status: lesson.status,
        sameDay: isSameLocalDay(lesson.starts_at, now, zone),
        anotherOpen: await hasOtherOpenLesson(env, user.id, lesson.id),
        preview,
        previewAllowed: env.ALLOW_PREVIEW_LOCATION === "true",
        hasDeviceLocation: Boolean(point),
        distanceYards: distance,
        radiusYards: settings.clockInRadiusYards,
      });
      if (!decision.ok) throw new HttpError(400, decision.error);
      await clockInLesson(env, lesson, decision.source, decision.distanceYards, now);
      console.log(JSON.stringify({ event: "clock_in", lessonId: lesson.id, userId: user.id, source: decision.source }));
      return json({ message: messages.clockedIn });
    }
    const decision = evaluateClockOut({
      status: lesson.status,
      preview,
      previewAllowed: env.ALLOW_PREVIEW_LOCATION === "true",
      hasDeviceLocation: Boolean(point),
      distanceYards: distance,
      radiusYards: settings.clockInRadiusYards,
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
      rows: report.rows.map((row) => presentReportRow(row, settings.lateThresholdMinutes, zone)),
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
