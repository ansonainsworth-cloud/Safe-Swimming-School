import { bookingSecret, confirmHold, verifyHold, type BookingEnv } from '../_lib/booking';
import { json } from '../_lib/http';
import { checkoutAllowed, squareGet } from '../_lib/square';

type PagesContext = { request: Request; env: BookingEnv };

type SquarePayment = {
  id?: string;
  order_id?: string;
  status?: string;
  amount_money?: { amount?: number; currency?: string };
  receipt_email?: string;
  receipt_url?: string;
  buyer_email_address?: string;
};

function redirectId(referer: string, name: string): string {
  try {
    const value = new URL(referer).searchParams.get(name) || '';
    return /^[A-Za-z0-9]{1,64}$/.test(value) ? value : '';
  } catch {
    return '';
  }
}

export async function onRequestPost({ request, env }: PagesContext): Promise<Response> {
  const secret = bookingSecret(env, request.url);
  const cookie = request.headers.get('cookie') || '';
  const match = cookie.match(/(?:^|; )sss_hold=([^;]+)/);
  if (!secret || !match) return json({ error: 'no-hold' }, 400);
  const token = decodeURIComponent(match[1]);
  const hold = await verifyHold(token, secret);
  if (!hold) return json({ error: 'invalid-hold' }, 400);
  const saved = await confirmHold({ env, requestUrl: request.url, hold, origin: new URL(request.url).origin });
  const paymentId = redirectId(request.headers.get('referer') || '', 'transactionId');
  const orderId = redirectId(request.headers.get('referer') || '', 'orderId');
  const result: Record<string, unknown> = { confirmationUrl: saved.confirmationUrl };
  if (orderId) result.orderId = orderId;
  if (paymentId) result.paymentId = paymentId;
  if (paymentId && checkoutAllowed(env, request.url)) {
    try {
      const body = await squareGet(env, `/v2/payments/${paymentId}`) as { payment?: SquarePayment };
      const payment = body.payment;
      const email = payment?.receipt_email || payment?.buyer_email_address;
      if (payment && email === hold.email) {
        result.paymentId = payment.id || paymentId;
        result.orderId = payment.order_id || orderId;
        result.paymentStatus = payment.status;
        result.amountCents = payment.amount_money?.amount;
        result.currency = payment.amount_money?.currency;
        result.receiptEmail = payment.receipt_email || null;
        result.buyerEmail = payment.buyer_email_address || null;
      }
    } catch {
      // The booking is already confirmed. Receipt details stay empty when Square cannot be read.
    }
  }
  return json(result, 200, { 'set-cookie': 'sss_hold=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax' });
}

export async function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.method === 'POST') return onRequestPost(context);
  return json({ error: 'method-not-allowed' }, 405);
}
