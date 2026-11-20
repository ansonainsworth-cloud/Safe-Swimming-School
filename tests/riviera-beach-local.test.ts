import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = new URL('..', import.meta.url).pathname;
const opening = 'Riviera Beach and Singer Island families learn in the pool they already use.';
const localFaqs: Array<[string, string]> = [
  ['Do you teach at home pools on Singer Island and in inland Riviera Beach?', 'Yes. We come to home pools on Singer Island and in inland Riviera Beach, and to community pools in both areas.'],
  ['Can a lesson be at an oceanfront condo pool or a community pool?', 'Yes. On Singer Island, families often use an oceanfront condo pool or a community pool. Inland in Riviera Beach, families often use a home pool or a community or HOA pool. Each lesson is private and 30 minutes, with the same instructor every lesson.'],
  ['Can we schedule lessons around school?', 'Yes. Lessons run every day from 8 AM to 7 PM, so you can book before school, after school, or on a weekend.'],
  ['Do you teach only in Riviera Beach?', 'No. Riviera Beach and Singer Island are examples, not a limit. We teach across Palm Beach County, including West Palm Beach and surrounding areas.'],
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
  'group lessons',
  'Park Plaza',
  'Tequesta Oaks',
  'Tequesta Towers',
  'Barclay',
  'Jupiter Dunes',
  'Island at Abacoa',
  'Harbor Management',
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
    expect(strip(html.match(/<title>([^<]*)<\/title>/)?.[1] || '')).toBe('Survival Swim Lessons in Riviera Beach & Singer Island, FL');
    expect(strip(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] || '')).toBe('Private Swim Lessons in Riviera Beach & Singer Island');
    const article = html.slice(html.indexOf('single-content'), html.indexOf('single-blog-article') > -1 ? html.length : html.lastIndexOf('sidebar'));
    expect(article).toContain(opening);
    const visible = [...article.matchAll(/<p><strong>([\s\S]*?)<\/strong><\/p>\s*<p>([\s\S]*?)<\/p>/g)].map((match) => [strip(match[1]), strip(match[2])]);
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => JSON.parse(match[1]));
    const nodes = blocks.flatMap((block) => (Array.isArray(block['@graph']) ? block['@graph'] : [block]));
    const faq = nodes.find((node) => node['@type'] === 'FAQPage');
    const schema = faq.mainEntity.map((item: { name: string; acceptedAnswer: { text: string } }) => [item.name, item.acceptedAnswer.text]);
    expect(schema.slice(0, 4)).toEqual(localFaqs);
    expect(visible.slice(0, 4)).toEqual(localFaqs);
    expect(schema.filter(([question]) => localFaqs.some(([name]) => name === question))).toEqual(localFaqs);
    expect(schema.at(-5)?.[1]).toContain('two gift certificates');
    expect(schema.at(-3)?.[1]).toBe('Gift certificates expire December 31, 2027.');
    const body = strip(article).toLowerCase();
    expect(body).not.toContain('survival swim lessons');
    for (const phrase of banned) expect(body, phrase).not.toContain(phrase.toLowerCase());
    expect(body).not.toMatch(/\bisr\b/);
  });
});
