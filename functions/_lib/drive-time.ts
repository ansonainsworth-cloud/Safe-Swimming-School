/** 10 minutes between lessons at different pools, plus drive time. Same pool is back to back. */
export const DRIVE_BUFFER_MINUTES = 10;

export interface DriveTimeAdapter {
  estimateMinutes(fromAddress: string, toAddress: string): Promise<number>;
}

export function samePlace(left: string, right: string): boolean {
  const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
  const a = normalize(left);
  const b = normalize(right);
  return a.length > 0 && a === b;
}

/**
 * Stub until a maps provider is configured.
 * DRIVE_TIME_PROVIDER=stub (default). DRIVE_TIME_MINUTES is the estimate when the pools differ.
 */
export class StubDriveTime implements DriveTimeAdapter {
  constructor(private readonly minutes: number) {}

  async estimateMinutes(fromAddress: string, toAddress: string): Promise<number> {
    if (samePlace(fromAddress, toAddress)) return 0;
    return this.minutes;
  }
}

export type DriveTimeEnv = {
  DRIVE_TIME_MINUTES?: string;
  DRIVE_TIME_PROVIDER?: string;
};

export function driveMinutes(env: DriveTimeEnv): number {
  const parsed = Number(env.DRIVE_TIME_MINUTES);
  if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 180) return parsed;
  return 15;
}

export function createDriveTime(env: DriveTimeEnv): DriveTimeAdapter {
  return new StubDriveTime(driveMinutes(env));
}
