import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = new URL('..', import.meta.url).pathname;
const title = "Adult Swim Lessons: It's Never Too Late | Safe Swimming School";
const description = 'Never learned to swim? Private adult swim lessons at your home or community pool across Palm Beach County. Patient, judgment-free. Text 561-236-8260.';
const faqs: Array<[string, string]> = [
  ['Do you teach adult beginners and nervous swimmers?', 'Yes. We teach private, one-on-one adult lessons at your home or community pool for beginners, nervous swimmers, and adults who want to rebuild skills. Lessons move at your pace, starting with water comfort and breathing.'],
  ['Can I try one adult lesson before buying a package?', 'Yes. A single lesson is $75, and it can be credited toward a package. Packages are 8 lessons for $520, 12 for $720, or 20 for $1,100, plus annual registration of $35 for one swimmer, $50 for two, or $60 for three or more. Annual registration is waived on lock in packages bought by December 31, 2026.'],
  ['Can you keep my lessons private?', 'Yes. Lessons are one-on-one at your home or community pool, and we are happy to sign an NDA on request.'],
  ['When and where are adult lessons?', 'Your instructor comes to your home or community pool across Palm Beach County, including West Palm Beach and surrounding areas, any day from 8 AM to 7 PM.'],
];

function strip(value: string) {
  return value.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

describe('adult swim lessons page rewrite', () => {
  it('replaces the body and adds an FAQPage without changing the title or meta', () => {
    execSync('npm run build', { cwd: root, stdio: 'pipe' });
    const html = readFileSync(join(root, 'dist/adult-swim-lessons-palm-beach-county/index.html'), 'utf8');
    expect(html.match(/<title>([^<]*)<\/title>/)?.[1].replace(/&#39;/g, "'")).toBe(title);
    expect(html).toContain(`<meta name="description" content="${description}"`);
    expect(html).toContain('rel="canonical" href="https://safeswimmingschool.com/adult-swim-lessons-palm-beach-county/"');
    expect(strip(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] || '')).toBe('Adult swim lessons in Palm Beach County');
    expect(html).not.toContain('No crowded lap lanes');
    expect(html).not.toContain('No kids watching');
    const body = html.match(/<div class="single-blog-content entry clr" itemprop="text">([\s\S]*?)<\/div>/)?.[1] || '';
    const bodyLinks = [...body.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
    expect(bodyLinks).toEqual(['/locations/']);
    const visible = [...body.matchAll(/<p>\s*<strong>([\s\S]*?)<\/strong><\/p>\s*<p>([\s\S]*?)<\/p>/g)].map((match) => [strip(match[1]), strip(match[2])]);
    expect(visible).toEqual(faqs);
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => JSON.parse(match[1]));
    const nodes = blocks.flatMap((block) => (Array.isArray(block['@graph']) ? block['@graph'] : [block]));
    expect(nodes.map((node) => node['@type'])).toEqual(expect.arrayContaining(['Article', 'WebPage', 'BreadcrumbList', 'WebSite', 'Organization', 'Person', 'LocalBusiness', 'FAQPage']));
    expect(JSON.stringify(nodes)).not.toMatch(/Review|AggregateRating/);
    const faqPages = nodes.filter((node) => node['@type'] === 'FAQPage');
    expect(faqPages).toHaveLength(1);
    expect(faqPages[0].mainEntity.map((item: { name: string; acceptedAnswer: { text: string } }) => [item.name, item.acceptedAnswer.text])).toEqual(faqs);
    const sitemap = readFileSync(join(root, 'dist/sitemap.xml'), 'utf8');
    expect(sitemap.match(/adult-swim-lessons-palm-beach-county/g)).toHaveLength(1);
  });
});
