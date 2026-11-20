import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = new URL('..', import.meta.url).pathname;
const opening = 'Riviera Beach has a mainland side and Singer Island, with the Lake Worth Lagoon between them.';
const localFaqs: Array<[string, string]> = [
  ['Do you come to pools on Singer Island and in mainland Riviera Beach?', 'Yes. We teach at home pools, condo pools, and community pools on Singer Island and on the mainland in Riviera Beach. Tell us your pool type when you text. If the lesson is at a condo or community pool, check the building or community rules first. Swimmers practice how to roll to back, float and rest, and swim to the wall. These skills are one layer of protection. Nothing replaces adult supervision and pool barriers.'],
  ['Can you teach at a Singer Island condo pool?', "Yes, when the family has access to that pool and the building allows an instructor to visit. We come to you. Please confirm the rules with the building before the first lesson. A backyard pool on the mainland is the family's own pool."],
  ['Do you keep the same instructor every lesson?', 'Yes. You have the same instructor every lesson.'],
  ['What ages do you teach?', 'From 3 months to adults. Infant lessons start with a parent in the water, then move to private lessons. See infant swim lessons.'],
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
];

function strip(value: string) {
  return value
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

describe('Riviera Beach local page', () => {
  it('shows the local opening and FAQs, matching the schema, without banned phrases', () => {
    execSync('npm run build', { cwd: root, stdio: 'pipe' });
    const html = readFileSync(join(root, 'dist/locations/riviera-beach/index.html'), 'utf8');
    expect(strip(html.match(/<title>([^<]*)<\/title>/)?.[1] || '')).toBe('Survival Swim Lessons in Riviera Beach & Singer Island, FL | Safe Swimming School');
    expect(html).toContain('content="Private lessons at your Riviera Beach or Singer Island pool. Same instructor every lesson. 8 lessons for $520, registration waived by Dec 31. Text 561-236-8260."');
    expect(html).not.toMatch(/8 AM–7 PM/);
    expect(strip(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] || '')).toBe('Private Swim Lessons in Riviera Beach and Singer Island, FL');
    const article = html.slice(html.indexOf('<article'), html.indexOf('<aside'));
    expect(article).toContain(opening);
    expect(article).toContain('same instructor every lesson');
    expect(article).toContain('href="/infant-swim-lessons-palm-beach-county/"');
    expect(article).toContain('href="/survival-swim-lessons-palm-beach-county/"');
    expect(article).toContain('Blue Heron Bridge');
    expect(article).toContain('Palm Beach Shores');
    expect(article).toContain('33404');
    expect(article).toContain('families in places like Riviera Beach Heights');
    expect(html).not.toContain('Sugar Sands');
    expect(html).not.toContain('The Resort at Singer Island');
    const visible = [...article.matchAll(/<p><strong>([\s\S]*?)<\/strong><\/p>\s*<p>([\s\S]*?)<\/p>/g)].map((match) => [strip(match[1]), strip(match[2])]);
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => JSON.parse(match[1]));
    const nodes = blocks.flatMap((block) => (Array.isArray(block['@graph']) ? block['@graph'] : [block]));
    expect(nodes.filter((node) => node['@type'] === 'FAQPage')).toHaveLength(1);
    expect(nodes.some((node) => node['@type'] === 'Review' || node['@type'] === 'AggregateRating')).toBe(false);
    const business = nodes.find((node) => node['@type'] === 'LocalBusiness');
    const singer = business.areaServed.find((area: { name?: string }) => area.name === 'Singer Island');
    expect(singer['@type']).toBe('Place');
    expect(singer.containedInPlace.name).toBe('Riviera Beach');
    expect(business.address.streetAddress).toBeUndefined();
    const faq = nodes.find((node) => node['@type'] === 'FAQPage');
    const schema = faq.mainEntity.map((item: { name: string; acceptedAnswer: { text: string } }) => [item.name, item.acceptedAnswer.text]);
    const headAndSchema = `${html.match(/<title>([^<]*)<\/title>/)?.[1] || ''} ${html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] || ''} ${blocks.map((block) => JSON.stringify(block)).join(' ')}`;
    for (const name of ['Riviera Beach Heights']) {
      expect(headAndSchema, name).not.toContain(name);
    }
    expect(schema.slice(0, 4)).toEqual(localFaqs);
    expect(visible.slice(0, 4)).toEqual(localFaqs);
    expect(schema.filter(([question]) => localFaqs.some(([name]) => name === question))).toEqual(localFaqs);
    expect(schema.at(-5)?.[1]).toBe('Safe Swimming School offers three gift certificates for private swim lessons. The holiday gift certificate is 8 private 30-minute lessons for $475, the 12-lesson gift certificate is 12 private 30-minute lessons for $720, and the 20-lesson gift certificate is 20 private 30-minute lessons for $1,100. The $35 annual registration is waived on all three.');
    expect(schema.at(-3)?.[1]).toBe('Gift certificates expire December 31, 2027.');
    const body = strip(article).toLowerCase();
    expect(body).not.toContain('survival swim lessons');
    for (const phrase of banned) expect(body, phrase).not.toContain(phrase.toLowerCase());
    expect(body).not.toMatch(/\bisr\b/);
  });
});
