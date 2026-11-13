import { readFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import WinterBreak from '../src/pages/winter-break-swim-lessons.astro';

const path = '/winter-break-swim-lessons/';
const title = 'Winter Break Swim Lessons in Palm Beach County | Safe Swimming School';
const faqs = [
  ['Where do winter break swim lessons happen?', 'At your home pool or community pool across Palm Beach County, including West Palm Beach and surrounding areas. Town pages are examples, not a limit.'],
  ['How long is a lesson, and is it one-on-one?', 'Every lesson is private and one-on-one, and each one is 30 minutes. You have the same instructor every lesson.'],
  ['How young can a child start?', 'We teach children as young as 3 months. Infants begin with a parent in the water.'],
  ['How much do winter break swim lessons cost?', 'A single lesson is $75. Packages are 8 lessons for $520, 12 for $720, or 20 for $1,100. Siblings share one package. Annual registration is $35 for one swimmer, $50 for two siblings, and $60 for a family with three or more swimmers. Annual registration is waived on packages bought by December 31, 2026, and those package lessons never expire.'],
  ['How do we book days and times?', 'Families book days and times. Book online or text 561-236-8260.'],
];

function strip(value: string) {
  return value.replace(/<[^>]+>/g, '').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

describe('winter break swim lessons', () => {
  it('builds one page with matching FAQ schema, site prices, and no banned claims', async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(WinterBreak);
    const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)].map((match) => strip(match[1]));
    expect(h1s).toEqual(['Winter break swim lessons in Palm Beach County']);
    expect(html).toContain(`<title>${title}</title>`);
    expect(html).toContain('Private 30 minute swim lessons at your home or community pool in Palm Beach County, including West Palm Beach. Packages from $520. Text 561-236-8260.');
    expect(html).toContain(`<link rel="canonical" href="https://safeswimmingschool.com${path}"`);
    expect(html).toContain(`<meta property="og:title" content="${title}"`);
    expect(html).toContain('content="https://safeswimmingschool.com/winter-break-swim-lessons/"');
    expect(html).toContain('class="sss-btn" href="/book/"');
    expect(html).toContain('>Book online</a>');
    expect(html).toContain('href="sms:+15612368260"');
    expect(html).toContain('href="/gift-certificates/"');
    expect(html).toContain('$75');
    expect(html).toContain('8 lessons for $520');
    expect(html).toContain('12 lessons for $720');
    expect(html).toContain('20 lessons for $1,100');
    expect(html).toContain('$35 for one swimmer, $50 for two siblings, and $60 for a family with three or more swimmers');
    expect(html).toContain('/wp-content/uploads/2020/06/swim1.jpg');

    const visible = [...html.matchAll(/<p[^>]*>\s*<strong[^>]*>([\s\S]*?)<\/strong><\/p>\s*<p[^>]*>([\s\S]*?)<\/p>/g)].map((match) => [strip(match[1]), strip(match[2])]);
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => JSON.parse(match[1]));
    const nodes = blocks.flatMap((block) => (Array.isArray(block['@graph']) ? block['@graph'] : [block]));
    const faq = nodes.find((node) => node['@type'] === 'FAQPage');
    const schema = faq.mainEntity.map((item: { name: string; acceptedAnswer: { text: string } }) => [item.name, item.acceptedAnswer.text]);
    expect(visible).toEqual(faqs);
    expect(schema).toEqual(faqs);
    expect(JSON.stringify(nodes)).not.toMatch(/Review|AggregateRating/);

    const banned = [/lifesaving/i, /drowning/i, /critical survival skill/i, /\bany day\b/i, /\bevery day\b/i, /find your float/i, /\bFLOAT\b/, /\bhum\b/i, /[—–]/];
    for (const pattern of banned) expect(html).not.toMatch(pattern);

    const nav = readFileSync(new URL('../src/data/site.js', import.meta.url), 'utf8');
    expect(nav).not.toContain(path);
    const sitemap = readFileSync(new URL('../src/pages/sitemap.xml.js', import.meta.url), 'utf8');
    expect(sitemap).toContain("'/winter-break-swim-lessons/'");
  });
});
