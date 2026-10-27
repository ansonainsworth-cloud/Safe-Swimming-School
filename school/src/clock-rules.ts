import { tooFarMessage } from "./messages";

export type ClockSource = "device" | "preview";

export interface ClockDecisionOk {
  ok: true;
  source: ClockSource;
  distanceYards: number;
}

export interface ClockDecisionNo {
  ok: false;
  error: string;
}

export type ClockDecision = ClockDecisionOk | ClockDecisionNo;

interface ClockInput {
  status: string;
  sameDay: boolean;
  anotherOpen: boolean;
  preview: boolean;
  previewAllowed: boolean;
  hasDeviceLocation: boolean;
  distanceYards: number | null;
  radiusYards: number;
}

export function evaluateClockIn(input: ClockInput): ClockDecision {
  if (input.status === "completed") return { ok: false, error: "This lesson is already finished." };
  if (input.status === "in_progress") return { ok: false, error: "This lesson is already clocked in." };
  if (!input.sameDay) return { ok: false, error: "Clock in is available on the day of the lesson." };
  if (input.anotherOpen) return { ok: false, error: "Clock out of the open lesson before you clock in to another." };
  return checkPlace(input, "clock in");
}

export function evaluateClockOut(input: Pick<ClockInput, "status" | "preview" | "previewAllowed" | "hasDeviceLocation" | "distanceYards" | "radiusYards">): ClockDecision {
  if (input.status === "completed") return { ok: false, error: "This lesson is already finished." };
  if (input.status !== "in_progress") return { ok: false, error: "Clock in before you clock out." };
  return checkPlace(input, "clock out");
}

function checkPlace(
  input: Pick<ClockInput, "preview" | "previewAllowed" | "hasDeviceLocation" | "distanceYards" | "radiusYards">,
  action: "clock in" | "clock out",
): ClockDecision {
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

export type BalanceOutcome = "subtracted" | "unchanged" | "none_left";

export function balanceAfterClockOut(input: {
  current: number;
  auto: boolean;
  alreadyDecremented: boolean;
}): { balance: number; delta: number; outcome: BalanceOutcome } {
  if (!input.auto || input.alreadyDecremented) {
    return { balance: input.current, delta: 0, outcome: "unchanged" };
  }
  if (input.current <= 0) {
    return { balance: 0, delta: 0, outcome: "none_left" };
  }
  return { balance: input.current - 1, delta: -1, outcome: "subtracted" };
}

export function balanceAfterUndo(current: number): number {
  return current + 1;
}

export type TimingStatus = "On time" | "Late" | "Not yet";

export function timingStatus(actualIso: string | null, scheduledIso: string, thresholdMinutes: number): TimingStatus {
  if (!actualIso) return "Not yet";
  const minutes = (Date.parse(actualIso) - Date.parse(scheduledIso)) / 60_000;
  return minutes > thresholdMinutes ? "Late" : "On time";
}
