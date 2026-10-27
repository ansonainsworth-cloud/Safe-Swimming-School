import { timingStatus } from "./clock-rules";
import { minutesLateLabel, messages } from "./messages";
import type { LessonRecord, ParentLessonRecord, ReportRecord } from "./store";
import { formatDay, formatTime, formatTimeRange, minutesAfter } from "./time";

function lateDetail(actualIso: string | null, scheduledIso: string, status: string): string {
  if (status !== messages.late || !actualIso) return "";
  return minutesLateLabel(minutesAfter(actualIso, scheduledIso));
}

export function lessonStatusLabel(status: string, startsAt: string, now: Date): string {
  if (status === "completed") return messages.finished;
  if (status === "in_progress") return messages.inProgress;
  if (Date.parse(startsAt) < now.getTime()) return messages.notClockedIn;
  return messages.upcoming;
}

export function presentParentLesson(lesson: ParentLessonRecord, timeZone: string, now: Date) {
  return {
    id: lesson.id,
    childFirstName: lesson.child_first_name,
    instructorName: lesson.instructor_name,
    address: lesson.address,
    dateLabel: formatDay(lesson.starts_at, timeZone),
    timeLabel: formatTimeRange(lesson.starts_at, lesson.ends_at, timeZone),
    statusLabel: lessonStatusLabel(lesson.status, lesson.starts_at, now),
  };
}

export function presentInstructorLesson(lesson: LessonRecord, timeZone: string, now: Date) {
  return {
    id: lesson.id,
    childFirstName: lesson.child_first_name,
    familyName: lesson.family_name,
    address: lesson.address,
    latitude: lesson.lat,
    longitude: lesson.lng,
    lessonsRemaining: lesson.lessons_remaining,
    dateLabel: formatDay(lesson.starts_at, timeZone),
    timeLabel: formatTimeRange(lesson.starts_at, lesson.ends_at, timeZone),
    statusLabel: lessonStatusLabel(lesson.status, lesson.starts_at, now),
    clockInLabel: lesson.clock_in_at ? formatTime(lesson.clock_in_at, timeZone) : "",
    clockOutLabel: lesson.clock_out_at ? formatTime(lesson.clock_out_at, timeZone) : "",
    canClockIn: lesson.status === "scheduled",
    canClockOut: lesson.status === "in_progress",
  };
}

export function presentReportRow(row: ReportRecord, thresholdMinutes: number, timeZone: string) {
  const startStatus = timingStatus(row.clock_in_at, row.starts_at, thresholdMinutes);
  const endStatus = timingStatus(row.clock_out_at, row.ends_at, thresholdMinutes);
  let actualEndLabel: string = messages.notYet;
  if (row.clock_out_at) actualEndLabel = formatTime(row.clock_out_at, timeZone);
  else if (row.status === "in_progress") actualEndLabel = messages.stillInLesson;
  return {
    lessonId: row.lesson_id,
    childFirstName: row.child_first_name,
    familyName: row.family_name,
    dateLabel: formatDay(row.starts_at, timeZone),
    scheduledStartLabel: formatTime(row.starts_at, timeZone),
    actualStartLabel: row.clock_in_at ? formatTime(row.clock_in_at, timeZone) : messages.notYet,
    startStatus,
    startDetail: lateDetail(row.clock_in_at, row.starts_at, startStatus),
    scheduledEndLabel: formatTime(row.ends_at, timeZone),
    actualEndLabel,
    endStatus: row.clock_out_at ? endStatus : messages.notYet,
    endDetail: row.clock_out_at ? lateDetail(row.clock_out_at, row.ends_at, endStatus) : "",
    canUndo: Boolean(row.adjustment_id),
  };
}
