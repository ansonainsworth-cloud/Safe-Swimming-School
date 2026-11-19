import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequest as commentsFeed } from '../functions/comments/feed/[[path]].js';
import { onRequest as houstonGone } from '../functions/houston.html.js';
import { onRequest as pricingFeed } from '../functions/pricing/feed/[[path]].js';
import { onRequest as teamGone } from '../functions/team/[[path]].js';
import Books from '../src/pages/books.astro';
import { showDec31Banner } from '../src/data/dec31-banner';

const banner = 'Packages bought by December 31, 2026 have the registration fee waived, and the lessons never expire.';

afterEach(() => {
  vi.useRealTimers();
});

describe('December 31 package banner', () => {
  it('stays up through Dec 31, 2026 23:59 ET and hides at midnight', () => {
    expect(showDec31Banner(new Date('2026-12-31T23:59:59.000-05:00'))).toBe(true);
    expect(showDec31Banner(new Date('2027-01-01T04:59:59.999Z'))).toBe(true);
    expect(showDec31Banner(new Date('2027-01-01T05:00:00.000Z'))).toBe(false);
    expect(showDec31Banner(new Date('2027-06-01T12:00:00.000Z'))).toBe(false);
  });

  it('renders the banner and pricing link before the date, and omits them after', async () => {
    const container = await AstroContainer.create();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-14T18:00:00.000Z'));
    const shown = await container.renderToString(Books);
    expect(shown).toContain(banner);
    expect(shown).toContain('href="/pricing/"');
    expect(shown).toContain('>See pricing</a>');
    expect(shown).toContain('aria-label="Package registration waiver"');

    vi.setSystemTime(new Date('2027-01-01T05:00:00.000Z'));
    const hidden = await container.renderToString(Books);
    expect(hidden).not.toContain(banner);
    expect(hidden).not.toContain('aria-label="Package registration waiver"');
    expect(hidden).not.toContain('>See pricing</a>');
  });

  it('is not on the 410 responses', async () => {
    for (const respond of [commentsFeed, pricingFeed, houstonGone, teamGone]) {
      const response = respond();
      expect(response.status).toBe(410);
      const text = await response.text();
      expect(text).toBe('Gone');
      expect(text).not.toContain(banner);
    }
  });
});
