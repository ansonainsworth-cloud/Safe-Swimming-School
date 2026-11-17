import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = new URL('..', import.meta.url).pathname;
const path = '/what-a-survival-swim-lesson-looks-like-for-babies-and-toddlers/';
const title = 'Baby and Toddler Swim Lessons: What to Expect';
const description = 'See what a baby or toddler swim lesson looks like at your home pool in Palm Beach County: the skills, the 30 minute format, and how parents take part.';
const headline = 'What a Swim Lesson for Babies and Toddlers Looks Like';
const hero = 'https://safeswimmingschool.com/images/blog/baby-toddler-lesson/hero-1280.jpg';

function strip(value: string) {
  return value.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

describe('baby and toddler lesson post', () => {
  it('builds the post, lists it, and links it from the infant page', () => {
    execSync('npm run build', { cwd: root, stdio: 'pipe' });
    const html = readFileSync(join(root, 'dist/what-a-survival-swim-lesson-looks-like-for-babies-and-toddlers/index.html'), 'utf8');
    expect(html.match(/<title>([^<]*)<\/title>/)?.[1]).toBe(title);
    expect(html).toContain(`<meta name="description" content="${description}"`);
    expect(html).toContain(`rel="canonical" href="https://safeswimmingschool.com${path}"`);
    expect(html).toContain(`<meta property="og:title" content="${title}"`);
    expect(html).toContain(`<meta property="og:description" content="${description}"`);
    expect(html).toContain(`<meta property="og:image" content="${hero}"`);
    expect(strip(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] || '')).toBe(headline);
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => JSON.parse(match[1]));
    const nodes = blocks.flatMap((block) => (Array.isArray(block['@graph']) ? block['@graph'] : [block]));
    const posting = nodes.find((node) => node['@type'] === 'BlogPosting');
    expect(posting.headline).toBe(headline);
    expect(posting.description).toBe(description);
    expect(posting.image).toBe(hero);
    expect(posting.datePublished).toBe('2026-11-17');
    expect(posting.dateModified).toBe('2026-11-17');
    expect(posting.mainEntityOfPage).toBe(`https://safeswimmingschool.com${path}`);
    expect(posting.author).toMatchObject({ '@type': 'Organization', name: 'Safe Swimming School' });
    expect(posting.publisher).toMatchObject({ '@type': 'Organization', name: 'Safe Swimming School' });
    expect(nodes.filter((node) => node['@type'] === 'BreadcrumbList')).toHaveLength(1);
    expect(nodes.map((node) => node['@type'])).toEqual(['BlogPosting', 'WebPage', 'BreadcrumbList']);
    expect(html).toContain('href="/infant-swim-lessons-palm-beach-county/"');
    expect(html).toContain('href="/survival-swim-lessons-palm-beach-county/"');
    expect(html).toContain('href="/pricing/"');
    expect(html).toContain('href="/locations/"');
    expect(html).toContain('href="/contact-us/"');
    expect(html).toContain('href="sms:+15612368260"');
    expect(html.match(/survival swim lessons/g)).toHaveLength(1);
    expect(html).toContain('fetchpriority="high"');
    expect(html).toContain('loading="lazy"');
    const sitemap = readFileSync(join(root, 'dist/sitemap.xml'), 'utf8');
    expect(sitemap.split(path).length - 1).toBe(1);
    const blog = readFileSync(join(root, 'dist/blog/index.html'), 'utf8');
    const category = readFileSync(join(root, 'dist/category/swim-tips/index.html'), 'utf8');
    expect(blog.indexOf(path)).toBeGreaterThan(-1);
    expect(blog.indexOf(path)).toBeLessThan(blog.indexOf('/5-things-every-parent-must-know-before-their-childs-first-swim-lesson/'));
    expect(category.indexOf(path)).toBeLessThan(category.indexOf('/5-things-every-parent-must-know-before-their-childs-first-swim-lesson/'));
    expect(blog).toContain('November 17, 2026');
    const infant = readFileSync(join(root, 'dist/infant-swim-lessons-palm-beach-county/index.html'), 'utf8');
    expect(infant).toContain(`Curious what a lesson looks like? Read <a href="${path}"`);
    expect(infant).toContain('>what a swim lesson for babies and toddlers looks like</a>');
  });
});
