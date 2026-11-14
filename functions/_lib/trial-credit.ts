import { type CustomerSearchResult, type SquareLookup } from './registration';

/**
 * Trial lesson credit.
 *
 * A completed $75 single lesson can take $75 off one later package order
 * (8 lessons $520, 12 lessons $720, or 20 lessons $1,100). The package order
 * stores metadata.trial_credit_payment_id set to that trial's Square payment id
 * (or order:{orderId} when the tender has no payment id).
 *
 * Only COMPLETED orders count. completedOrderSearchBody asks Square for
 * state COMPLETED and does not filter by date. An unpaid payment link creates
 * an open order, so it does not burn the credit.
 *
 * Limits:
 * - Two open links at once can both show the discount. Paying both would
 *   discount twice, because the second link was built before either order completed.
 * - A trial paid under a different email is not found. Lookup is the exact
 *   buyer email on the Square customer.
 * - Cash or Zelle trials are not Square payments, so they are not credited here.
 * - One checkout applies one $75 credit, the oldest eligible trial. Another
 *   uncredited trial can apply to a later package.
 * - A completed package with no closed_at is treated as after the trial.
 * - Any Square lookup error skips the discount and continues checkout.
 */

export const TRIAL_CREDIT_CENTS = 7500;
export const TRIAL_CREDIT_NAME = 'Trial lesson credit';
export const TRIAL_CREDIT_METADATA_KEY = 'trial_credit_payment_id';

const PACKAGE_AMOUNTS = new Set([52000, 72000, 110000]);

export type CreditLine = {
  name?: string;
  quantity?: string;
  base_price_money?: { amount?: number };
  gross_sales_money?: { amount?: number };
  total_money?: { amount?: number };
};

export type CreditOrder = {
  id?: string;
  closed_at?: string;
  created_at?: string;
  line_items?: CreditLine[];
  total_money?: { amount?: number };
  tenders?: Array<{ payment_id?: string }>;
  metadata?: Record<string, string>;
};

export type TrialCreditReason =
  | 'no-package'
  | 'no-trial'
  | 'credit-used'
  | 'package-after-trial'
  | 'applied'
  | 'lookup-error';

export type TrialCreditDecision = {
  apply: boolean;
  reason: TrialCreditReason;
  paymentId?: string;
};

export function trialCreditOrderFields(decision: TrialCreditDecision): {
  discounts?: Array<{ uid: string; name: string; type: string; scope: string; amount_money: { amount: number; currency: string } }>;
  metadata?: Record<string, string>;
} {
  if (!decision.apply || !decision.paymentId) return {};
  return {
    discounts: [
      {
        uid: 'trial-lesson-credit',
        name: TRIAL_CREDIT_NAME,
        type: 'FIXED_AMOUNT',
        scope: 'ORDER',
        amount_money: { amount: TRIAL_CREDIT_CENTS, currency: 'USD' },
      },
    ],
    metadata: { [TRIAL_CREDIT_METADATA_KEY]: decision.paymentId },
  };
}

function lineAmount(line: CreditLine): number | null {
  const amount = line.base_price_money?.amount ?? line.gross_sales_money?.amount ?? line.total_money?.amount;
  return typeof amount === 'number' ? amount : null;
}

function lineQuantity(line: CreditLine): number {
  const quantity = Number(line.quantity ?? '1');
  return Number.isFinite(quantity) ? quantity : 1;
}

function isPackageLine(line: CreditLine): boolean {
  const name = (line.name || '').toLowerCase();
  if (/\b(8|12|20)\b/.test(name) && name.includes('lesson')) return true;
  const amount = lineAmount(line);
  return amount != null && PACKAGE_AMOUNTS.has(amount);
}

function isTrialOrder(order: CreditOrder): boolean {
  const lines = order.line_items ?? [];
  const namedTrial = lines.some((line) => {
    const name = line.name || '';
    return lineQuantity(line) === 1 && lineAmount(line) === TRIAL_CREDIT_CENTS && /single lesson|trial/i.test(name);
  });
  if (namedTrial) return true;
  return order.total_money?.amount === TRIAL_CREDIT_CENTS && !lines.some(isPackageLine);
}

function isPackageOrder(order: CreditOrder): boolean {
  return (order.line_items ?? []).some(isPackageLine);
}

function orderTime(order: CreditOrder): string {
  return order.closed_at || order.created_at || '';
}

export function trialPaymentId(order: CreditOrder): string {
  const paymentId = (order.tenders ?? []).find((tender) => tender.payment_id)?.payment_id;
  if (paymentId) return paymentId;
  return order.id ? `order:${order.id}` : '';
}

export function decideTrialCredit(buyingPackage: boolean, orders: CreditOrder[]): TrialCreditDecision {
  if (!buyingPackage) return { apply: false, reason: 'no-package' };
  const trials = orders.filter(isTrialOrder).sort((a, b) => orderTime(a).localeCompare(orderTime(b)));
  const packages = orders.filter(isPackageOrder);
  const used = new Set(
    orders
      .map((order) => order.metadata?.[TRIAL_CREDIT_METADATA_KEY])
      .filter((id): id is string => Boolean(id)),
  );
  let sawUsed = false;
  let sawPackageAfter = false;
  for (const trial of trials) {
    const paymentId = trialPaymentId(trial);
    if (!paymentId) continue;
    if (used.has(paymentId)) {
      sawUsed = true;
      continue;
    }
    const trialTime = orderTime(trial);
    const packageAfter = packages.some((pack) => {
      const packTime = orderTime(pack);
      return !packTime || !trialTime || packTime > trialTime;
    });
    if (packageAfter) {
      sawPackageAfter = true;
      continue;
    }
    return { apply: true, reason: 'applied', paymentId };
  }
  if (sawUsed) return { apply: false, reason: 'credit-used' };
  if (sawPackageAfter) return { apply: false, reason: 'package-after-trial' };
  return { apply: false, reason: 'no-trial' };
}

function customerIds(customers: CustomerSearchResult): string[] | null {
  if (!customers || typeof customers !== 'object' || Array.isArray(customers)) return null;
  return (customers.customers ?? []).map((customer) => customer.id).filter((id): id is string => Boolean(id));
}

export async function lookupTrialCredit(email: string, lookup: SquareLookup, buyingPackage: boolean): Promise<TrialCreditDecision> {
  if (!buyingPackage) return { apply: false, reason: 'no-package' };
  try {
    const ids = customerIds(await lookup.searchCustomers(email));
    if (ids === null) return { apply: false, reason: 'lookup-error' };
    if (ids.length === 0) return { apply: false, reason: 'no-trial' };
    const orders: CreditOrder[] = [];
    for (const customerId of ids) {
      let cursor: string | undefined;
      let page = 0;
      do {
        const result = lookup.searchAllOrders
          ? await lookup.searchAllOrders(customerId, cursor)
          : await lookup.searchOrders(customerId, '1970-01-01T00:00:00.000Z', cursor);
        page += 1;
        orders.push(...((result.orders ?? []) as CreditOrder[]));
        cursor = result.cursor || undefined;
      } while (cursor && page < 10);
    }
    return decideTrialCredit(true, orders);
  } catch {
    return { apply: false, reason: 'lookup-error' };
  }
}
