import { fetchGoogleAccessToken } from './google-auth';
import { normalizeEmail } from './prices';

export const TRACKER_SHEET_ID = '1Yk8WRnrqm2zXhLUdAKVNClUv1pq4VQAs2LP6eg08T40';
export const TRACKER_TAB = 'Tracker';
export const PARENT_EMAIL_COLUMN = 'Parent email';
export const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';

export type FamilyLookupResult = { status: 'returning' } | { status: 'new' } | { status: 'unavailable' };

export interface FamilyRegistry {
  lookupByParentEmail(email: string): Promise<FamilyLookupResult>;
}

export type RegistrationReason = 'first-purchase' | 'returning' | 'lookup-error';

export type RegistrationDecision = {
  add: boolean;
  reason: RegistrationReason;
};

export async function decideRegistration(email: string, registry: FamilyRegistry): Promise<RegistrationDecision> {
  try {
    const result = await registry.lookupByParentEmail(email);
    if (result.status === 'returning') return { add: false, reason: 'returning' };
    if (result.status === 'new') return { add: true, reason: 'first-purchase' };
    return { add: true, reason: 'lookup-error' };
  } catch {
    return { add: true, reason: 'lookup-error' };
  }
}

/** Mock until GOOGLE_SERVICE_ACCOUNT_JSON is set. returning@example.com is already in the tracker. */
export class MockFamilyRegistry implements FamilyRegistry {
  async lookupByParentEmail(email: string): Promise<FamilyLookupResult> {
    const normalized = normalizeEmail(email);
    if (!normalized) return { status: 'unavailable' };
    if (normalized === 'unavailable@example.com') return { status: 'unavailable' };
    if (normalized === 'returning@example.com') return { status: 'returning' };
    return { status: 'new' };
  }
}

export function sheetValuesPath(sheetId = TRACKER_SHEET_ID, tab = TRACKER_TAB): string {
  return `/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(`${tab}!A1:Z5000`)}`;
}

export function parentEmailInRows(values: unknown, email: string): boolean | null {
  if (!Array.isArray(values) || values.length === 0 || !Array.isArray(values[0])) return null;
  const header = (values[0] as unknown[]).map((cell) => (typeof cell === 'string' ? cell.trim() : ''));
  const column = header.indexOf(PARENT_EMAIL_COLUMN);
  if (column < 0) return null;
  const wanted = normalizeEmail(email);
  if (!wanted) return null;
  for (const row of values.slice(1)) {
    if (!Array.isArray(row)) continue;
    const cell = row[column];
    if (typeof cell === 'string' && normalizeEmail(cell) === wanted) return true;
  }
  return false;
}

export class GoogleSheetFamilyRegistry implements FamilyRegistry {
  constructor(
    private readonly sheetId: string,
    private readonly getAccessToken: () => Promise<string>,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async lookupByParentEmail(email: string): Promise<FamilyLookupResult> {
    const token = await this.getAccessToken();
    const response = await this.fetchImpl(`https://sheets.googleapis.com${sheetValuesPath(this.sheetId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return { status: 'unavailable' };
    const body = await response.json() as { values?: unknown };
    const found = parentEmailInRows(body.values, email);
    if (found === null) return { status: 'unavailable' };
    return found ? { status: 'returning' } : { status: 'new' };
  }
}

export type RegistryEnv = {
  GOOGLE_SERVICE_ACCOUNT_JSON?: string;
  GOOGLE_SHEET_ID?: string;
};

export function createFamilyRegistry(env: RegistryEnv, fetchImpl: typeof fetch = fetch): FamilyRegistry {
  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON) return new MockFamilyRegistry();
  let account: { client_email?: string; private_key?: string };
  try {
    account = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON) as { client_email?: string; private_key?: string };
  } catch {
    return { async lookupByParentEmail() { return { status: 'unavailable' }; } };
  }
  if (!account.client_email || !account.private_key) {
    return { async lookupByParentEmail() { return { status: 'unavailable' }; } };
  }
  const clientEmail = account.client_email;
  const privateKey = account.private_key;
  return new GoogleSheetFamilyRegistry(env.GOOGLE_SHEET_ID || TRACKER_SHEET_ID, () => {
    return fetchGoogleAccessToken({ client_email: clientEmail, private_key: privateKey }, SHEETS_SCOPE, fetchImpl);
  }, fetchImpl);
}
