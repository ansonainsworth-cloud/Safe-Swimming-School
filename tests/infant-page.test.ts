import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = new URL('..', import.meta.url).pathname;
const title = 'Infant Swim Lessons in Palm Beach County | Safe Swimming School';
const description = 'Safe Swimming School teaches private infant swim lessons at your home or community pool across Palm Beach County, including Jupiter, West Palm Beach, and surrounding areas. Lessons start as young as 3 months, with a parent in the water at first, and your instructor comes to you any day from 8 AM to 7 PM.';
const faqs: Array<[string, string]> = [
  ['Do you offer infant swim lessons in Jupiter and the rest of Palm Beach County?', 'Yes. We teach private infant lessons at your home or community pool across Palm Beach County, including Jupiter, West Palm Beach, and surrounding areas. Your instructor comes to you any day from 8 AM to 7 PM.'],
  ['What age can an infant start, and do you teach newborns?', 'We teach swimmers as young as 3 months. We do not start lessons at birth. Talk with your pediatrician about when your baby is ready for the pool. Until then, bath time can help your baby feel calm around water.'],
  ['Does a parent get in the water for infant lessons?', 'Yes. Infant lessons start with a parent in the water, then move to private lessons as your baby grows more comfortable.'],
  ['How long is an infant lesson, and can siblings learn together?', 'Each lesson is private and 30 minutes. Siblings can share a semi-private lesson. Lessons run any day from 8 AM to 7 PM.'],
];

function strip(value: string) {
  return value.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

describe('infant swim lessons page', () => {
  it('sets the title, meta, Service and FAQ schema, and sitemap entry', () => {
    execSync('npm run build', { cwd: root, stdio: 'pipe' });
    const html = readFileSync(join(root, 'dist/infant-swim-lessons-palm-beach-county/index.html'), 'utf8');
    expect(html.match(/<title>([^<]*)<\/title>/)?.[1]).toBe(title);
    expect(html).toContain(`<meta name="description" content="${description}"`);
    expect(html).toContain('rel="canonical" href="https://safeswimmingschool.com/infant-swim-lessons-palm-beach-county/"');
    expect(html).toContain('<h1');
    expect(strip(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] || '')).toBe('Infant swim lessons in Palm Beach County');
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => JSON.parse(match[1]));
    const nodes = blocks.flatMap((block) => (Array.isArray(block['@graph']) ? block['@graph'] : [block]));
    expect(nodes.map((node) => node['@type'])).toEqual(expect.arrayContaining(['WebPage', 'BreadcrumbList', 'Service', 'FAQPage']));
    expect(JSON.stringify(nodes)).not.toMatch(/Review|AggregateRating/);
    const faq = nodes.find((node) => node['@type'] === 'FAQPage');
    const visible = [...html.matchAll(/<p[^>]*>\s*<strong[^>]*>([\s\S]*?)<\/strong><\/p>\s*<p[^>]*>([\s\S]*?)<\/p>/g)].map((match) => [strip(match[1]), strip(match[2])]);
    expect(visible).toEqual(faqs);
    expect(faq.mainEntity.map((item: { name: string; acceptedAnswer: { text: string } }) => [item.name, item.acceptedAnswer.text])).toEqual(faqs);
    const sitemap = readFileSync(join(root, 'dist/sitemap.xml'), 'utf8');
    expect(sitemap).toContain('https://safeswimmingschool.com/infant-swim-lessons-palm-beach-county/');
  });
});
