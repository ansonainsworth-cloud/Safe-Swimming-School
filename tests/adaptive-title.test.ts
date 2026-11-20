import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = new URL('..', import.meta.url).pathname;
const title = 'Adaptive Swim Lessons in Palm Beach County | Safe Swimming School';
const description = 'Private adaptive swim lessons in Palm Beach County for children with autism, ADHD, and CP, at your home or community pool. Call or text 561-236-8260.';
const schemaName = 'Adaptive Swim Lessons in Palm Beach County';

function strip(value: string) {
  return value.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

describe('adaptive swim lessons title', () => {
  it('names Palm Beach County in the title, meta, and schema', () => {
    execSync('npm run build', { cwd: root, stdio: 'pipe' });
    const html = readFileSync(join(root, 'dist/adaptive-swim-lessons/index.html'), 'utf8');
    expect(strip(html.match(/<title>([^<]*)<\/title>/)?.[1] || '')).toBe(title);
    expect(html).toContain(`<meta name="description" content="${description}"`);
    expect(html).toContain(`<meta property="og:title" content="${title}"`);
    expect(strip(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] || '')).toBe(schemaName);
    const head = html.slice(0, html.indexOf('<body'));
    expect(head).not.toContain('Jupiter &amp; PBG');
    expect(head).not.toContain('Jupiter & PBG');
    expect(head).not.toContain('Jupiter and PBG');
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => JSON.parse(match[1]));
    const nodes = blocks.flatMap((block) => (Array.isArray(block['@graph']) ? block['@graph'] : [block]));
    expect(nodes.filter((node) => node['@type'] === 'WebPage')[0].name).toBe(schemaName);
    const service = nodes.find((node) => node['@type'] === 'Service');
    expect(service.name).toBe(schemaName);
    expect(service.areaServed.name).toBe('Palm Beach County');
    expect(nodes.some((node) => node['@type'] === 'Review' || node['@type'] === 'AggregateRating')).toBe(false);
  });
});
