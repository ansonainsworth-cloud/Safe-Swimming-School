import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { maybeNotifyArrival } from "../src/arrival";
import {
  GoogleCalendarAdapter,
  MockCalendarAdapter,
  StubSmsAdapter,
  TwilioSmsAdapter,
  googleCalendarUrl,
  googleSheetsUrl,
  missingGoogleFields,
  missingSmsFields,
  twilioMessagesUrl,
} from "../src/adapters";
import { balanceAfterClockOut, balanceAfterUndo, evaluateClockIn, evaluateClockOut, timingStatus } from "../src/clock-rules";
import { distanceYards } from "../src/geo";
import { locationExpired, phaseAfterClockOut, shouldSendArrivalText } from "../src/live-location";
import { arrivalText, messages, minutesLateLabel, tooFarMessage } from "../src/messages";
import { henryFamily } from "../src/mock-data";
import { firstNameOnly } from "../src/names";
import { buildMockLessons } from "../src/schedule";
import { PRODUCT_DEFAULTS, defaultsFromEnv, validateSettings } from "../src/settings";
import { addMinutesIso, formatTime, localDayBounds, zonedTimeToUtc } from "../src/time";

const ZONE = "America/New_York";
const DASH = /[-\u2010-\u2015\u2212]/;

function assertNoDash(label: string, value: string) {
  expect(value, label).not.toMatch(DASH);
}

describe("Anson defaults", () => {
  it("uses a 100 yard radius, a 5 minute late threshold, automatic subtraction, and a 10 minute text", () => {
    expect(PRODUCT_DEFAULTS).toEqual({
      clockInRadiusYards: 100,
      lateThresholdMinutes: 5,
      autoDecrementOnClockOut: true,
      arrivalTextEnabled: true,
      arrivalTextMinutes: 10,
    });
    expect(defaultsFromEnv({})).toEqual(PRODUCT_DEFAULTS);
  });
});

describe("clock and balance rules", () => {
  const base = {
    status: "scheduled",
    sameDay: true,
    anotherOpen: false,
    preview: false,
    previewAllowed: false,
    hasDeviceLocation: true,
    distanceYards: 40,
    radiusYards: 100,
  };

  it("accepts a clock in inside 100 yards and rejects one outside", () => {
    expect(evaluateClockIn(base).ok).toBe(true);
    const far = evaluateClockIn({ ...base, distanceYards: 101 });
    expect(far.ok).toBe(false);
    if (!far.ok) expect(far.error).toContain("100 yards");
  });

  it("allows preview location only when the server flag is on", () => {
    expect(evaluateClockIn({ ...base, preview: true, hasDeviceLocation: false, distanceYards: null }).ok).toBe(false);
    const preview = evaluateClockIn({ ...base, preview: true, previewAllowed: true, hasDeviceLocation: false, distanceYards: null });
    expect(preview).toMatchObject({ ok: true, source: "preview", distanceYards: 0 });
  });

  it("blocks a second open lesson and a clock out before clock in", () => {
    expect(evaluateClockIn({ ...base, anotherOpen: true }).ok).toBe(false);
    expect(evaluateClockOut({ ...base, status: "scheduled" }).ok).toBe(false);
    expect(evaluateClockOut({ ...base, status: "in_progress" }).ok).toBe(true);
  });

  it("subtracts one lesson at clock out and restores it on undo", () => {
    expect(balanceAfterClockOut({ current: 8, auto: true, alreadyDecremented: false })).toEqual({
      balance: 7,
      delta: -1,
      outcome: "subtracted",
    });
    expect(balanceAfterClockOut({ current: 8, auto: false, alreadyDecremented: false }).outcome).toBe("unchanged");
    expect(balanceAfterClockOut({ current: 0, auto: true, alreadyDecremented: false }).outcome).toBe("none_left");
    expect(balanceAfterUndo(7)).toBe(8);
  });

  it("marks a start late only after the 5 minute threshold", () => {
    const start = "2026-10-26T20:00:00.000Z";
    expect(timingStatus(addMinutesIso(start, 5), start, 5)).toBe("On time");
    expect(timingStatus(addMinutesIso(start, 6), start, 5)).toBe("Late");
    expect(timingStatus(null, start, 5)).toBe("Not yet");
    expect(minutesLateLabel(12)).toBe("12 minutes late");
  });
});

