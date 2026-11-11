import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = new URL('..', import.meta.url).pathname;
const title = 'Home Swim Lessons, Palm Beach County | Safe Swimming School';
const description = 'Home swim lessons and in-home swim lessons at your pool in Palm Beach County. Private, 30 minutes, one-on-one, same instructor. Text 561-236-8260.';
const h1 = 'Home swim lessons at your pool in Palm Beach County';
const faqs: Array<[string, string]> = [
  ['Do you come to my home pool?', 'Yes. We teach private, one-on-one lessons at your home pool or community pool across Palm Beach County, including West Palm Beach and surrounding areas.'],
  ['How long is a lesson, and is it one-on-one?', 'Every lesson is private and 30 minutes long, with one instructor and one swimmer. You have the same instructor every lesson. Siblings can share a semi-private lesson at the same per-lesson price.'],
  ['What does my family need to have ready?', "You need access to a home pool or a community pool. Text 561-236-8260 with the swimmer's age, your city or neighborhood, your pool access, your main goal, and your best days and times."],
  ['How much do home swim lessons cost?', 'Packages are 8 lessons for $520, 12 lessons for $720, or 20 lessons for $1,100, plus annual registration of $35 for one swimmer, $50 for two siblings, and $60 for a family with three or more swimmers. A single lesson is $75 and can be credited toward a package. Annual registration is waived on lock-in packages bought by December 31, 2026, and those lessons never expire.'],
  ['How do I book in-home swim lessons?', 'Text or call 561-236-8260, or complete the form on our Enroll page. Lessons are scheduled from 8 AM to 7 PM daily.'],
];

function meta(html: string, attr: string, key: string): string {
  const match = html.match(new RegExp(`<meta ${attr}="${key}" content="([^"]*)"`));
  if (!match) throw new Error(`missing ${key}`);
  return match[1];
}

function resolves(href: string): boolean {
  const path = href.split('#')[0].split('?')[0];
  const rel = path.replace(/^\//, '');
  const dist = join(root, 'dist');
  const candidates = [join(dist, rel), join(dist, rel, 'index.html')];
  if (rel.endsWith('/')) candidates.push(join(dist, rel, 'index.html'));
  if (rel.endsWith('.html')) candidates.push(join(dist, dirname(rel), 'index.html'));
  return candidates.some((file) => existsSync(file));
}

describe('home swim lessons page', () => {
  it('sets the title, meta, one H1, FAQ schema, and working internal links', () => {
    execSync('npm run build', { cwd: root, stdio: 'pipe' });
    const html = readFileSync(join(root, 'dist/service/index.html'), 'utf8');
    expect(html.match(/<title>([^<]*)<\/title>/)?.[1]).toBe(title);
    expect(meta(html, 'name', 'description')).toBe(description);
    expect(meta(html, 'property', 'og:title')).toBe(title);
    expect(meta(html, 'property', 'og:description')).toBe(description);
    const headings = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)].map((match) => match[1].replace(/<[^>]+>/g, '').trim());
    expect(headings).toEqual([h1]);

    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => JSON.parse(match[1]));
    const flat = blocks.flatMap((block) => (Array.isArray(block['@graph']) ? block['@graph'] : [block]));
    const faq = flat.find((node) => node['@type'] === 'FAQPage');
    expect(faq.mainEntity.map((item: { name: string; acceptedAnswer: { text: string } }) => [item.name, item.acceptedAnswer.text])).toEqual(faqs);
    const visible = [...html.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>\s*<p>([\s\S]*?)<\/p>/g)].map((match) => [match[1].replace(/<[^>]+>/g, '').trim(), match[2].replace(/<[^>]+>/g, '').trim()]);
    expect(visible).toEqual(faqs);
    const page = flat.find((node) => node['@type'] === 'WebPage');
    expect(page.name).toBe(title);
    expect(page.description).toBe(description);
    expect(JSON.stringify(flat)).not.toMatch(/Review|AggregateRating/);

    const article = html.slice(html.indexOf('<article id="single-blocks"'), html.indexOf('</article>'));
    const hrefs = [...article.matchAll(/href="([^"]+)"/g)].map((match) => match[1]).filter((href) => href.startsWith('/') && !href.startsWith('//'));
    const missing = [...new Set(hrefs.filter((href) => !resolves(href)))];
    expect(missing).toEqual([]);
    expect(hrefs).toEqual(expect.arrayContaining([
      '/enroll/',
      '/pricing/',
      '/gift/',
      '/locations/',
      '/locations/jupiter/',
      '/locations/wellington/',
      '/locations/royal-palm-beach/',
      '/locations/palm-beach-gardens/',
      '/locations/north-palm-beach/',
      '/locations/tequesta/',
      '/locations/juno-beach/',
      '/locations/west-palm-beach/',
    ]));
    expect(html).toContain('/wp-content/uploads/2020/06/cs4.jpg');
  });
});
