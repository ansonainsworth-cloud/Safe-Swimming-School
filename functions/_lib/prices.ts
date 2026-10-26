/** Server-side prices. The browser may send ids and quantities only. */

export const SQUARE_VERSION = '2026-09-16';
export const SQUARE_SANDBOX_ORIGIN = 'https://connect.squareupsandbox.com';
export const REGISTRATION_ID = 'registration-annual';
export const REGISTRATION_NAME = 'Annual Registration';

/** One registration for the family. Siblings share one package, so the tier follows swimmer count, not package quantity. */
export const REGISTRATION_TIER_CENTS = { 1: 3500, 2: 5000, 3: 6000 } as const;

/** 1 swimmer, 2 siblings, or 3+ (capped). Omitted means one swimmer. Invalid input is null. */
export function normalizeSwimmerCount(value: unknown): number | null {
  if (value == null || value === '') return 1;
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value.trim()) : NaN;
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 20) return null;
  return parsed;
}

export function registrationPriceCents(swimmers: number): number {
  if (swimmers >= 3) return REGISTRATION_TIER_CENTS[3];
  if (swimmers === 2) return REGISTRATION_TIER_CENTS[2];
  return REGISTRATION_TIER_CENTS[1];
}

export type ItemId =
  | 'registration-annual'
  | 'pkg-8'
  | 'pkg-12'
  | 'pkg-20'
  | 'trial'
  | 'water-aerobics';

export type CatalogItem = {
  id: ItemId;
  name: string;
  priceCents: number;
  minQty: number;
  maxQty: number;
  /** Buyers can put this in the cart. Registration is added only by the server. */
  clientOrderable: boolean;
};

export const CATALOG: readonly CatalogItem[] = [
  { id: 'registration-annual', name: REGISTRATION_NAME, priceCents: 3500, minQty: 1, maxQty: 1, clientOrderable: false },
  { id: 'pkg-8', name: '8 Private Lessons (30 min)', priceCents: 52000, minQty: 1, maxQty: 3, clientOrderable: true },
  { id: 'pkg-12', name: '12 Private Lessons (30 min)', priceCents: 72000, minQty: 1, maxQty: 3, clientOrderable: true },
  { id: 'pkg-20', name: '20 Private Lessons (30 min)', priceCents: 110000, minQty: 1, maxQty: 3, clientOrderable: true },
  { id: 'trial', name: 'Trial Lesson (30 min)', priceCents: 7500, minQty: 1, maxQty: 3, clientOrderable: true },
  { id: 'water-aerobics', name: 'Water Aerobics Class (30 min)', priceCents: 4500, minQty: 1, maxQty: 20, clientOrderable: true },
];

export type ClientLine = { id: ItemId; quantity: number };

export type PricedLine = { name: string; quantity: number; priceCents: number };

const byId = new Map(CATALOG.map((item) => [item.id, item]));

export function getItem(id: string): CatalogItem | undefined {
  return byId.get(id as ItemId);
}

export function clientCatalog(): Array<Pick<CatalogItem, 'id' | 'name' | 'priceCents' | 'minQty' | 'maxQty'>> {
  return CATALOG.filter((item) => item.clientOrderable).map(({ id, name, priceCents, minQty, maxQty }) => ({
    id,
    name,
    priceCents,
    minQty,
    maxQty,
  }));
}

export function validateClientItems(input: unknown): { ok: true; lines: ClientLine[] } | { ok: false; error: string } {
  if (!Array.isArray(input) || input.length === 0) return { ok: false, error: 'Cart is empty.' };
  if (input.length > CATALOG.length) return { ok: false, error: 'Too many line items.' };
  const seen = new Set<string>();
  const lines: ClientLine[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') return { ok: false, error: 'Invalid line item.' };
    const id = (raw as { id?: unknown }).id;
    const quantity = (raw as { quantity?: unknown }).quantity;
    if (typeof id !== 'string' || !getItem(id)) return { ok: false, error: 'Unknown item.' };
    const item = getItem(id)!;
    if (!item.clientOrderable) return { ok: false, error: 'Unknown item.' };
    if (seen.has(id)) return { ok: false, error: 'Duplicate item.' };
    if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < item.minQty || quantity > item.maxQty) {
      return { ok: false, error: 'Invalid quantity.' };
    }
    seen.add(id);
    lines.push({ id: item.id, quantity });
  }
  return { ok: true, lines };
}

export function priceClientLines(lines: ClientLine[], addRegistration: boolean, swimmers = 1): PricedLine[] {
  const priced = lines.map((line) => {
    const item = getItem(line.id)!;
    return { name: item.name, quantity: line.quantity, priceCents: item.priceCents };
  });
  if (addRegistration) {
    const registration = getItem(REGISTRATION_ID)!;
    priced.push({ name: registration.name, quantity: 1, priceCents: registrationPriceCents(swimmers) });
  }
  return priced;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 254) return null;
  return email;
}

export function normalizeName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length < 1 || name.length > 100) return null;
  if (/[\u0000-\u001f]/.test(name)) return null;
  return name;
}

/** Optional. Empty becomes absent. A present value must look like a phone number. */
export function normalizePhone(value: unknown): string | null | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return null;
  return trimmed.slice(0, 40);
}
