import { checkoutPaymentNote, toE164Phone, type PricedLine, type SwimmerChild } from './prices';

/** CreatePaymentLink only accepts https redirect URLs. Drop credentials and fragments. */
export function httpsRedirectUrl(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new TypeError('redirect url must be http(s)');
  }
  return `https://${parsed.host}${parsed.pathname}${parsed.search}`;
}

export function buildCreatePaymentLinkBody(input: {
  locationId: string;
  idempotencyKey: string;
  redirectUrl: string;
  buyerEmail: string;
  buyerName?: string;
  buyerPhone?: string;
  customerId?: string;
  children?: SwimmerChild[] | null;
  lines: PricedLine[];
}) {
  const buyerPhone = input.buyerPhone ? toE164Phone(input.buyerPhone) : undefined;
  const paymentNote = input.buyerName ? checkoutPaymentNote(input.buyerName, input.children ?? null) : undefined;
  return {
    idempotency_key: input.idempotencyKey,
    ...(paymentNote ? { payment_note: paymentNote } : {}),
    order: {
      location_id: input.locationId,
      ...(input.customerId ? { customer_id: input.customerId } : {}),
      line_items: input.lines.map((line) => ({
        name: line.name,
        quantity: String(line.quantity),
        base_price_money: {
          amount: line.priceCents,
          currency: 'USD',
        },
      })),
    },
    checkout_options: {
      redirect_url: httpsRedirectUrl(input.redirectUrl),
    },
    pre_populated_data: {
      buyer_email: input.buyerEmail,
      ...(buyerPhone ? { buyer_phone_number: buyerPhone } : {}),
    },
  };
}
