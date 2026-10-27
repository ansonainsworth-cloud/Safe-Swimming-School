const base = process.env.BASE_URL || "http://127.0.0.1:8787";

function client() {
  let cookie = "";
  return {
    async fetch(path, options = {}) {
      const headers = new Headers(options.headers || {});
      if (cookie) headers.set("cookie", cookie);
      if (options.body) headers.set("content-type", "application/json");
      const response = await fetch(base + path, { method: options.method || "GET", headers, body: options.body });
      for (const item of response.headers.getSetCookie?.() || []) {
        const pair = item.split(";")[0];
        if (pair.startsWith("sss_session=")) cookie = pair;
      }
      const text = await response.text();
      let data = text;
      try { data = JSON.parse(text); } catch { /* html */ }
      return { status: response.status, data };
    },
    clear() { cookie = ""; },
  };
}

function check(condition, message) {
  if (!condition) throw new Error(message);
}

async function signIn(api, email) {
  const requested = await api.fetch("/api/auth/request", { method: "POST", body: JSON.stringify({ email }) });
  check(requested.status === 200 && requested.data.devLink, `missing preview link for ${email}`);
  const token = new URL(requested.data.devLink).searchParams.get("token");
  const verified = await api.fetch("/api/auth/verify", { method: "POST", body: JSON.stringify({ token }) });
  check(verified.status === 200, `verify failed for ${email}`);
}

const parent = client();
const instructor = client();

const health = await parent.fetch("/api/health");
check(health.data.appName === "Safe Swimming School", "health app name");
check(health.data.dataSource === "mock", "health data source");
check(!JSON.stringify(health.data).includes("PRIVATE"), "health leaked a secret marker");

const privacy = await parent.fetch("/privacy/");
check(privacy.status === 200 && String(privacy.data).includes("first name"), "privacy page");
const manifest = await parent.fetch("/manifest.webmanifest");
check(manifest.status === 200 && manifest.data.name === "Safe Swimming School", "manifest");

const unknown = await parent.fetch("/api/auth/request", { method: "POST", body: JSON.stringify({ email: "nobody@example.com" }) });
check(unknown.status === 200 && !unknown.data.devLink, "unknown email stays private");

await signIn(parent, "henry.family@example.com");
const home = await parent.fetch("/api/parent/home");
check(home.status === 200, "parent home");
check(home.data.lessonsRemaining === 8, `expected 8 lessons, got ${home.data.lessonsRemaining}`);
check(home.data.children.join(",") === "Henry", "child first name");
check(home.data.instructorName === "Anson Ainsworth", "own instructor");
check(home.data.lessons.length >= 1, "upcoming lessons");
check(!JSON.stringify(home.data).includes("family_other"), "no other family");
const denied = await parent.fetch("/api/admin/report");
check(denied.status === 403, "parent cannot open the admin report");

await signIn(instructor, "anson@example.com");
const today = await instructor.fetch("/api/instructor/today");
check(today.status === 200 && today.data.lessons.length >= 1, "instructor today");
const lesson = today.data.lessons.find((item) => item.canClockIn);
check(lesson, "a lesson can be clocked in");
check(String(lesson.address).includes("Sample Court"), "lesson address");
const far = await instructor.fetch(`/api/instructor/lessons/${encodeURIComponent(lesson.id)}/clock-in`, {
  method: "POST",
  body: JSON.stringify({ latitude: 25.76, longitude: -80.19 }),
});
check(far.status === 400 && String(far.data.error).includes("yards"), "far clock in is rejected");
const clockIn = await instructor.fetch(`/api/instructor/lessons/${encodeURIComponent(lesson.id)}/clock-in`, {
  method: "POST",
  body: JSON.stringify({ preview: true }),
});
check(clockIn.status === 200, `clock in failed: ${JSON.stringify(clockIn.data)}`);
const again = await instructor.fetch(`/api/instructor/lessons/${encodeURIComponent(lesson.id)}/clock-in`, {
  method: "POST",
  body: JSON.stringify({ preview: true }),
});
check(again.status === 400, "second clock in should fail");
const clockOut = await instructor.fetch(`/api/instructor/lessons/${encodeURIComponent(lesson.id)}/clock-out`, {
  method: "POST",
  body: JSON.stringify({ preview: true }),
});
check(clockOut.status === 200 && clockOut.data.lessonsRemaining === 7, `clock out balance: ${JSON.stringify(clockOut.data)}`);

parent.clear();
await signIn(parent, "henry.family@example.com");
const after = await parent.fetch("/api/parent/home");
check(after.data.lessonsRemaining === 7, "parent sees the subtracted lesson");

const report = await instructor.fetch("/api/admin/report");
check(report.status === 200, "admin report");
check(report.data.rows.some((row) => row.startStatus === "Late" && row.startDetail.includes("12")), "late lesson is on the report");
const undoRow = report.data.rows.find((row) => row.lessonId === lesson.id && row.canUndo);
check(undoRow, "today lesson can be undone");
const undo = await instructor.fetch(`/api/admin/lessons/${encodeURIComponent(lesson.id)}/undo`, { method: "POST", body: "{}" });
check(undo.status === 200 && undo.data.lessonsRemaining === 8, "undo restores the count");

const changed = await instructor.fetch("/api/admin/settings", {
  method: "PUT",
  body: JSON.stringify({ ...report.data.settings, clockInRadiusYards: 150 }),
});
check(changed.status === 200 && changed.data.settings.clockInRadiusYards === 150, "settings save");
const restored = await instructor.fetch("/api/admin/settings", {
  method: "PUT",
  body: JSON.stringify({ ...changed.data.settings, clockInRadiusYards: 100 }),
});
check(restored.data.settings.clockInRadiusYards === 100, "settings restored");
check(restored.data.settings.lateThresholdMinutes === 5, "late threshold");
check(restored.data.settings.autoDecrementOnClockOut === true, "auto subtract");
check(restored.data.settings.arrivalTextEnabled === true, "arrival text");
check(restored.data.settings.arrivalTextMinutes === 10, "arrival minutes");

console.log("smoke ok");
