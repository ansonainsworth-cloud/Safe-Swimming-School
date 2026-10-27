import { clockedInAt, clockedOutAt, copy, instructorLine, lessonsLeftLine } from "./copy.js";

const app = document.querySelector("#app");
const topActions = document.querySelector("#top-actions");
const state = { me: null, config: null, notice: "", error: "" };

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function pill(label) {
  const kind = label === "Late" ? "late" : label === "On time" ? "ok" : "wait";
  return `<span class="pill pill-${kind}">${esc(label)}</span>`;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || copy.genericError);
  return data;
}

function viewFor(me) {
  const saved = sessionStorage.getItem("sssView");
  if (saved && me.roles.includes(saved)) return saved;
  if (me.roles.includes("instructor")) return "instructor";
  if (me.roles.includes("admin")) return "admin";
  return "parent";
}

function setNotice(message) {
  state.notice = message || "";
  state.error = "";
}

function setError(message) {
  state.error = message || "";
  state.notice = "";
}

function practiceBanner(flag) {
  if (!flag) return "";
  return `<div class="banner">${esc(copy.practiceData)}</div>`;
}

function notices() {
  return `${state.error ? `<div class="error" role="alert">${esc(state.error)}</div>` : ""}${state.notice ? `<div class="flash" role="status">${esc(state.notice)}</div>` : ""}`;
}

function renderTop() {
  if (!state.me) {
    topActions.innerHTML = "";
    return;
  }
  const roles = state.me.roles;
  const view = viewFor(state.me);
  const switcher = roles.includes("instructor") && roles.includes("admin")
    ? `<div class="segment" role="group" aria-label="${esc(copy.view)}">
        <button type="button" data-action="view" data-view="instructor" aria-pressed="${view === "instructor"}">${esc(copy.instructor)}</button>
        <button type="button" data-action="view" data-view="admin" aria-pressed="${view === "admin"}">${esc(copy.admin)}</button>
      </div>`
    : "";
  topActions.innerHTML = `${switcher}<button type="button" class="btn-quiet" data-action="sign-out">${esc(copy.signOut)}</button>`;
}

function renderSignIn() {
  const accounts = state.config?.previewSignIn ? state.config.accounts : [];
  const accountButtons = accounts.map((account) =>
    `<button type="button" class="btn-ghost" data-action="preview-account" data-email="${esc(account.email)}">${esc(account.label)}</button>`,
  ).join("");
  app.innerHTML = `
    ${notices()}
    <section class="card">
      <h1>${esc(copy.signInHeading)}</h1>
      <p class="tagline">${esc(copy.tagline)}</p>
      <form id="sign-in-form">
        <label for="email">${esc(copy.emailLabel)}</label>
        <input id="email" name="email" type="email" autocomplete="email" required placeholder="${esc(copy.emailPlaceholder)}">
        <button class="btn-primary" type="submit">${esc(copy.sendLink)}</button>
      </form>
      <p class="meta">${esc(copy.linkHelp)}</p>
      ${accounts.length ? `<h2>${esc(copy.previewHeading)}</h2><p class="meta">${esc(copy.previewHelp)}</p><div class="preview-accounts">${accountButtons}</div>` : ""}
      <p class="meta">${esc(copy.installHint)}</p>
    </section>`;
}

function renderParent(data) {
  const lessons = data.lessons.length
    ? data.lessons.map((lesson) => `
      <article class="card" data-testid="parent-lesson">
        <p class="time">${esc(lesson.timeLabel)}</p>
        <p class="child">${esc(lesson.childFirstName)}</p>
        <p class="meta">${esc(lesson.dateLabel)}</p>
        <p class="meta">${esc(instructorLine(lesson.instructorName))}</p>
        <p>${pill(lesson.statusLabel)}</p>
      </article>`).join("")
    : `<section class="card"><p>${esc(copy.noUpcoming)}</p></section>`;
  app.innerHTML = `
    ${notices()}
    ${practiceBanner(data.practiceData)}
    <section class="card balance" data-testid="parent-balance">
      <p class="balance-kicker">${esc(copy.lessonsLeft)}</p>
      <p class="balance-number">${esc(data.lessonsRemaining)}</p>
      <p>${esc(data.familyName)}</p>
      <p>${esc(copy.sharedBalance)}</p>
      <p>${esc(data.children.join(", "))}</p>
    </section>
    <h2>${esc(copy.upcoming)}</h2>
    ${lessons}`;
}

