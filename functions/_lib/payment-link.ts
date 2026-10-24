import type { PricedLine } from './prices';

/** Square rejects fictional 555 numbers. Other 10-digit US numbers are sent as E.164. */
export function squareBuyerPhone(phone: string | undefined): string | undefined {
  if (!phone) return undefined;
  const digits = phone.replace(/\D/g, '');
  const national = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (national.length !== 10) return undefined;
  if (national.slice(3, 6) === '555') return undefined;
  return `+1${national}`;
}

export function buildCreatePaymentLinkBody(input: {
  locationId: string;
  idempotencyKey: string;
  redirectUrl: string;
  buyerEmail: string;
  buyerName?: string;
  buyerPhone?: string;
  customerId?: string;
  lines: PricedLine[];
}) {
  const buyerPhone = squareBuyerPhone(input.buyerPhone);
  return {
    idempotency_key: input.idempotencyKey,
    ...(input.buyerName ? { payment_note: input.buyerName } : {}),
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
      metadata: { source: 'website-cart' },
    },
    checkout_options: {
      redirect_url: input.redirectUrl,
    },
    pre_populated_data: {
      buyer_email: input.buyerEmail,
      ...(buyerPhone ? { buyer_phone_number: buyerPhone } : {}),
    },
  };
}
