import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pages = JSON.parse(readFileSync(new URL('../src/data/migrated-pages.json', import.meta.url), 'utf8')) as Array<{
  path: string;
  title: string;
  description: string;
}>;
const layout = readFileSync(new URL('../src/layouts/Base.astro', import.meta.url), 'utf8');

function page(path: string) {
  const found = pages.find((item) => item.path === path);
  if (!found) throw new Error(`missing ${path}`);
  return found;
}

describe('title and meta descriptions', () => {
  it('sets the homepage, Jupiter, and locations head copy', () => {
    expect(page('/').title).toBe('Private Swim Lessons in Palm Beach County | Safe Swimming School');
    expect(page('/').description).toBe('Private home pool swim lessons in Palm Beach County, at your home or community pool. 30-minute one-on-one lessons, 8 AM to 7 PM. Text 561-236-8260.');
    expect(page('/locations/jupiter/').title).toBe('Survival Swim Lessons in Jupiter, FL | Safe Swimming School');
    expect(page('/locations/jupiter/').description).toBe('Swim lessons in Jupiter, FL at your home or community pool. Private 30-minute lessons, same instructor every time. Packages from $520. Text 561-236-8260.');
    expect(page('/locations/').title).toBe('Palm Beach County Areas We Serve | Safe Swimming School');
    expect(page('/locations/').description).toBe('Private lessons at your pool across Palm Beach County, including West Palm Beach, Jupiter, Wellington and nearby towns. Text 561-236-8260.');
    expect(layout).toContain('<meta property="og:title" content={title} />');
    expect(layout).toContain('<meta property="og:description" content={description} />');
  });
});
