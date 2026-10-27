import { HttpError } from "./errors";
import { messages } from "./messages";
import { buildMockLessons, type CalendarLesson } from "./schedule";

export interface GoogleConfigInput {
  DATA_SOURCE: string;
  CALENDAR_ID: string;
  LESSON_TRACKER_SPREADSHEET_ID: string;
  LESSON_TRACKER_RANGE: string;
  GOOGLE_SERVICE_ACCOUNT_EMAIL: string;
  privateKey: string;
}

export interface SmsConfigInput {
  SMS_PROVIDER: string;
  SMS_FROM_NUMBER: string;
  accountSid: string;
  authToken: string;
}

export function missingGoogleFields(config: GoogleConfigInput): string[] {
  const missing: string[] = [];
  if (!config.CALENDAR_ID.trim()) missing.push("CALENDAR_ID");
  if (!config.LESSON_TRACKER_SPREADSHEET_ID.trim()) missing.push("LESSON_TRACKER_SPREADSHEET_ID");
  if (!config.GOOGLE_SERVICE_ACCOUNT_EMAIL.trim()) missing.push("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  if (!config.privateKey.trim()) missing.push("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY");
  return missing;
}

export function missingSmsFields(config: SmsConfigInput): string[] {
  if (config.SMS_PROVIDER !== "twilio") return [];
  const missing: string[] = [];
  if (!config.SMS_FROM_NUMBER.trim()) missing.push("SMS_FROM_NUMBER");
  if (!config.accountSid.trim()) missing.push("SMS_ACCOUNT_SID");
  if (!config.authToken.trim()) missing.push("SMS_AUTH_TOKEN");
  return missing;
}

/** Placeholder for the Calendar API. The id is the calendar named Anson Ainsworth Swim. */
export function googleCalendarUrl(calendarId: string): string {
  return `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
}

/**
 * Lesson Tracker columns, row 1 headers, data from row 2:
 * A family id, B lessons remaining, C parent email, D child first name, E phone, F instructor email.
 */
export function googleSheetsUrl(spreadsheetId: string, range: string): string {
  return `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`;
}

/** Twilio Messages resource. The adapter does not call it until credentials exist. */
export function twilioMessagesUrl(accountSid: string): string {
  return `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`;
}

export interface CalendarAdapter {
  listLessons(now: Date): Promise<CalendarLesson[]>;
}

export class MockCalendarAdapter implements CalendarAdapter {
  constructor(private readonly timeZone: string) {}

  async listLessons(now: Date): Promise<CalendarLesson[]> {
    return buildMockLessons(now, this.timeZone);
  }
}

export class GoogleCalendarAdapter implements CalendarAdapter {
  constructor(private readonly config: GoogleConfigInput) {}

  async listLessons(_now: Date): Promise<CalendarLesson[]> {
    const missing = missingGoogleFields(this.config);
    console.log(JSON.stringify({ event: "calendar_not_connected", missing }));
    throw new HttpError(503, messages.calendarNotConnected);
  }
}

export interface TrackerWrite {
  id: string;
  familyId: string;
  lessonsRemaining: number;
  reason: string;
  createdAt: string;
}

export interface LessonTracker {
  writeBalance(db: D1Database, input: TrackerWrite): Promise<{ provider: string }>;
}

export class MockLessonTracker implements LessonTracker {
  async writeBalance(db: D1Database, input: TrackerWrite): Promise<{ provider: string }> {
    await trackerWriteStatement(db, input, "stub").run();
    return { provider: "stub" };
  }
}

export class GoogleLessonTracker implements LessonTracker {
  constructor(private readonly config: GoogleConfigInput) {}

  async writeBalance(_db: D1Database, _input: TrackerWrite): Promise<{ provider: string }> {
    const missing = missingGoogleFields(this.config);
    console.log(JSON.stringify({ event: "tracker_not_connected", missing }));
    throw new HttpError(503, messages.trackerNotConnected);
  }
}

export function trackerWriteStatement(db: D1Database, input: TrackerWrite, provider: string): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO tracker_writes (id, family_id, lessons_remaining, reason, provider, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(input.id, input.familyId, input.lessonsRemaining, input.reason, provider, input.createdAt);
}

export interface SmsMessage {
  to: string;
  body: string;
}

export interface SmsSendResult {
  provider: "stub" | "twilio";
  status: "stubbed" | "sent";
  id: string;
}

export interface SmsAdapter {
  send(message: SmsMessage): Promise<SmsSendResult>;
}

export class StubSmsAdapter implements SmsAdapter {
  readonly sent: SmsMessage[] = [];

  async send(message: SmsMessage): Promise<SmsSendResult> {
    this.sent.push(message);
    return { provider: "stub", status: "stubbed", id: `sms_${this.sent.length}` };
  }
}

export class TwilioSmsAdapter implements SmsAdapter {
  constructor(private readonly config: SmsConfigInput) {}

  async send(_message: SmsMessage): Promise<SmsSendResult> {
    const missing = missingSmsFields(this.config);
    console.log(JSON.stringify({ event: "sms_not_configured", missing }));
    throw new HttpError(503, messages.smsNotConfigured);
  }
}

export function createSmsAdapter(config: SmsConfigInput): SmsAdapter {
  if (config.SMS_PROVIDER === "twilio") return new TwilioSmsAdapter(config);
  return new StubSmsAdapter();
}
