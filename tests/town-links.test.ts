import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('..', import.meta.url).pathname;
const hubs = [
  '/infant-swim-lessons-palm-beach-county/',
  '/survival-swim-lessons-palm-beach-county/',
  '/adult-swim-lessons-palm-beach-county/',
  '/adaptive-swim-lessons/',
  '/locations/',
];
const pbcTowns = [
  '/locations/jupiter/',
  '/locations/jupiter-farms/',
  '/locations/palm-beach-gardens/',
  '/locations/north-palm-beach/',
  '/locations/tequesta/',
  '/locations/juno-beach/',
  '/locations/westlake/',
  '/locations/riviera-beach/',
  '/locations/west-palm-beach/',
  '/locations/palm-beach/',
  '/locations/wellington/',
  '/locations/royal-palm-beach/',
];
const pages: Record<string, string[]> = {
  'src/content/pages/locations_tequesta.html': ['/locations/jupiter/', '/locations/jupiter-farms/', '/locations/juno-beach/', '/locations/north-palm-beach/'],
  'src/content/pages/locations_jupiter.html': ['/locations/tequesta/', '/locations/jupiter-farms/', '/locations/juno-beach/', '/locations/palm-beach-gardens/'],
  'src/content/pages/locations_jupiter-farms.html': ['/locations/jupiter/', '/locations/tequesta/', '/locations/palm-beach-gardens/', '/locations/westlake/'],
  'src/content/pages/locations_north-palm-beach.html': ['/locations/juno-beach/', '/locations/palm-beach-gardens/', '/locations/riviera-beach/', '/locations/west-palm-beach/'],
  'src/content/pages/locations_palm-beach-gardens.html': ['/locations/jupiter/', '/locations/juno-beach/', '/locations/north-palm-beach/', '/locations/riviera-beach/'],
  'src/content/pages/locations_westlake.html': ['/locations/palm-beach-gardens/', '/locations/royal-palm-beach/', '/locations/wellington/', '/locations/jupiter-farms/'],
  'src/content/pages/locations_palm-beach.html': ['/locations/west-palm-beach/', '/locations/riviera-beach/', '/locations/north-palm-beach/'],
  'src/content/pages/locations_royal-palm-beach.html': ['/locations/wellington/', '/locations/westlake/', '/locations/west-palm-beach/'],
  'src/content/pages/locations_wellington.html': ['/locations/royal-palm-beach/', '/locations/westlake/', '/locations/west-palm-beach/'],
};

function read(file: string) {
  return readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
}

describe('town page links', () => {
  it('adds the mapped neighbors and hubs without linking Palm Beach County to Coral Springs', () => {
    for (const [file, neighbors] of Object.entries(pages)) {
      const html = read(file);
      for (const href of [...neighbors, ...hubs]) expect(html, `${file} ${href}`).toContain(`href="${href}"`);
      expect(html, file).not.toContain('href="/swim-lessons-coral-springs-parkland/"');
    }
    const broward = read('src/pages/swim-lessons-coral-springs-parkland.astro');
    for (const href of hubs) expect(broward, href).toContain(`href="${href}"`);
    for (const href of pbcTowns) expect(broward, href).not.toContain(`href="${href}"`);
    expect(broward).toContain('nearby Broward towns. Wellington and Royal Palm Beach are examples. <a href="/locations/">All locations</a>.');
    expect(broward.match(/href="\/locations\/"/g)).toEqual(['href="/locations/"']);
    expect(broward).not.toContain('>Wellington</a>');
    expect(broward).not.toContain('>Royal Palm Beach</a>');
  });
});
