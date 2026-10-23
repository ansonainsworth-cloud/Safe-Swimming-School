import type { PricedLine } from './prices';

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
      ...(input.buyerPhone ? { buyer_phone_number: input.buyerPhone } : {}),
    },
  };
}