describe("practice schedule", () => {
  it("builds yesterday, today, and tomorrow in Palm Beach County time", () => {
    const now = new Date("2026-10-27T20:00:00.000Z");
    const lessons = buildMockLessons(now, ZONE);
    expect(lessons.map((lesson) => lesson.childFirstName)).toEqual(["Henry", "Henry", "Henry"]);
    expect(formatTime(lessons[0]!.startsAt, ZONE)).toBe("4:00 PM");
    expect(formatTime(lessons[1]!.startsAt, ZONE)).toBe("5:00 PM");
    expect(formatTime(lessons[2]!.startsAt, ZONE)).toBe("10:00 AM");
    const yesterday = lessons[0]!;
    const clockIn = addMinutesIso(yesterday.startsAt, yesterday.demoHistory!.clockInOffsetMinutes);
    const clockOut = addMinutesIso(yesterday.startsAt, yesterday.demoHistory!.clockOutOffsetMinutes);
    expect(timingStatus(clockIn, yesterday.startsAt, 5)).toBe("Late");
    expect(timingStatus(clockOut, yesterday.endsAt, 5)).toBe("On time");
    expect(localDayBounds(now, ZONE)).toEqual({
      startIso: "2026-10-27T04:00:00.000Z",
      endIso: "2026-10-28T04:00:00.000Z",
    });
    expect(zonedTimeToUtc(2026, 12, 1, 12, 0, ZONE).toISOString()).toBe("2026-12-01T17:00:00.000Z");
  });
});

describe("distance", () => {
  it("measures about 100 yards of latitude", () => {
    const origin = { lat: henryFamily.lat, lng: henryFamily.lng };
    const meters = 100 * 0.9144;
    const delta = meters / ((6_371_000 * Math.PI) / 180);
    const nearby = { lat: origin.lat + delta, lng: origin.lng };
    expect(distanceYards(origin, origin)).toBe(0);
    expect(distanceYards(origin, nearby)).toBeGreaterThan(99);
    expect(distanceYards(origin, nearby)).toBeLessThan(101);
  });
});

describe("privacy and the later live location phase", () => {
  it("stops sharing at clock out and deletes points once they are 24 hours old", () => {
    expect(phaseAfterClockOut()).toBe("stopped");
    const now = new Date("2026-10-27T20:00:00.000Z");
    expect(locationExpired(new Date(now.getTime() - 23 * 60 * 60 * 1000).toISOString(), now)).toBe(false);
    expect(locationExpired(new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(), now)).toBe(true);
  });

  it("texts the family once when the instructor is about 10 minutes away", async () => {
    const sms = new StubSmsAdapter();
    const input = {
      enabled: true,
      etaMinutes: 10,
      thresholdMinutes: 10,
      alreadySent: false,
      instructorFirst: "Anson",
      childFirst: "Henry",
      to: henryFamily.phone,
      sms,
    };
    expect((await maybeNotifyArrival(input)).sent).toBe(true);
    expect(sms.sent[0]?.body).toBe(arrivalText("Anson", "Henry", 10));
    expect((await maybeNotifyArrival({ ...input, alreadySent: true })).sent).toBe(false);
    expect((await maybeNotifyArrival({ ...input, etaMinutes: 11, sms: new StubSmsAdapter() })).sent).toBe(false);
    expect(shouldSendArrivalText({ enabled: false, etaMinutes: 5, thresholdMinutes: 10, alreadySent: false }).send).toBe(false);
  });

  it("keeps a child record to a first name", () => {
    expect(firstNameOnly("Henry Smith")).toBe("Henry");
    expect(firstNameOnly("Henry")).toBe("Henry");
  });
});