function renderInstructor(data) {
  const lessons = data.lessons.length
    ? data.lessons.map((lesson) => {
      const directions = `https://maps.google.com/maps?daddr=${encodeURIComponent(`${lesson.latitude},${lesson.longitude}`)}`;
      const clocked = lesson.clockInLabel ? `<p class="meta">${esc(clockedInAt(lesson.clockInLabel))}</p>` : "";
      const finished = lesson.clockOutLabel ? `<p class="meta">${esc(clockedOutAt(lesson.clockOutLabel))}</p>` : "";
      let buttons = "";
      if (lesson.canClockIn) {
        buttons += `<button type="button" class="btn-primary" data-action="clock" data-clock="clock-in" data-lesson="${esc(lesson.id)}">${esc(copy.clockIn)}</button>`;
        if (data.allowPreviewLocation) {
          buttons += `<button type="button" class="btn-ghost" data-action="clock" data-clock="clock-in" data-preview="true" data-lesson="${esc(lesson.id)}">${esc(copy.previewClockIn)}</button>`;
        }
      }
      if (lesson.canClockOut) {
        buttons += `<button type="button" class="btn-primary" data-action="clock" data-clock="clock-out" data-lesson="${esc(lesson.id)}">${esc(copy.clockOut)}</button>`;
        if (data.allowPreviewLocation) {
          buttons += `<button type="button" class="btn-ghost" data-action="clock" data-clock="clock-out" data-preview="true" data-lesson="${esc(lesson.id)}">${esc(copy.previewClockOut)}</button>`;
        }
      }
      return `
        <article class="card" data-testid="instructor-lesson">
          <p class="time">${esc(lesson.timeLabel)}</p>
          <p class="child">${esc(lesson.childFirstName)}</p>
          <p class="meta">${esc(lesson.familyName)}</p>
          <p class="meta">${esc(lesson.dateLabel)}</p>
          <address class="address">${esc(lesson.address)}</address>
          <p class="meta">${esc(lessonsLeftLine(lesson.lessonsRemaining))}</p>
          <p>${pill(lesson.statusLabel)}</p>
          ${clocked}${finished}
          <div class="actions">
            ${buttons}
            <a class="btn btn-quiet" href="${directions}" target="_blank" rel="noopener">${esc(copy.openDirections)}</a>
          </div>
        </article>`;
    }).join("")
    : `<section class="card"><p>${esc(copy.noLessonsToday)}</p></section>`;
  app.innerHTML = `
    ${notices()}
    ${practiceBanner(data.practiceData)}
    <h1>${esc(copy.today)}</h1>
    <p class="who">${esc(data.displayName)}</p>
    ${lessons}`;
}

function timeRow(label, scheduled, actual, status, detail) {
  return `
    <strong>${esc(label)}</strong>
    <span>${esc(scheduled)}</span>
    <span>${esc(actual)}</span>
    ${pill(status)}
    ${detail ? `<p class="detail">${esc(detail)}</p>` : ""}`;
}

function renderAdmin(data) {
  const families = data.families.map((family) =>
    `<p class="meta">${esc(family.name)}: ${esc(lessonsLeftLine(family.lessonsRemaining))}</p>`,
  ).join("");
  const rows = data.rows.map((row) => `
    <article class="card" data-testid="admin-row">
      <p class="time">${esc(row.dateLabel)}</p>
      <p class="child">${esc(row.childFirstName)}</p>
      <p class="meta">${esc(row.familyName)}</p>
      <div class="times">
        <strong></strong><strong>${esc(copy.scheduled)}</strong><strong>${esc(copy.actual)}</strong><strong></strong>
        ${timeRow(copy.start, row.scheduledStartLabel, row.actualStartLabel, row.startStatus, row.startDetail)}
        ${timeRow(copy.end, row.scheduledEndLabel, row.actualEndLabel, row.endStatus, row.endDetail)}
      </div>
      ${row.canUndo ? `<div class="actions"><button type="button" class="btn-navy" data-action="undo" data-lesson="${esc(row.lessonId)}">${esc(copy.undo)}</button></div>` : ""}
    </article>`).join("");
  const settings = data.settings;
  app.innerHTML = `
    ${notices()}
    ${practiceBanner(data.practiceData)}
    <h1>${esc(copy.onTimeReport)}</h1>
    ${families}
    ${rows || `<section class="card"><p>${esc(copy.noLessonsToday)}</p></section>`}
    <section class="card">
      <h2>${esc(copy.settingsHeading)}</h2>
      <p class="meta">${esc(copy.settingsIntro)}</p>
      <form id="settings-form">
        <label for="radius">${esc(copy.radiusLabel)}</label>
        <input id="radius" name="radius" type="number" min="25" max="500" step="1" value="${esc(settings.clockInRadiusYards)}">
        <label for="late">${esc(copy.lateLabel)}</label>
        <input id="late" name="late" type="number" min="0" max="30" step="1" value="${esc(settings.lateThresholdMinutes)}">
        <label class="check"><input name="auto" type="checkbox" ${settings.autoDecrementOnClockOut ? "checked" : ""}> ${esc(copy.autoLabel)}</label>
        <label class="check"><input name="arrival" type="checkbox" ${settings.arrivalTextEnabled ? "checked" : ""}> ${esc(copy.arrivalEnabledLabel)}</label>
        <label for="arrival-minutes">${esc(copy.arrivalMinutesLabel)}</label>
        <input id="arrival-minutes" name="arrivalMinutes" type="number" min="1" max="30" step="1" value="${esc(settings.arrivalTextMinutes)}">
        <button class="btn-primary" type="submit">${esc(copy.saveSettings)}</button>
      </form>
    </section>`;
}

