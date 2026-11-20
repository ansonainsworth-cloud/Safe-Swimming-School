import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = new URL('..', import.meta.url).pathname;
const meta = 'Private lessons at your Juno Beach home or community pool. Same instructor every lesson. 8 for $520, registration waived if bought by Dec 31.';
const opening = 'Juno Beach is a small oceanfront town between Jupiter and North Palm Beach.';
const faqs: Array<[string, string]> = [
  ['Do you come to my pool in Juno Beach?', 'Yes. We teach at home pools, condo pools, and community pools in Juno Beach. Tell us your pool type when you text, and check building or community rules if that is where you want to swim.'],
  ['Do you teach in Juno Beach?', 'Yes. Juno Beach is in our Palm Beach County service area. Town pages are examples, not a limit. ZIP 33408 is also used in North Palm Beach, and we can help you sort out the right fit. See swim lessons in North Palm Beach.'],
  ['Do you keep the same instructor every lesson?', 'Yes. You have the same instructor every lesson.'],
  ['What ages do you teach?', 'From 3 months to adults. Infant lessons start with a parent in the water, then move to private lessons. See infant swim lessons.'],
  ['How much do lessons cost?', '8 lessons for $520, 12 for $720, and 20 for $1,100. Annual registration ($35 for one swimmer, $50 for two siblings, $60 for three or more) is waived on lock in packages bought by December 31, 2026. A single lesson is $75 and can be credited toward a package.'],
  ['Do you offer group lessons?', 'No. Lessons are private, or semi-private for siblings learning together.'],
  ['How do I get started?', 'Text or call 561-236-8260, or use the form on the enroll page. Lessons are available 8 AM to 7 PM every day.'],
  ["Can you keep our family's information private?", "Yes. We're happy to sign an NDA for families who want privacy."],
  ['Is there a registration fee?', "Registration is $35 for one swimmer, $50 for two siblings, or $60 for three or more. It's waived on lock in packages bought by December 31, 2026: 8 lessons for $520, 12 for $720, or 20 for $1,100. Lock in packages never expire, so your family can use lessons whenever it suits you. Lessons happen at your home or community pool. A single lesson is $75."],
  ['Do you offer swim lesson gift certificates?', 'Safe Swimming School offers three gift certificates for private swim lessons. The holiday gift certificate is 8 private 30-minute lessons for $475, the 12-lesson gift certificate is 12 private 30-minute lessons for $720, and the 20-lesson gift certificate is 20 private 30-minute lessons for $1,100. The $35 annual registration is waived on all three.'],
  ['How much is the holiday swim lesson gift certificate?', 'It is $475 for 8 private 30-minute lessons, and the $35 annual registration is waived. The $475 gift offer ends December 24, 2026.'],
  ['When does a swim lesson gift certificate expire?', 'Gift certificates expire December 31, 2027.'],
  ['How does the recipient schedule lessons?', "The recipient books days and times when they redeem the certificate. Lessons are private 30-minute lessons at the family's home or community pool."],
  ['How do I buy a gift certificate?', 'Pay on our gift certificate page at /gift-certificates/ by Zelle to 561-236-8260 or Venmo @safe-swim. We email the gift certificate when we receive payment. Questions? Text 561-236-8260 or email info@safeswimmingschool.com.'],
];
const banned = [
  'water-safe in 5 days',
  'state-certified',
  'life-saving',
  'lifesaving',
  'most trusted',
  'critical survival skill',
  'self-rescue',
  'lifeguard',
  'drowning',
  'plus annual registration',
];
const places = ['A1A', 'Juno Ridge', 'Loggerhead Park', 'Juno Beach Pier', 'US-1'];

function strip(value: string) {
  return value
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

describe('Juno Beach local page', () => {
  it('shows distinct local copy and FAQs that match the schema', () => {
    execSync('npm run build', { cwd: root, stdio: 'pipe' });
    const html = readFileSync(join(root, 'dist/locations/juno-beach/index.html'), 'utf8');
    expect(strip(html.match(/<title>([^<]*)<\/title>/)?.[1] || '')).toBe('Survival Swim Lessons in Juno Beach, FL | Safe Swimming School');
    expect(html).toContain(`content="${meta}"`);
    expect(meta.length).toBeLessThanOrEqual(150);
    expect(meta).toHaveLength(141);
    expect(html).not.toMatch(/8 AM–7 PM/);
    expect(strip(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] || '')).toBe('Private Swim Lessons in Juno Beach, FL');
    const article = html.slice(html.indexOf('<article'), html.indexOf('<aside'));
    expect(article).toContain(opening);
    expect(article).toContain('same instructor every lesson');
    expect(article).toContain('founder Cortney Berry (20 years) and cofounder Anson Ainsworth (18 years)');
    for (const href of [
      '/infant-swim-lessons-palm-beach-county/',
      '/survival-swim-lessons-palm-beach-county/',
      '/adult-swim-lessons-palm-beach-county/',
      '/adaptive-swim-lessons/',
      '/locations/',
      '/locations/jupiter/',
      '/locations/north-palm-beach/',
      '/locations/palm-beach-gardens/',
      '/locations/tequesta/',
    ]) expect(article, href).toContain(`href="${href}"`);
    expect(article).not.toContain('swim-lessons-coral-springs-parkland');
    for (const name of places) expect(article, name).toContain(name);
    const visible = [...article.matchAll(/<p><strong>([\s\S]*?)<\/strong><\/p>\s*<p>([\s\S]*?)<\/p>/g)].map((match) => [strip(match[1]), strip(match[2])]);
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => JSON.parse(match[1]));
    const nodes = blocks.flatMap((block) => (Array.isArray(block['@graph']) ? block['@graph'] : [block]));
    expect(nodes.filter((node) => node['@type'] === 'FAQPage')).toHaveLength(1);
    expect(nodes.some((node) => node['@type'] === 'Review' || node['@type'] === 'AggregateRating')).toBe(false);
    const business = nodes.find((node) => node['@type'] === 'LocalBusiness');
    expect(business.areaServed.some((area: { name?: string }) => area.name === 'Juno Beach')).toBe(true);
    expect(business.areaServed.some((area: { name?: string }) => area.name === 'Palm Beach County')).toBe(true);
    expect(business.address.streetAddress).toBeUndefined();
    const faq = nodes.find((node) => node['@type'] === 'FAQPage');
    const schema = faq.mainEntity.map((item: { name: string; acceptedAnswer: { text: string } }) => [item.name, item.acceptedAnswer.text]);
    expect(visible).toEqual(faqs);
    expect(schema).toEqual(faqs);
    const headAndSchema = `${html.match(/<title>([^<]*)<\/title>/)?.[1] || ''} ${html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] || ''} ${blocks.map((block) => JSON.stringify(block)).join(' ')}`;
    for (const name of places) expect(headAndSchema, name).not.toContain(name);
    const body = strip(article).toLowerCase();
    expect(body).not.toContain('survival swim lessons');
    for (const phrase of banned) expect(body, phrase).not.toContain(phrase.toLowerCase());
    expect(body).not.toMatch(/\bisr\b/);
  });
});
