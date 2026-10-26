// TODO(phase 2): replace this in-memory per-isolate guard with Cloudflare Turnstile.

const WINDOW_MS = 10 * 60 * 1000;
const LIMIT = 10;
const HEALTH_LIMIT = 30;
const hits = new Map<string, number[]>();
const healthHits = new Map<string, number[]>();

function allow(store: Map<string, number[]>, ip: string, limit: number, now: number): boolean {
  const recent = (store.get(ip) ?? []).filter((stamp) => now - stamp < WINDOW_MS);
  if (recent.length >= limit) {
    store.set(ip, recent);
    return false;
  }
  recent.push(now);
  store.set(ip, recent);
  return true;
}

export function allowCheckout(ip: string, now = Date.now()): boolean {
  return allow(hits, ip, LIMIT, now);
}

export function allowHealth(ip: string, now = Date.now()): boolean {
  return allow(healthHits, ip, HEALTH_LIMIT, now);
}

export function resetRateLimit(): void {
  hits.clear();
  healthHits.clear();
}
