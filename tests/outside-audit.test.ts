import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { googleReviews, googleReviewsReady } from '../src/data/google-reviews';
import { browardLimited, serviceTowns } from '../src/data/service-towns';

const root = new URL('..', import.meta.url).pathname;
const required = ['West Palm Beach', 'Wellington', 'Royal Palm Beach', 'Juno Beach'];
const clockNearBroward = /(?:4:15|5:45|9:00|10:45|Tuesday|Thursday|Friday)[\s\S]{0,80}(?:Coral Springs|Parkland)|(?:Coral Springs|Parkland)[\s\S]{0,80}(?:4:15|5:45|9:00|10:45|Tuesday|Thursday|Friday)/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (name.endsWith('.html') || name.endsWith('.txt')) out.push(path);
  }
  return out;
}

describe('outside audit fixes', () => {
  it('shares one open town list, hides an empty Google strip, and drops Broward schedules', () => {
    expect(required.every((name) => serviceTowns.some((town) => town.name === name))).toBe(true);
    expect(googleReviewsReady({ rating: null, count: null, url: null, checkedDate: null })).toBe(false);
    expect(googleReviewsReady({ rating: 4.3, count: null, url: 'https://maps.app.goo.gl/uhvbr4NSqpAEsPSE9', checkedDate: '2026-11-16' })).toBe(false);

    execSync('npm run build', { cwd: root, stdio: 'pipe' });
    const home = readFileSync(join(root, 'dist/index.html'), 'utf8');
    const service = readFileSync(join(root, 'dist/service/index.html'), 'utf8');
    const jupiter = readFileSync(join(root, 'dist/locations/jupiter/index.html'), 'utf8');
    const llms = readFileSync(join(root, 'public/llms.txt'), 'utf8');
    for (const town of serviceTowns) {
      expect(home).toContain(`href="${town.href}"`);
      expect(service).toContain(`href="${town.href}"`);
      expect(llms).toContain(`https://safeswimmingschool.com${town.href}`);
    }
    expect(home).toContain('and surrounding areas');
    expect(home).toContain(browardLimited.line);
    expect(home).not.toMatch(/Jupiter to /);
    expect(home).toContain('class="sss-google-rating"');
    expect(home).toContain('href="https://maps.app.goo.gl/uhvbr4NSqpAEsPSE9"');
    expect(home).toContain('target="_blank"');
    expect(home).toContain('rel="noopener"');
    expect(home).toContain('>4.3 on Google (6 reviews)</a>');
    expect(googleReviews).toEqual({ rating: 4.3, count: 6, url: 'https://maps.app.goo.gl/uhvbr4NSqpAEsPSE9', checkedDate: '2026-11-16' });
    expect(googleReviewsReady()).toBe(true);
    const homeBlocks = [...home.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => JSON.parse(match[1]));
    const homeNodes = homeBlocks.flatMap((block) => (Array.isArray(block['@graph']) ? block['@graph'] : [block]));
    expect(JSON.stringify(homeNodes)).not.toMatch(/AggregateRating|"@type":"Review"/);
    expect(home).toContain('Text 561-236-8260');
    expect(home).toContain('href="/book/">Book</a>');
    expect(home).not.toContain('>Text us</a>');
    expect(home).not.toContain('>info@safeswimmingschool.com<');

    expect(jupiter.match(/<title>([^<]*)<\/title>/)?.[1]).toBe('Private Swim Lessons in Jupiter, FL | Safe Swimming School');
    expect(jupiter).toContain('>Private Swim Lessons in Jupiter, FL<');
    expect(jupiter).toContain('Private swim lessons in Jupiter, FL, at your home pool or community pool.');
    expect(jupiter).toContain('Where can I find toddler swim lessons near Jupiter, FL?');
    const blocks = [...jupiter.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => JSON.parse(match[1]));
    const nodes = blocks.flatMap((block) => (Array.isArray(block['@graph']) ? block['@graph'] : [block]));
    expect(nodes.filter((node) => node['@type'] === 'FAQPage')).toHaveLength(1);

    const hits = [...walk(join(root, 'dist')), join(root, 'public/llms.txt')].filter((path) => clockNearBroward.test(readFileSync(path, 'utf8')));
    expect(hits).toEqual([]);
  });
});