describe("adapters stay stubs until credentials exist", () => {
  it("names the missing Google and Twilio settings without calling them", async () => {
    expect(missingGoogleFields({
      DATA_SOURCE: "google",
      CALENDAR_ID: "",
      LESSON_TRACKER_SPREADSHEET_ID: "",
      LESSON_TRACKER_RANGE: "Lesson Tracker!A2:F",
      GOOGLE_SERVICE_ACCOUNT_EMAIL: "",
      privateKey: "",
    })).toEqual([
      "CALENDAR_ID",
      "LESSON_TRACKER_SPREADSHEET_ID",
      "GOOGLE_SERVICE_ACCOUNT_EMAIL",
      "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY",
    ]);
    expect(googleCalendarUrl("anson-calendar")).toContain("calendar/v3");
    expect(googleSheetsUrl("sheet", "Lesson Tracker!A2:F")).toContain("spreadsheets");
    expect(missingSmsFields({ SMS_PROVIDER: "twilio", SMS_FROM_NUMBER: "", accountSid: "", authToken: "" })).toHaveLength(3);
    expect(twilioMessagesUrl("AC000")).toContain("Messages.json");
    const calendar = new GoogleCalendarAdapter({
      DATA_SOURCE: "google",
      CALENDAR_ID: "cal",
      LESSON_TRACKER_SPREADSHEET_ID: "sheet",
      LESSON_TRACKER_RANGE: "Lesson Tracker!A2:F",
      GOOGLE_SERVICE_ACCOUNT_EMAIL: "svc@example.com",
      privateKey: "secret",
    });
    await expect(calendar.listLessons(new Date())).rejects.toThrow(messages.calendarNotConnected);
    await expect(new TwilioSmsAdapter({
      SMS_PROVIDER: "twilio",
      SMS_FROM_NUMBER: "+15555501000",
      accountSid: "AC000",
      authToken: "token",
    }).send({ to: "+15555501000", body: "Hello" })).rejects.toThrow(messages.smsNotConfigured);
    const mock = await new MockCalendarAdapter(ZONE).listLessons(new Date("2026-10-27T20:00:00.000Z"));
    expect(mock).toHaveLength(3);
  });

  it("rejects settings outside the allowed ranges", () => {
    expect(validateSettings({ ...PRODUCT_DEFAULTS, clockInRadiusYards: 10 }).ok).toBe(false);
    expect(validateSettings(PRODUCT_DEFAULTS).ok).toBe(true);
  });
});

describe("user facing copy", () => {
  it("has no dashes, no lifesaving claims, and no other school names", async () => {
    const { copy, clockedInAt, clockedOutAt, instructorLine, lessonsLeftLine } = await import("../public/js/copy.js");
    const strings = [
      ...Object.values(copy),
      ...Object.values(messages).filter((value) => typeof value === "string"),
      clockedInAt("5:00 PM"),
      clockedOutAt("5:30 PM"),
      instructorLine("Anson Ainsworth"),
      lessonsLeftLine(8),
      lessonsLeftLine(1),
      tooFarMessage("clock in", 240, 100),
      tooFarMessage("clock out", 240, 100),
      arrivalText("Anson", "Henry", 10),
      henryFamily.address,
      henryFamily.name,
      henryFamily.childFirstName,
    ];
    for (const value of strings) assertNoDash("copy", value);
    const pages = ["public/index.html", "public/privacy/index.html"].map((file) =>
      readFileSync(resolve("public", file.replace("public/", "")), "utf8")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " "),
    );
    const visible = pages.join("\n");
    expect(visible).not.toMatch(DASH);
    const blob = strings.join("\n") + visible;
    expect(blob.toLowerCase()).not.toContain("lifesaving");
    expect(blob.toLowerCase()).not.toContain("life saving");
    for (const name of ["goldfish", "safesplash", "aqua tots", "british swim"]) {
      expect(blob.toLowerCase()).not.toContain(name);
    }
  });
});
