import type { RegistrationFields } from './tally';

export const NUTSHELL_URL = 'https://app.nutshell.com/api/v1/json';

export type NutshellEnv = {
  NUTSHELL_USERNAME?: string;
  NUTSHELL_API_KEY?: string;
};

export function submissionToken(submissionId: string): string {
  return `tally-submission:${submissionId}`;
}

export function leadDescription(fields: RegistrationFields): string {
  return `Package: ${fields.packageName || 'not given'}. Submission ${submissionToken(fields.submissionId)}.`;
}

export function leadNote(fields: RegistrationFields): string {
  const parts = [
    fields.swimmers ? `Swimmers: ${fields.swimmers}.` : '',
    fields.town ? `Town: ${fields.town}.` : '',
    fields.homeAddress ? `Home address: ${fields.homeAddress}.` : '',
    fields.poolAddress ? `Pool address: ${fields.poolAddress}.` : '',
    fields.notes ? `Notes: ${fields.notes}.` : '',
  ].filter(Boolean);
  return parts.join(' ');
}

export async function saveRegistration(fields: RegistrationFields, env: NutshellEnv, fetchImpl: typeof fetch): Promise<void> {
  const username = env.NUTSHELL_USERNAME?.trim() || '';
  const apiKey = env.NUTSHELL_API_KEY?.trim() || '';
  if (!username || !apiKey) throw new Error('nutshell-unconfigured');
  const token = submissionToken(fields.submissionId);
  const existing = await rpc(username, apiKey, 'searchLeads', { string: token, limit: 5 }, fetchImpl);
  if (hasLead(existing)) return;
  const found = await rpc(username, apiKey, 'searchByEmail', { emailAddressString: fields.email }, fetchImpl);
  const contactId = contactFromSearch(found) ?? await createContact(fields, username, apiKey, fetchImpl);
  await rpc(username, apiKey, 'newLead', {
    lead: {
      description: leadDescription(fields),
      contacts: [{ id: contactId }],
      note: leadNote(fields),
    },
  }, fetchImpl);
}

async function createContact(fields: RegistrationFields, username: string, apiKey: string, fetchImpl: typeof fetch): Promise<string | number> {
  const address = [fields.homeAddress, fields.poolAddress].filter(Boolean).join('. ');
  const contact: Record<string, unknown> = { name: fields.parentName || fields.email, email: [fields.email] };
  if (fields.phone) contact.phone = [fields.phone];
  if (address || fields.town) {
    contact.address = [{
      address_1: address,
      city: fields.town,
      state: 'FL',
      country: 'US',
    }];
  }
  const created = await rpc(username, apiKey, 'newContact', { contact }, fetchImpl);
  const id = created && typeof created === 'object' ? (created as { id?: unknown }).id : undefined;
  if (typeof id !== 'string' && typeof id !== 'number') throw new Error('nutshell-contact');
  return id;
}

function hasLead(result: unknown): boolean {
  return Array.isArray(result) && result.length > 0;
}

function contactFromSearch(result: unknown): string | number | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const contacts = (result as { contacts?: unknown }).contacts;
  if (!Array.isArray(contacts) || contacts.length === 0) return undefined;
  const id = (contacts[0] as { id?: unknown }).id;
  if (typeof id === 'string' || typeof id === 'number') return id;
  return undefined;
}

async function rpc(username: string, apiKey: string, method: string, params: unknown, fetchImpl: typeof fetch): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(NUTSHELL_URL, {
      method: 'POST',
      headers: {
        authorization: `Basic ${btoa(`${username}:${apiKey}`)}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: method, method, params }),
    });
  } catch {
    throw new Error('nutshell-network');
  }
  if (!response.ok) throw new Error('nutshell-http');
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error('nutshell-http');
  }
  if (!body || typeof body !== 'object' || (body as { error?: unknown }).error) throw new Error('nutshell-rpc');
  return (body as { result?: unknown }).result;
}
