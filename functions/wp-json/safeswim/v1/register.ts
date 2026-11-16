import { saveRegistration } from '../../../_lib/nutshell';
import { parseRegistration, tallySignatureValid } from '../../../_lib/tally';

/**
 * Tally form yPed66 posts here. The path matches the old WordPress receiver.
 * Env: TALLY_SIGNING_SECRET (optional), NUTSHELL_USERNAME, NUTSHELL_API_KEY.
 * A build after the secret is set verifies Tally-Signature. Missing Nutshell
 * config or a Nutshell error returns 503 so Tally retries.
 */

type Env = {
  TALLY_SIGNING_SECRET?: string;
  NUTSHELL_USERNAME?: string;
  NUTSHELL_API_KEY?: string;
};

type PagesContext = { request: Request; env: Env };

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export async function onRequestPost({ request, env }: PagesContext): Promise<Response> {
  const rawBody = await request.text();
  const secret = env.TALLY_SIGNING_SECRET?.trim() || '';
  if (secret) {
    const header = request.headers.get('tally-signature') ?? '';
    const valid = await tallySignatureValid(rawBody, header, secret);
    if (!valid) return json({ error: 'invalid-signature' }, 401);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json({ error: 'invalid-json' }, 400);
  }
  const fields = parseRegistration(payload);
  if (!fields || !fields.email) return json({ error: 'invalid-registration' }, 400);
  try {
    await saveRegistration(fields, env, fetch);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'nutshell-error';
    try {
      console.error(JSON.stringify({ register: 'failed', reason }));
    } catch {
      // A log failure must not turn into a success response.
    }
    return json({ error: 'registration-unavailable' }, 503);
  }
  return json({ ok: true }, 200);
}

export async function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.method === 'POST') return onRequestPost(context);
  return new Response('Method Not Allowed', { status: 405, headers: { allow: 'POST' } });
}
