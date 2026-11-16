import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequest, onRequestPost } from '../functions/wp-json/safeswim/v1/register';
import { NUTSHELL_URL } from '../functions/_lib/nutshell';
import { tallySignatureValid } from '../functions/_lib/tally';

const EMAIL = 'test-family@safeswimmingschool.invalid';
const CHILD = 'Jamie Swimmer';
const DOB = '2019-04-02';
const SUBMISSION = 'sub_yPed66_1001';

const env = {
  NUTSHELL_USERNAME: 'crm-user',
  NUTSHELL_API_KEY: 'crm-key-not-a-token-to-print',
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function tallyPayload() {
  return {
    eventId: 'evt_1001',
    eventType: 'FORM_RESPONSE',
    createdAt: '2026-11-16T15:00:00.000Z',
    data: {
      responseId: 'resp_1001',
      submissionId: SUBMISSION,
      respondentId: 'respnt_1001',
      formId: 'yPed66',
      formName: 'Safe Swimming School Registration',
      createdAt: '2026-11-16T15:00:00.000Z',
      fields: [
        { key: 'q_name', label: "Parent's Full Name", type: 'INPUT_TEXT', value: 'Pat Parent' },
        { key: 'q_email', label: 'Email', type: 'INPUT_EMAIL', value: EMAIL },
        { key: 'q_phone', label: 'Phone', type: 'INPUT_PHONE_NUMBER', value: '561-555-0199' },
        {
          key: 'q_count',
          label: 'How many swimmers?',
          type: 'MULTIPLE_CHOICE',
          value: ['opt_2'],
          options: [
            { id: 'opt_1', text: '1' },
            { id: 'opt_2', text: '2' },
          ],
        },
        { key: 'q_student', label: "Student's Name", type: 'INPUT_TEXT', value: CHILD },
        { key: 'q_dob', label: 'Date of Birth', type: 'INPUT_DATE', value: DOB },
        { key: 'q_home', label: 'Home Address', type: 'INPUT_TEXT', value: '10 Lake Road' },
        { key: 'q_pool', label: 'Lesson/Pool Address', type: 'INPUT_TEXT', value: 'Community pool gate B' },
        { key: 'q_town', label: 'Town', type: 'INPUT_TEXT', value: 'Jupiter' },
        { key: 'q_notes', label: 'Pool access directions', type: 'TEXTAREA', value: 'Park by the tennis court.' },
        {
          key: 'q_package',
          label: 'Package',
          type: 'MULTIPLE_CHOICE',
          value: ['opt_8'],
          options: [
            { id: 'opt_8', text: '8 lessons for $520' },
            { id: 'opt_12', text: '12 lessons for $720' },
          ],
        },
      ],
    },
  };
}

function post(body: string, headers: Record<string, string> = {}) {
  return new Request('https://safeswimmingschool.com/wp-json/safeswim/v1/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });
}

function rpcMock(handlers: Record<string, unknown>) {
  const calls: Array<{ method: string; params: unknown }> = [];
  const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
    const sent = JSON.parse(String(init?.body));
    calls.push({ method: sent.method, params: sent.params });
    const result = handlers[sent.method];
    if (result instanceof Error) return new Response(JSON.stringify({ error: { message: 'failed' } }), { status: 200 });
    return Response.json({ jsonrpc: '2.0', id: sent.method, result });
  });
  vi.stubGlobal('fetch', fetchImpl);
  return { fetchImpl, calls };
}

