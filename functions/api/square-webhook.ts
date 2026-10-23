import type { SquareEnv } from '../_lib/square';
import { eventSummary, verifySquareSignature, webhookNotificationUrl } from '../_lib/webhook';

type PagesContext = { request: Request; env: SquareEnv };

export async function onRequestPost({ request, env }: PagesContext): Promise<Response> {
  if (env.SQUARE_ENV !== 'sandbox' || !env.SQUARE_WEBHOOK_SIGNATURE_KEY) {
    return new Response('Unauthorized', { status: 401 });
  }
  const rawBody = await request.text();
  const signature = request.headers.get('x-square-hmacsha256-signature') ?? '';
  const valid = await verifySquareSignature({
    rawBody,
    signatureHeader: signature,
    signatureKey: env.SQUARE_WEBHOOK_SIGNATURE_KEY,
    notificationUrl: webhookNotificationUrl(request.url),
  });
  if (!valid) return new Response('Unauthorized', { status: 401 });

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response('Bad Request', { status: 400 });
  }
  const summary = eventSummary(payload);
  if (summary) {
    console.log(JSON.stringify(summary));
  } else {
    const type = payload && typeof payload === 'object' && typeof (payload as { type?: unknown }).type === 'string'
      ? (payload as { type: string }).type
      : 'unknown';
    console.log(JSON.stringify({ event: type }));
  }
  return new Response('OK', { status: 200 });
}

export async function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.method === 'POST') return onRequestPost(context);
  return new Response('Method Not Allowed', { status: 405 });
}
