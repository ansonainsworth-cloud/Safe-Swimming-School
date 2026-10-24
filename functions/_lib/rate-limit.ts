// TODO(phase 2): replace this in-memory per-isolate guard with Cloudflare Turnstile.

const WINDOW_MS = 10 * 60 * 1000;
const LIMIT = 10;
const hits = new Map<string, number[]>();

export function allowCheckout(ip: string, now = Date.now()): boolean {
  const recent = (hits.get(ip) ?? []).filter((stamp) => now - stamp < WINDOW_MS);
  if (recent.length >= LIMIT) {
    hits.set(ip, recent);
    return false;
  }
  recent.push(now);
  hits.set(ip, recent);
  return true;
}

export function resetRateLimit(): void {
  hits.clear();
}