async function render() {
  renderTop();
  if (!state.me) {
    renderSignIn();
    return;
  }
  const view = viewFor(state.me);
  if (view === "parent") renderParent(await api("/api/parent/home"));
  else if (view === "admin") renderAdmin(await api("/api/admin/report"));
  else renderInstructor(await api("/api/instructor/today"));
}

async function locate() {
  if (!navigator.geolocation) throw new Error(copy.locationFailed);
  const position = await new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
  });
  return { latitude: position.coords.latitude, longitude: position.coords.longitude };
}

async function boot() {
  const params = new URLSearchParams(location.search);
  const token = params.get("token");
  if (token) history.replaceState({}, "", "/");
  state.config = await api("/api/auth/config").catch(() => ({ previewSignIn: false, accounts: [] }));
  if (token) {
    try {
      await api("/api/auth/verify", { method: "POST", body: { token } });
    } catch (error) {
      setError(error.message);
    }
  }
  try {
    state.me = await api("/api/me");
  } catch {
    state.me = null;
  }
  try {
    await render();
  } catch (error) {
    setError(error.message);
    renderSignIn();
  }
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
}

document.addEventListener("submit", async (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  if (form.id === "sign-in-form") {
    const email = new FormData(form).get("email");
    try {
      const result = await api("/api/auth/request", { method: "POST", body: { email } });
      setNotice(result.message);
      renderSignIn();
      if (result.devLink) {
        const box = document.createElement("p");
        box.className = "actions";
        box.innerHTML = `<a class="btn btn-navy" href="${esc(result.devLink)}">${esc(copy.openPreviewLink)}</a>`;
        form.insertAdjacentElement("afterend", box);
      }
    } catch (error) {
      setError(error.message);
      renderSignIn();
    }
  }
  if (form.id === "settings-form") {
    const data = new FormData(form);
    try {
      const result = await api("/api/admin/settings", {
        method: "PUT",
        body: {
          clockInRadiusYards: Number(data.get("radius")),
          lateThresholdMinutes: Number(data.get("late")),
          autoDecrementOnClockOut: data.get("auto") === "on",
          arrivalTextEnabled: data.get("arrival") === "on",
          arrivalTextMinutes: Number(data.get("arrivalMinutes")),
        },
      });
      setNotice(result.message);
      await render();
    } catch (error) {
      setError(error.message);
      await render();
    }
  }
});

document.addEventListener("click", async (event) => {
  const target = event.target instanceof Element ? event.target.closest("[data-action]") : null;
  if (!target) return;
  const action = target.getAttribute("data-action");
  if (action === "preview-account") {
    const input = document.querySelector("#email");
    if (input) input.value = target.getAttribute("data-email") || "";
    document.querySelector("#sign-in-form")?.requestSubmit();
    return;
  }
  if (action === "sign-out") {
    await api("/api/auth/logout", { method: "POST", body: {} });
    sessionStorage.removeItem("sssView");
    state.me = null;
    setNotice("");
    renderSignIn();
    renderTop();
    return;
  }
  if (action === "view") {
    sessionStorage.setItem("sssView", target.getAttribute("data-view") || "instructor");
    setNotice("");
    try { await render(); } catch (error) { setError(error.message); }
    return;
  }
  if (action === "undo") {
    target.setAttribute("disabled", "true");
    try {
      const result = await api(`/api/admin/lessons/${encodeURIComponent(target.getAttribute("data-lesson") || "")}/undo`, { method: "POST", body: {} });
      setNotice(result.message);
      await render();
    } catch (error) {
      setError(error.message);
      await render();
    }
    return;
  }
  if (action === "clock") {
    const lessonId = target.getAttribute("data-lesson") || "";
    const clock = target.getAttribute("data-clock") || "clock-in";
    const preview = target.getAttribute("data-preview") === "true";
    target.setAttribute("disabled", "true");
    try {
      const body = preview ? { preview: true } : await locate();
      const result = await api(`/api/instructor/lessons/${encodeURIComponent(lessonId)}/${clock}`, { method: "POST", body });
      setNotice(result.message);
      await render();
    } catch (error) {
      const denied = error && error.code === 1;
      setError(denied ? copy.locationDenied : error.message || copy.locationFailed);
      await render();
    }
  }
});

boot();
