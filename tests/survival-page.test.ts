import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = new URL('..', import.meta.url).pathname;
const title = 'Survival Swim Lessons in Palm Beach County';
const description = 'Private lessons at your home or community pool in Palm Beach County. Start with roll to back, float and rest, and swim to the wall. Text 561-236-8260.';
const faqs: Array<[string, string]> = [
  ['What skills do the lessons teach?', 'Swimmers practice how to roll to back, float and rest, and swim to the wall, then work on strokes. These skills are one layer of protection. Nothing replaces adult supervision and pool barriers.'],
  ['How young can a child start?', 'We teach swimmers as young as 3 months. Infant lessons start with a parent in the water, then move to private lessons.'],
  ['Do you come to my house?', 'Yes. Your instructor comes to your home or community pool across Palm Beach County, including West Palm Beach and surrounding areas, any day from 8 AM to 7 PM.'],
];

function strip(value: string) {
  return value.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

describe('survival swim lessons page', () => {
  it('sets the title, meta, Service and FAQ schema, and sitemap entry', () => {
    execSync('npm run build', { cwd: root, stdio: 'pipe' });
    const html = readFileSync(join(root, 'dist/survival-swim-lessons-palm-beach-county/index.html'), 'utf8');
    expect(html.match(/<title>([^<]*)<\/title>/)?.[1]).toBe(title);
    expect(html).toContain(`<meta name="description" content="${description}"`);
    expect(html).toContain('rel="canonical" href="https://safeswimmingschool.com/survival-swim-lessons-palm-beach-county/"');
    expect(strip(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] || '')).toBe('Survival swim lessons in Palm Beach County');
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => JSON.parse(match[1]));
    const nodes = blocks.flatMap((block) => (Array.isArray(block['@graph']) ? block['@graph'] : [block]));
    expect(nodes.filter((node) => node['@type'] === 'FAQPage')).toHaveLength(1);
    expect(nodes.map((node) => node['@type'])).toEqual(expect.arrayContaining(['WebPage', 'BreadcrumbList', 'Service', 'FAQPage']));
    const service = nodes.find((node) => node['@type'] === 'Service');
    expect(service.url).toBe('https://safeswimmingschool.com/survival-swim-lessons-palm-beach-county/');
    expect(service.description).toBe(description);
    expect(service.name).toBe('Survival swim lessons in Palm Beach County');
    expect(JSON.stringify(nodes)).not.toMatch(/Review|AggregateRating/);
    expect(html).toContain('Safe Swimming School teaches private lessons at your home or community pool across Palm Beach County, including West Palm Beach and surrounding areas.');
    expect(html).not.toContain('teaches private survival swim lessons');
    expect(html).toContain('href="/locations/palm-beach/"');
    expect(html).toContain('>Palm Beach</a>');
    expect(html).toContain('href="/adult-swim-lessons-palm-beach-county/"');
    expect(html).toContain('>Adult swim lessons</a>');
    const palm = readFileSync(join(root, 'dist/locations/palm-beach/index.html'), 'utf8');
    expect(palm.match(/<title>([^<]*)<\/title>/)?.[1]).toBe('Private Swim Lessons in Palm Beach | Safe Swimming School');
    expect(palm).toContain('Private 30 minute swim lessons at your home pool in the town of Palm Beach.');
    expect(palm).toContain('For how our lessons work across Palm Beach County, including the skills we practice, see our <a href="/survival-swim-lessons-palm-beach-county/">survival swim lessons</a> page.');
    const faq = nodes.find((node) => node['@type'] === 'FAQPage');
    const visible = [...html.matchAll(/<p[^>]*>\s*<strong[^>]*>([\s\S]*?)<\/strong><\/p>\s*<p[^>]*>([\s\S]*?)<\/p>/g)].map((match) => [strip(match[1]), strip(match[2])]);
    expect(visible).toEqual(faqs);
    expect(faq.mainEntity).toHaveLength(3);
    expect(faq.mainEntity.map((item: { name: string; acceptedAnswer: { text: string } }) => [item.name, item.acceptedAnswer.text])).toEqual(faqs);
    const sitemap = readFileSync(join(root, 'dist/sitemap.xml'), 'utf8');
    expect(sitemap).toContain('https://safeswimmingschool.com/survival-swim-lessons-palm-beach-county/');
    expect(html).not.toMatch(/\bISR\b/);
    expect(html).not.toContain('self-rescue');
  });
});
