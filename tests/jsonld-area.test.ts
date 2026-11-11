import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const oldLimit = 'Listed towns are examples, not a limit.';
const openCounty = 'Listed towns are examples of where we teach throughout Palm Beach County, not a full list.';

type Json = null | string | number | boolean | Json[] | { [key: string]: Json };

function walk(node: Json, visit: (record: { [key: string]: Json }) => void) {
  if (Array.isArray(node)) {
    node.forEach((item) => walk(item, visit));
    return;
  }
  if (!node || typeof node !== 'object') return;
  visit(node);
  Object.values(node).forEach((value) => walk(value, visit));
}

describe('JSON-LD service area', () => {
  const pages = JSON.parse(readFileSync(new URL('../src/data/migrated-pages.json', import.meta.url), 'utf8')) as Array<{
    slug: string;
    ldjson?: string[];
  }>;

  it('parses every block and describes Palm Beach County as open ended', () => {
    const descriptions: string[] = [];
    for (const page of pages) {
      for (const block of page.ldjson ?? []) {
        const data = JSON.parse(block) as Json;
        expect(block).not.toContain(oldLimit);
        walk(data, (record) => {
          expect(record['@type']).not.toBe('Review');
          expect(record['@type']).not.toBe('AggregateRating');
          if (record['@type'] === 'AdministrativeArea' && record.name === 'Palm Beach County' && typeof record.description === 'string') {
            descriptions.push(record.description);
          }
        });
      }
    }
    expect(descriptions).toHaveLength(24);
    for (const description of descriptions) {
      expect(description).toContain('Palm Beach County, including West Palm Beach and surrounding areas.');
      expect(description).toContain(openCounty);
      expect(description).not.toContain(oldLimit);
    }
  });

  it('keeps Coral Springs and Parkland in Broward with limited availability and no lesson hours', () => {
    const source = readFileSync(new URL('../src/pages/swim-lessons-coral-springs-parkland.astro', import.meta.url), 'utf8');
    expect(source).toContain("name: 'Broward County'");
    expect(source).toContain('areaServed: [broward, city(\'Coral Springs\', broward), city(\'Parkland\', broward)]');
    expect(source).toContain('Limited availability');
    expect(source).not.toContain('openingHours');
    expect(source).not.toContain(oldLimit);
  });
});
