import { type CustomerSearchResult, type PaymentListResult, type SquareLookup } from './registration';

/**
 * Trial lesson credit.
 *
 * A paid $75 single lesson can take $75 off one later package
 * (8 lessons $520, 12 lessons $720, or 20 lessons $1,100).
 * The package order stores metadata.trial_credit_payment_id set to that
 * Square payment id.
 *
 * Live payments do not leave a COMPLETED order on the customer. The reference
 * shape is a COMPLETED payment whose customer_id is set, pointing at an OPEN
 * order with no customer_id, no metadata, and no note. The line item is an
 * ad hoc "Single lesson" for 7500. The word trial is not on the payment or order.
 *
 * Lookup lists payments with total 7500, keeps COMPLETED ones whose customer_id
 * or buyer_email_address matches, then reads each order and keeps a line named
 * exactly "Single lesson" with quantity 1 and amount 7500. Order state and
 * order customer_id are not required.
 *
 * Later package purchases are COMPLETED orders on the customer. Those are the
 * only orders that mark the credit used, or that count as a package bought
 * after the trial.
 *
 * Limits:
 * - ListPayments has no customer filter. We ask for amount 7500 at this location
 *   from the last five years, then filter. At most 10 pages. A match past that
 *   window is missed, and checkout continues at full price.
 * - An unpaid payment is not COMPLETED, so it does not burn the credit.
 * - Two open package links can both include the discount. Paying both would
 *   discount twice.
 * - A payment under a different email and a different customer id is not found.
 * - Cash or Zelle is not a Square payment, so it is not credited here.
 * - One checkout applies one $75 credit, the oldest eligible payment.
 * - A completed package with no closed_at is treated as after the trial.
 * - Any Square lookup error skips the discount and continues checkout.
 */

export const TRIAL_CREDIT_CENTS = 7500;
export const TRIAL_CREDIT_NAME = 'Trial lesson credit';
export const TRIAL_CREDIT_METADATA_KEY = 'trial_credit_payment_id';
export const SINGLE_LESSON_NAME = 'Single lesson';

const PACKAGE_AMOUNTS = new Set([52000, 72000, 110000]);

export type CreditLine = {
  name?: string;
  quantity?: string;
  base_price_money?: { amount?: number };
  gross_sales_money?: { amount?: number };
  total_money?: { amount?: number };
  catalog_object_id?: string;
  variation_name?: string;
};

export type CreditOrder = {
  id?: string;
  state?: string;
  closed_at?: string;
  created_at?: string;
  customer_id?: string;
  line_items?: CreditLine[];
  total_money?: { amount?: number };
  metadata?: Record<string, string>;
  note?: string;
};

export type SquarePayment = NonNullable<PaymentListResult['payments']>[number];

export type FoundTrial = {
  paymentId: string;
  paidAt: string;
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

/** Exact ad hoc line. Order state and customer_id are ignored. */
export function isSingleLessonOrder(order: CreditOrder): boolean {
  return (order.line_items ?? []).some((line) => (
    line.name === SINGLE_LESSON_NAME
    && lineQuantity(line) === 1
    && lineAmount(line) === TRIAL_CREDIT_CENTS
  ));
}

function isPackageOrder(order: CreditOrder): boolean {
  return (order.line_items ?? []).some(isPackageLine);
}

function orderTime(order: CreditOrder): string {
  return order.closed_at || order.created_at || '';
}

export function paymentMatchesBuyer(payment: SquarePayment, email: string, customerIds: ReadonlySet<string>): boolean {
  if (payment.status !== 'COMPLETED') return false;
  const amount = payment.amount_money?.amount ?? payment.total_money?.amount;
  if (amount !== TRIAL_CREDIT_CENTS) return false;
  if (payment.amount_money?.currency && payment.amount_money.currency !== 'USD') return false;
  const emailMatch = (payment.buyer_email_address || '').toLowerCase() === email;
  const customerMatch = Boolean(payment.customer_id && customerIds.has(payment.customer_id));
  return emailMatch || customerMatch;
}

export function decideTrialCredit(buyingPackage: boolean, trials: FoundTrial[], packageOrders: CreditOrder[]): TrialCreditDecision {
  if (!buyingPackage) return { apply: false, reason: 'no-package' };
  const packages = packageOrders.filter((order) => isPackageOrder(order) || Boolean(order.metadata?.[TRIAL_CREDIT_METADATA_KEY]));
  const used = new Set(
    packageOrders
      .map((order) => order.metadata?.[TRIAL_CREDIT_METADATA_KEY])
      .filter((id): id is string => Boolean(id)),
  );
  const sorted = [...trials].filter((trial) => trial.paymentId).sort((a, b) => a.paidAt.localeCompare(b.paidAt));
  let sawUsed = false;
  let sawPackageAfter = false;
  for (const trial of sorted) {
    if (used.has(trial.paymentId)) {
      sawUsed = true;
      continue;
    }
    const packageAfter = packages.some((pack) => {
      const packTime = orderTime(pack);
      return !packTime || !trial.paidAt || packTime > trial.paidAt;
    });
    if (packageAfter) {
      sawPackageAfter = true;
      continue;
    }
    return { apply: true, reason: 'applied', paymentId: trial.paymentId };
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
  if (!lookup.listPayments || !lookup.retrieveOrder) return { apply: false, reason: 'lookup-error' };
  try {
    const ids = customerIds(await lookup.searchCustomers(email));
    if (ids === null) return { apply: false, reason: 'lookup-error' };
    const idSet = new Set(ids);
    const trials: FoundTrial[] = [];
    let cursor: string | undefined;
    let page = 0;
    do {
      const listed = await lookup.listPayments(cursor);
      page += 1;
      for (const payment of listed.payments ?? []) {
        if (!paymentMatchesBuyer(payment, email, idSet) || !payment.id || !payment.order_id) continue;
        const retrieved = await lookup.retrieveOrder(payment.order_id);
        const order = retrieved.order as CreditOrder | undefined;
        if (!order || !isSingleLessonOrder(order)) continue;
        trials.push({ paymentId: payment.id, paidAt: payment.created_at || '' });
      }
      cursor = listed.cursor || undefined;
    } while (cursor && page < 10);

    const packageOrders: CreditOrder[] = [];
    for (const customerId of ids) {
      let orderCursor: string | undefined;
      let orderPage = 0;
      do {
        const result = lookup.searchAllOrders
          ? await lookup.searchAllOrders(customerId, orderCursor)
          : await lookup.searchOrders(customerId, '1970-01-01T00:00:00.000Z', orderCursor);
        orderPage += 1;
        packageOrders.push(...((result.orders ?? []) as CreditOrder[]));
        orderCursor = result.cursor || undefined;
      } while (orderCursor && orderPage < 10);
    }
    return decideTrialCredit(true, trials, packageOrders);
  } catch {
    return { apply: false, reason: 'lookup-error' };
  }
}
