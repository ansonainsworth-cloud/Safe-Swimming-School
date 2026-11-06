import { normalizeEmail, normalizeName, normalizePhone, SQUARE_VERSION } from '../_lib/prices';
import { BOOK_DAYS, bookStartTimes, formatBookTime, isBookSlotBlocked } from '../../src/data/blocked-slots';
import { bookTown } from '../../src/data/book-towns';

const BOOKING_SOON = 'Online booking opens soon. Text 561-236-8260 to book.';
const LIMITED = 'Limited availability, text 561-236-8260.';
const SQUARE_PAYMENT_LINKS = 'https://connect.squareup.com/v2/online-checkout/payment-links';

const OPTIONS = {
  single: { name: 'Single lesson', amount: 7500 },
  'pkg-8': { name: '8 lessons', amount: 52000 },
  'pkg-12': { name: '12 lessons', amount: 72000 },
  'pkg-20': { name: '20 lessons', amount: 110000 },
} as const;

type BookOption = keyof typeof OPTIONS;

type PagesContext = {
  request: Request;
  env: { SQUARE_ACCESS_TOKEN?: string; SQUARE_LOCATION_ID?: string };
};

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
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
    poolAddress?: unknown;
  };

  const option = typeof body.option === 'string' ? OPTIONS[body.option as BookOption] : undefined;
  if (!option || !(body.option === 'single' || body.option === 'pkg-8' || body.option === 'pkg-12' || body.option === 'pkg-20')) {
    return json({ message: 'Choose a lesson.' }, 400);
  }
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
  if (!name || !email || !phone || !childAge || !poolAddress) {
    return json({ message: 'Add your name, email, phone, child age, and pool address.' }, 400);
  }

  const note = [
    `Parent: ${name}`,
    `Email: ${email}`,
    `Phone: ${phone}`,
    `Child age: ${childAge}`,
    `Pool: ${poolAddress}`,
    `Town: ${town.name}`,
    `Day: ${day}`,
    `Time: ${formatBookTime(time)}`,
    `Option: ${option.name} $${(option.amount / 100).toLocaleString('en-US')}`,
  ].join('. ').slice(0, 500);

  const origin = new URL(request.url).origin;
  const redirectHost = origin.replace(/^http:/, 'https:');
  let created: unknown;
  try {
    const response = await fetch(SQUARE_PAYMENT_LINKS, {
      method: 'POST',
      redirect: 'manual',
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Accept-Encoding': 'identity',
        'Content-Type': 'application/json',
        'Square-Version': SQUARE_VERSION,
      },
      body: JSON.stringify({
        idempotency_key: crypto.randomUUID(),
        payment_note: note,
        order: {
          location_id: locationId,
          line_items: [
            {
              name: option.name,
              quantity: '1',
              base_price_money: { amount: option.amount, currency: 'USD' },
              note,
            },
          ],
        },
        checkout_options: { redirect_url: `${redirectHost}/checkout/thanks/` },
        pre_populated_data: { buyer_email: email, buyer_phone_number: phone },
      }),
    });
    created = await response.json();
    if (!response.ok) return json({ message: 'We could not start checkout. Text 561-236-8260.' }, 502);
  } catch {
    return json({ message: 'We could not start checkout. Text 561-236-8260.' }, 502);
  }

  const url = (created as { payment_link?: { url?: unknown } })?.payment_link?.url;
  if (typeof url !== 'string' || !url.startsWith('https://')) {
    return json({ message: 'We could not start checkout. Text 561-236-8260.' }, 502);
  }
  return json({ url }, 200);
}

export async function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.method === 'POST') return onRequestPost(context);
  return json({ message: 'Use the booking form.' }, 405);
}
