/** Tally form yPed66. Signature is base64 HMAC-SHA256 of the raw body. */

export type TallyField = {
  label?: unknown;
  type?: unknown;
  value?: unknown;
  options?: unknown;
};

export type RegistrationFields = {
  submissionId: string;
  parentName: string;
  email: string;
  phone: string;
  swimmers: string;
  packageName: string;
  town: string;
  homeAddress: string;
  poolAddress: string;
  notes: string;
};

export async function tallySignatureValid(rawBody: string, header: string, secret: string): Promise<boolean> {
  if (!header || !secret) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody));
  const expected = bytesToBase64(new Uint8Array(mac));
  return timingSafeEqualString(expected, header.trim());
}

export function parseRegistration(payload: unknown): RegistrationFields | null {
  if (!payload || typeof payload !== 'object') return null;
  const data = (payload as { data?: unknown }).data;
  if (!data || typeof data !== 'object') return null;
  const body = data as { submissionId?: unknown; formId?: unknown; fields?: unknown };
  if (body.formId !== 'yPed66') return null;
  if (typeof body.submissionId !== 'string' || !body.submissionId.trim()) return null;
  if (!Array.isArray(body.fields)) return null;
  const fields = body.fields.filter((field): field is TallyField => Boolean(field) && typeof field === 'object');
  const text = (field: TallyField) => fieldText(field);
  return {
    submissionId: body.submissionId.trim(),
    parentName: first(fields, (label) => label.includes('parent') && label.includes('name'), text),
    email: first(fields, (label, type) => type === 'INPUT_EMAIL' || label === 'email', text),
    phone: first(fields, (label, type) => type === 'INPUT_PHONE_NUMBER' || label === 'phone', text),
    swimmers: first(fields, (label) => label.includes('swimmer'), text),
    packageName: packageChoice(fields, text),
    town: first(fields, (label) => label === 'town' || label.endsWith(' town') || label.includes('town'), text),
    homeAddress: first(fields, (label) => label.includes('home') && label.includes('address'), text),
    poolAddress: first(fields, (label) => label.includes('pool') && label.includes('address'), text),
    notes: notesChoice(fields, text),
  };
}

function packageChoice(fields: TallyField[], text: (field: TallyField) => string): string {
  const labeled = first(fields, (label) => label.includes('package'), text);
  if (labeled) return labeled;
  for (const field of fields) {
    const value = text(field);
    if (/\b(8|12|20) lessons\b|trial lesson/i.test(value)) return value;
  }
  return '';
}

function notesChoice(fields: TallyField[], text: (field: TallyField) => string): string {
  const parts = fields
    .filter((field) => {
      const label = normLabel(field.label);
      return label.includes('note') || label.includes('direction') || label.includes('comment');
    })
    .map(text)
    .filter(Boolean);
  return parts.join(' ');
}

function first(fields: TallyField[], match: (label: string, type: string) => boolean, text: (field: TallyField) => string): string {
  for (const field of fields) {
    const label = normLabel(field.label);
    const type = typeof field.type === 'string' ? field.type : '';
    if (match(label, type)) return text(field);
  }
  return '';
}

function normLabel(label: unknown): string {
  if (typeof label !== 'string') return '';
  return label.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function fieldText(field: TallyField): string {
  const options = Array.isArray(field.options) ? field.options : [];
  const optionText = (id: string) => {
    for (const option of options) {
      if (!option || typeof option !== 'object') continue;
      const record = option as { id?: unknown; text?: unknown };
      if (record.id === id && typeof record.text === 'string') return record.text.trim();
    }
    return '';
  };
  const value = field.value;
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === 'string' ? optionText(item) || item.trim() : '')).filter(Boolean).join(', ');
  }
  if (typeof value === 'string') return (optionText(value) || value).trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function timingSafeEqualString(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  if (a.byteLength !== b.byteLength) return false;
  let mismatch = 0;
  for (let i = 0; i < a.byteLength; i++) mismatch |= a[i] ^ b[i];
  return mismatch === 0;
}
