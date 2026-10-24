import type { PricedLine } from './prices';

/** Square rejects reserved example.com addresses on payment links. The buyer can type one on the checkout page. */
export function squareBuyerEmail(email: string | undefined): string | undefined {
  if (!email) return undefined;
  const domain = email.split('@')[1]?.toLowerCase();
  if (domain === 'example.com' || domain === 'example.org' || domain === 'example.net') return undefined;
  return email;
}

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
  const buyerEmail = squareBuyerEmail(input.buyerEmail);
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
      ...(buyerEmail ? { buyer_email: buyerEmail } : {}),
      ...(buyerPhone ? { buyer_phone_number: buyerPhone } : {}),
    },
  };
}
