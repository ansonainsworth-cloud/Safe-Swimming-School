import { normalizeEmail, normalizeName, normalizePhone, packageRegistrationWaived, registrationPriceCents } from '../_lib/prices';
import { buyerFieldRejection, squarePost, SquareRequestError, type SquareEnv } from '../_lib/square';
import { BOOK_DAYS, bookStartTimes, formatBookTime, isBookSlotBlocked } from '../../src/data/blocked-slots';
import { bookTown } from '../../src/data/book-towns';

const BOOKING_SOON = 'Online booking opens soon. Text 561-236-8260 to book.';
const LIMITED = 'Limited availability, text 561-236-8260.';
const CHECKOUT_FAILED = 'We could not start checkout. Text 561-236-8260.';

const OPTIONS = {
  single: { name: 'Single lesson', amount: 7500 },
  'pkg-8': { name: '8 lessons', amount: 52000 },
  'pkg-12': { name: '12 lessons', amount: 72000 },
  'pkg-20': { name: '20 lessons', amount: 110000 },
} as const;

type BookOption = keyof typeof OPTIONS;

export function registrationLineName(swimmers: number): string {
  if (swimmers >= 3) return 'Annual registration (3+ family)';
  if (swimmers === 2) return 'Annual registration (2 siblings)';
  return 'Annual registration (1 swimmer)';
}

/** Package price, plus registration unless this lock in package is still inside the Dec 31, 2026 waiver. */
export function bookChargeLines(optionKey: BookOption, swimmers: number, now: Date): Array<{ name: string; amount: number }> {
  const option = OPTIONS[optionKey];
  const lines = [{ name: option.name, amount: option.amount }];
  if (!packageRegistrationWaived([optionKey], now)) {
    lines.push({ name: registrationLineName(swimmers), amount: registrationPriceCents(swimmers) });
  }
  return lines;
}

type PagesContext = {
  request: Request;
  env: SquareEnv;
};

/** This route called production directly before it shared squarePost. Keep that host when SQUARE_ENV is unset. */
function bookSquareEnv(env: SquareEnv): SquareEnv {
  if (env.SQUARE_ENV === 'sandbox' || env.SQUARE_ENV === 'production') return env;
  return { ...env, SQUARE_ENV: 'production' };
}

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function swimmerCount(value: unknown): number | null {
  if (value == null || value === '') return 1;
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && /^[123]$/.test(value.trim()) ? Number(value.trim()) : NaN;
  if (parsed !== 1 && parsed !== 2 && parsed !== 3) return null;
  return parsed;
}

function cleanText(value: unknown, min: number, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/\s+/g, ' ');
  if (text.length < min || text.length > max) return null;
  if (/[\u0000-\u001f]/.test(text)) return null;
  return text;
}

export async function onRequestPost({ request, env }: PagesContext): Promise<Response> {
  const token = env.SQUARE_ACCESS_TOKEN;
  const locationId = env.SQUARE_LOCATION_ID;
  if (!token || !locationId) return json({ message: BOOKING_SOON }, 503);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ message: 'Check the form and try again.' }, 400);
  }
  if (!payload || typeof payload !== 'object') return json({ message: 'Check the form and try again.' }, 400);
  const body = payload as {
    option?: unknown;
    town?: unknown;
    day?: unknown;
    time?: unknown;
    name?: unknown;
    email?: unknown;
    phone?: unknown;
    childAge?: unknown;
    childAge2?: unknown;
    childAge3?: unknown;
    swimmers?: unknown;
    poolAddress?: unknown;
  };

  const optionKey = body.option;
  if (optionKey !== 'single' && optionKey !== 'pkg-8' && optionKey !== 'pkg-12' && optionKey !== 'pkg-20') {
    return json({ message: 'Choose a lesson.' }, 400);
  }
  const option = OPTIONS[optionKey];
  const town = typeof body.town === 'string' ? bookTown(body.town) : undefined;
  if (!town) return json({ message: 'Choose a town.' }, 400);
  if (town.limited) return json({ message: LIMITED }, 400);

  const day = typeof body.day === 'string' && (BOOK_DAYS as readonly string[]).includes(body.day) ? body.day : '';
  const time = typeof body.time === 'string' && bookStartTimes().includes(body.time) ? body.time : '';
  if (!day || !time || isBookSlotBlocked(day, time)) return json({ message: 'Choose an open time.' }, 400);

  const name = normalizeName(body.name);
  const email = normalizeEmail(body.email);
  const phone = normalizePhone(body.phone);
  const childAge = cleanText(body.childAge, 1, 20);
  const poolAddress = cleanText(body.poolAddress, 4, 200);
  const swimmers = swimmerCount(body.swimmers);
  if (!name || !email || !phone || !childAge || !poolAddress || !swimmers) {
    return json({ message: 'Add your name, email, phone, child age, and pool address.' }, 400);
  }
  const childAge2 = swimmers >= 2 ? cleanText(body.childAge2, 1, 20) : null;
  const childAge3 = swimmers >= 3 ? cleanText(body.childAge3, 1, 20) : null;
  if ((swimmers >= 2 && !childAge2) || (swimmers >= 3 && !childAge3)) {
    return json({ message: 'Add an age for each swimmer.' }, 400);
  }

  const note = [
    `Parent: ${name}`,
    `Email: ${email}`,
    `Phone: ${phone}`,
    `Child age: ${childAge}`,
    childAge2 ? `Second child age: ${childAge2}` : '',
    childAge3 ? `Third child age: ${childAge3}` : '',
    `Swimmers: ${swimmers}`,
    `Pool: ${poolAddress}`,
    `Town: ${town.name}`,
    `Day: ${day}`,
    `Time: ${formatBookTime(time)}`,
    `Option: ${option.name} $${(option.amount / 100).toLocaleString('en-US')}`,
  ].filter(Boolean).join('. ').slice(0, 500);

  const origin = new URL(request.url).origin;
  const redirectHost = origin.replace(/^http:/, 'https:');
  let created: unknown;
  try {
    created = await squarePost(bookSquareEnv(env), '/v2/online-checkout/payment-links', {
      idempotency_key: crypto.randomUUID(),
      payment_note: note,
      order: {
        location_id: locationId,
        line_items: bookChargeLines(optionKey, swimmers, new Date()).map((line, index) => ({
          name: line.name,
          quantity: '1',
          base_price_money: { amount: line.amount, currency: 'USD' },
          ...(index === 0 ? { note } : {}),
        })),
      },
      checkout_options: { redirect_url: `${redirectHost}/checkout/thanks/` },
      pre_populated_data: { buyer_email: email, buyer_phone_number: phone },
    });
  } catch (error) {
    const friendly = error instanceof SquareRequestError ? buyerFieldRejection(error.status, error.errors) : null;
    if (friendly) return json(friendly, 400);
    return json({ message: CHECKOUT_FAILED }, 502);
  }

  const url = (created as { payment_link?: { url?: unknown } })?.payment_link?.url;
  if (typeof url !== 'string' || !url.startsWith('https://')) {
    return json({ message: CHECKOUT_FAILED }, 502);
  }
  return json({ url }, 200);
}

export async function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.method === 'POST') return onRequestPost(context);
  return json({ message: 'Use the booking form.' }, 405);
}