describe('Tally registration webhook', () => {
  it('is routed to the function and is not redirected', () => {
    const routes = JSON.parse(readFileSync(new URL('../public/_routes.json', import.meta.url), 'utf8')) as { include: string[] };
    expect(routes.include).toContain('/wp-json/safeswim/v1/register');
    const redirects = readFileSync(new URL('../public/_redirects', import.meta.url), 'utf8');
    expect(redirects.split('\n').some((line) => line.trim().startsWith('/wp-json'))).toBe(false);
  });

  it('returns 405 for GET and 400 for an empty POST body', async () => {
    const get = await onRequest({
      request: new Request('https://safeswimmingschool.com/wp-json/safeswim/v1/register'),
      env,
    });
    expect(get.status).toBe(405);

    const empty = await onRequestPost({ request: post(''), env });
    expect(empty.status).toBe(400);
    expect(await empty.json()).toEqual({ error: 'invalid-json' });
  });

  it('creates one contact and one lead, and a replay does not create another', async () => {
    const first = rpcMock({
      searchLeads: [],
      searchByEmail: { contacts: [] },
      newContact: { id: 44 },
      newLead: { id: 90 },
    });
    const response = await onRequestPost({ request: post(JSON.stringify(tallyPayload())), env });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(first.fetchImpl.mock.calls[0][0]).toBe(NUTSHELL_URL);
    const sent = JSON.stringify(first.calls);
    expect(sent).toContain('8 lessons for $520');
    expect(sent).toContain(`tally-submission:${SUBMISSION}`);
    expect(sent).toContain(EMAIL);
    expect(sent).toContain('Jupiter');
    expect(sent).toContain('10 Lake Road');
    expect(sent).toContain('Park by the tennis court.');
    expect(sent).not.toContain(CHILD);
    expect(sent).not.toContain(DOB);
    const lead = first.calls.find((call) => call.method === 'newLead');
    expect(JSON.stringify((lead?.params as { lead: { description: string } }).lead.description)).not.toContain(CHILD);

    const replay = rpcMock({ searchLeads: [{ id: 90 }] });
    const again = await onRequestPost({ request: post(JSON.stringify(tallyPayload())), env });
    expect(again.status).toBe(200);
    expect(replay.calls.map((call) => call.method)).toEqual(['searchLeads']);
  });

  it('uses an existing contact and returns 503 without ok when Nutshell fails', async () => {
    const existing = rpcMock({
      searchLeads: [],
      searchByEmail: { contacts: [{ id: 7 }] },
      newLead: { id: 91 },
    });
    const ok = await onRequestPost({ request: post(JSON.stringify(tallyPayload())), env });
    expect(ok.status).toBe(200);
    expect(existing.calls.map((call) => call.method)).toEqual(['searchLeads', 'searchByEmail', 'newLead']);

    const logs: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((message) => { logs.push(String(message)); });
    const missing = await onRequestPost({ request: post(JSON.stringify(tallyPayload())), env: {} });
    expect(missing.status).toBe(503);
    rpcMock({ searchLeads: new Error('down') });
    const failed = await onRequestPost({ request: post(JSON.stringify(tallyPayload())), env });
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ error: 'registration-unavailable' });
    const logged = logs.join('\n');
    expect(logged).not.toContain(EMAIL);
    expect(logged).not.toContain(CHILD);
    expect(logged).not.toContain('crm-key');
  });

  it('verifies the Tally signature when a secret is set', async () => {
    const raw = JSON.stringify(tallyPayload());
    const secret = 'tally-sign-secret';
    const signature = await sign(raw, secret);
    expect(await tallySignatureValid(raw, signature, secret)).toBe(true);
    expect(await tallySignatureValid(raw, 'nope', secret)).toBe(false);

    rpcMock({
      searchLeads: [],
      searchByEmail: { contacts: [{ id: 7 }] },
      newLead: { id: 92 },
    });
    const bad = await onRequestPost({ request: post(raw, { 'tally-signature': 'nope' }), env: { ...env, TALLY_SIGNING_SECRET: secret } });
    expect(bad.status).toBe(401);
    const good = await onRequestPost({ request: post(raw, { 'tally-signature': signature }), env: { ...env, TALLY_SIGNING_SECRET: secret } });
    expect(good.status).toBe(200);
  });
});

async function sign(rawBody: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody));
  let binary = '';
  const bytes = new Uint8Array(mac);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
