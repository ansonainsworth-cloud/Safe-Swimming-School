/**
 * Package registration waiver banner.
 * Shown through Dec 31, 2026 23:59:59 America/New_York.
 * Jan 1, 2027 00:00 ET is 05:00 UTC. A build at or after that instant omits the banner.
 * To remove it early, delete this file, src/components/Dec31Banner.astro, and the Dec31Banner tag in src/layouts/Base.astro.
 */
export const DEC31_BANNER_ENDS_MS = Date.parse('2027-01-01T05:00:00.000Z');

export function showDec31Banner(now: Date): boolean {
  return now.getTime() < DEC31_BANNER_ENDS_MS;
}
