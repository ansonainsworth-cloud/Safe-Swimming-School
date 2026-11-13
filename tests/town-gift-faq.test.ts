import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = new URL('..', import.meta.url).pathname;
const pages = [
  '/locations/jupiter/',
  '/locations/jupiter-farms/',
  '/locations/palm-beach-gardens/',
  '/locations/north-palm-beach/',
  '/locations/tequesta/',
  '/locations/palm-beach/',
  '/locations/juno-beach/',
  '/locations/riviera-beach/',
  '/locations/west-palm-beach/',
  '/locations/wellington/',
  '/locations/royal-palm-beach/',
  '/locations/westlake/',
  '/swim-lessons-coral-springs-parkland/',
];
const giftFaqs: Array<[string, string]> = [
  ['Do you offer swim lesson gift certificates?', 'Yes. Safe Swimming School offers two gift certificates for private swim lessons. The holiday gift certificate is 8 private 30-minute lessons for $475, and the 20-lesson gift certificate is 20 private 30-minute lessons for $1,100. The $35 annual registration is waived on both.'],
  ['How much is the holiday swim lesson gift certificate?', 'It is $475 for 8 private 30-minute lessons, and the $35 annual registration is waived. The $475 gift offer ends December 24, 2026.'],
  ['When does a swim lesson gift certificate expire?', 'Gift certificates expire December 31, 2027.'],
  ['How does the recipient schedule lessons?', "The recipient books days and times when they redeem the certificate. Lessons are private 30-minute lessons at the family's home or community pool."],
  ['How do I buy a gift certificate?', 'Pay online with the Pay $475 or Pay $1,100 button on our gift certificate page at /gift-certificates/.'],
];

function strip(value: string) {
  return value
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function visibleFaqs(html: string) {
  const start = html.search(/<h2[^>]*>\s*(?:FAQ|Questions from Palm Beach Families)\s*<\/h2>/);
  expect(start).toBeGreaterThan(-1);
  const after = html.slice(start);
  const next = after.slice(4).search(/<h2\b/);
  const section = next < 0 ? after : after.slice(0, next + 4);
  return [...section.matchAll(/<p><strong>([\s\S]*?)<\/strong><\/p>\s*<p>([\s\S]*?)<\/p>/g)].map((match) => ({
    question: strip(match[1]),
    answer: strip(match[2]),
    answerHtml: match[2],
  }));
}

function schemaFaqs(html: string) {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => JSON.parse(match[1]));
  const nodes = blocks.flatMap((block) => (Array.isArray(block['@graph']) ? block['@graph'] : [block]));
  const faq = nodes.find((node) => node['@type'] === 'FAQPage');
  expect(faq).toBeTruthy();
  return faq.mainEntity.map((item: { name: string; acceptedAnswer: { text: string } }) => ({
    question: item.name,
    answer: item.acceptedAnswer.text,
  }));
}

describe('town gift certificate FAQs', () => {
  it('matches the five gift questions in the visible FAQ and the FAQPage schema on all 13 pages', () => {
    execSync('npm run build', { cwd: root, stdio: 'pipe' });
    expect(pages).toHaveLength(13);
    for (const path of pages) {
      const html = readFileSync(join(root, 'dist', path, 'index.html'), 'utf8');
      const visible = visibleFaqs(html);
      const schema = schemaFaqs(html);
      expect(schema, path).toHaveLength(visible.length);
      const visibleGift = visible.slice(-5).map((item) => [item.question, item.answer]);
      const schemaGift = schema.slice(-5).map((item: { question: string; answer: string }) => [item.question, item.answer]);
      expect(visibleGift, path).toEqual(giftFaqs);
      expect(schemaGift, path).toEqual(giftFaqs);
      const buyHtml = visible.at(-1)!.answerHtml;
      expect(buyHtml, path).toContain('<a href="/gift-certificates/">gift certificate page</a>');
      expect(schema.at(-1)!.answer, path).not.toContain('<');
      const giftText = visibleGift.map((item) => item.join(' ')).join(' ');
      expect(giftText, path).not.toMatch(/Zelle|Venmo|email the gift|email the certificate/i);
    }
    const banned = [
      '$475 for 8 private 30-minute lessons plus the $35 annual registration',
      '$475 including annual registration',
      '8 private 30 minute lessons plus the $35 annual registration',
    ];
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const file = join(dir, name);
        if (statSync(file).isDirectory()) walk(file);
        else if (name.endsWith('.html')) {
          const html = readFileSync(file, 'utf8');
          for (const phrase of banned) if (html.includes(phrase)) hits.push(`${file}: ${phrase}`);
        }
      }
    };
    walk(join(root, 'dist'));
    expect(hits).toEqual([]);
  });
});
