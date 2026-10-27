/**
 * Live location is designed here and stored in D1, but the map is a later phase.
 *
 * Next phase:
 * - Instructor "On my way" starts one en_route session for one lesson and one family.
 * - The phone posts points only while the phase is en_route or on_shift.
 * - Clock in moves the phase to on_shift. Clock out sets stopped and sharing ends.
 * - A parent map would read only that family's active session and an ETA.
 * - An admin map would read active sessions for every family.
 * - The first time ETA is within arrivalTextMinutes, send one text through SmsAdapter.
 * - location_points older than 24 hours are deleted. Session rows stay, without coordinates.
 */

import { LOCATION_RETENTION_HOURS } from "./settings";

export type SharePhase = "en_route" | "on_shift" | "stopped";

export function canRecordLocation(phase: SharePhase): boolean {
  return phase === "en_route" || phase === "on_shift";
}

export function phaseAfterClockIn(): SharePhase {
  return "on_shift";
}

export function phaseAfterClockOut(): SharePhase {
  return "stopped";
}

export type ArrivalDecision =
  | { send: true; reason: "within_window" }
  | { send: false; reason: "disabled" | "already_sent" | "no_eta" | "too_far" };

export function shouldSendArrivalText(input: {
  enabled: boolean;
  etaMinutes: number | null;
  thresholdMinutes: number;
  alreadySent: boolean;
}): ArrivalDecision {
  if (!input.enabled) return { send: false, reason: "disabled" };
  if (input.alreadySent) return { send: false, reason: "already_sent" };
  if (input.etaMinutes == null || Number.isNaN(input.etaMinutes) || input.etaMinutes < 0) {
    return { send: false, reason: "no_eta" };
  }
  if (input.etaMinutes > input.thresholdMinutes) return { send: false, reason: "too_far" };
  return { send: true, reason: "within_window" };
}

export function locationExpired(recordedAtIso: string, now: Date, hours = LOCATION_RETENTION_HOURS): boolean {
  return now.getTime() - Date.parse(recordedAtIso) >= hours * 60 * 60 * 1000;
}

export function retentionCutoffIso(now: Date, hours = LOCATION_RETENTION_HOURS): string {
  return new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();
}
