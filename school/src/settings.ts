export interface AppSettings {
  clockInRadiusYards: number;
  lateThresholdMinutes: number;
  autoDecrementOnClockOut: boolean;
  arrivalTextEnabled: boolean;
  arrivalTextMinutes: number;
}

/** Anson's answers for the beta. Env vars can replace these before the first boot. */
export const PRODUCT_DEFAULTS: AppSettings = {
  clockInRadiusYards: 100,
  lateThresholdMinutes: 5,
  autoDecrementOnClockOut: true,
  arrivalTextEnabled: true,
  arrivalTextMinutes: 10,
};

export const LOCATION_RETENTION_HOURS = 24;

const SETTING_KEYS = {
  clockInRadiusYards: "clock_in_radius_yards",
  lateThresholdMinutes: "late_threshold_minutes",
  autoDecrementOnClockOut: "auto_decrement_on_clock_out",
  arrivalTextEnabled: "arrival_text_enabled",
  arrivalTextMinutes: "arrival_text_minutes",
} as const;

export function settingKey(name: keyof AppSettings): string {
  return SETTING_KEYS[name];
}

function numberOr(value: string | undefined, fallback: number): number {
  if (value == null || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolOr(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value.trim() === "") return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

export function defaultsFromEnv(env: {
  CLOCK_IN_RADIUS_YARDS?: string;
  LATE_THRESHOLD_MINUTES?: string;
  AUTO_DECREMENT_ON_CLOCK_OUT?: string;
  ARRIVAL_TEXT_ENABLED?: string;
  ARRIVAL_TEXT_MINUTES?: string;
}): AppSettings {
  return {
    clockInRadiusYards: numberOr(env.CLOCK_IN_RADIUS_YARDS, PRODUCT_DEFAULTS.clockInRadiusYards),
    lateThresholdMinutes: numberOr(env.LATE_THRESHOLD_MINUTES, PRODUCT_DEFAULTS.lateThresholdMinutes),
    autoDecrementOnClockOut: boolOr(env.AUTO_DECREMENT_ON_CLOCK_OUT, PRODUCT_DEFAULTS.autoDecrementOnClockOut),
    arrivalTextEnabled: boolOr(env.ARRIVAL_TEXT_ENABLED, PRODUCT_DEFAULTS.arrivalTextEnabled),
    arrivalTextMinutes: numberOr(env.ARRIVAL_TEXT_MINUTES, PRODUCT_DEFAULTS.arrivalTextMinutes),
  };
}

export function settingsFromRows(rows: Array<{ key: string; value: string }>, fallback: AppSettings): AppSettings {
  const map = new Map(rows.map((row) => [row.key, row.value]));
  return {
    clockInRadiusYards: numberOr(map.get(SETTING_KEYS.clockInRadiusYards), fallback.clockInRadiusYards),
    lateThresholdMinutes: numberOr(map.get(SETTING_KEYS.lateThresholdMinutes), fallback.lateThresholdMinutes),
    autoDecrementOnClockOut: boolOr(map.get(SETTING_KEYS.autoDecrementOnClockOut), fallback.autoDecrementOnClockOut),
    arrivalTextEnabled: boolOr(map.get(SETTING_KEYS.arrivalTextEnabled), fallback.arrivalTextEnabled),
    arrivalTextMinutes: numberOr(map.get(SETTING_KEYS.arrivalTextMinutes), fallback.arrivalTextMinutes),
  };
}

export function validateSettings(input: unknown): { ok: true; settings: AppSettings } | { ok: false; error: string } {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "Check the settings and try again." };
  }
  const body = input as Record<string, unknown>;
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
      arrivalTextMinutes: arrivalMinutes,
    },
  };
}
