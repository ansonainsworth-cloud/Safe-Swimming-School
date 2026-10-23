export async function verifySquareSignature(input: {
  rawBody: string;
  signatureHeader: string;
  signatureKey: string;
  notificationUrl: string;
}): Promise<boolean> {
  const { rawBody, signatureHeader, signatureKey, notificationUrl } = input;
  if (!signatureHeader || !signatureKey || !notificationUrl) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(signatureKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(notificationUrl + rawBody));
  const expected = bytesToBase64(new Uint8Array(mac));
  return timingSafeEqualString(expected, signatureHeader);
}

export function webhookNotificationUrl(requestUrl: string): string {
  const url = new URL(requestUrl);
  return `${url.origin}/api/square-webhook`;
}

export type EventSummary = { event: string; orderId: string; status: string };

export function eventSummary(payload: unknown): EventSummary | null {
  if (!payload || typeof payload !== 'object') return null;
  const body = payload as {
    type?: unknown;
    data?: { id?: unknown; object?: { payment?: { order_id?: unknown; status?: unknown }; order_updated?: { order_id?: unknown; state?: unknown } } };
  };
  if (body.type === 'payment.updated') {
    const payment = body.data?.object?.payment;
    return {
      event: 'payment.updated',
      orderId: typeof payment?.order_id === 'string' ? payment.order_id : '',
      status: typeof payment?.status === 'string' ? payment.status : '',
    };
  }
  if (body.type === 'order.updated') {
    const updated = body.data?.object?.order_updated;
    const orderId = typeof updated?.order_id === 'string'
      ? updated.order_id
      : typeof body.data?.id === 'string'
        ? body.data.id
        : '';
    return {
      event: 'order.updated',
      orderId,
      status: typeof updated?.state === 'string' ? updated.state : '',
    };
  }
  return null;
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
  const subtle = crypto.subtle as SubtleCrypto & { timingSafeEqual?: (left: BufferSource, right: BufferSource) => boolean };
  if (typeof subtle.timingSafeEqual === 'function') return subtle.timingSafeEqual(a, b);
  let mismatch = 0;
  for (let i = 0; i < a.byteLength; i++) mismatch |= a[i] ^ b[i];
  return mismatch === 0;
}
