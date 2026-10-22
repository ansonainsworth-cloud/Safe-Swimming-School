export type PaymentLink = {
  label: string;
  price: string;
  url: string;
};

/** Square payment link. Paste it into `url`, or leave `url` empty so Pay stays on /enroll/. */
export const paymentLinks: PaymentLink[] = [
  { label: 'Trial', price: '$75', url: '' },
  { label: 'Registration', price: '$35', url: '' },
  { label: '8 lessons', price: '$520', url: '' },
  { label: '12 lessons', price: '$720', url: '' },
  { label: '20 lessons', price: '$1,100', url: '' },
  { label: 'Water aerobics', price: '$45 per class', url: '' },
];

/** Optional. When set, main Enroll and Book buttons use this URL. Empty keeps /enroll/. */
export const bookingUrl = '';

export function paymentLink(label: string): PaymentLink {
  const link = paymentLinks.find((item) => item.label === label);
  if (!link) throw new Error(`Unknown payment link: ${label}`);
  return link;
}

export function bookingHref(): string {
  return bookingUrl.trim() || '/enroll/';
}

export function payHref(link: PaymentLink): string {
  return link.url.trim() || '/enroll/';
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

export function payButtonHtml(link: PaymentLink): string {
  const href = escapeAttr(payHref(link));
  const name = escapeAttr(`Pay ${link.label}, ${link.price}`);
  return `<a class="sss-btn" href="${href}" aria-label="${name}">Pay</a>`;
}

/** Point anchors labeled Enroll or Book at `bookingUrl` once it is set. */
export function rewriteBookingButtons(html: string): string {
  const href = escapeAttr(bookingHref());
  return html.replace(/<a href="\/enroll\/">((?:Enroll|Book))<\/a>/g, `<a href="${href}">$1</a>`);
}
