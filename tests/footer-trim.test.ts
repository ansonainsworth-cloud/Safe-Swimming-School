import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('..', import.meta.url).pathname;
const founderParagraph = 'Safe Swimming School was founded by Cortney Berry, who has 20 years of experience. Cofounder Anson Ainsworth has 18 years of experience';
const serviceParagraph = 'Private in-home swim lessons across Palm Beach County and surrounding areas, West Palm Beach families welcome.';

function footer(path: string): string {
  const html = readFileSync(new URL(path, import.meta.url), 'utf8');
  const start = html.indexOf('<footer id="footer-builder"');
  const end = html.indexOf('</footer>', start);
  expect(start).toBeGreaterThan(-1);
  return html.slice(start, end);
}

function bookColumn(footerHtml: string): string {
  const start = footerHtml.indexOf('Book a lesson');
  const end = footerHtml.indexOf('footer-middle', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return footerHtml.slice(start, end);
}

describe('footer trim', () => {
  it('drops the duplicate book-column copy, plain-text social links, and the dangling copyright and', () => {
    execSync('npm run build', { cwd: root, stdio: 'pipe' });
    for (const page of ['../dist/index.html', '../dist/pricing/index.html']) {
      const html = footer(page);
      const book = bookColumn(html);
      expect(book).not.toContain(founderParagraph);
      expect(book).not.toContain(serviceParagraph);
      expect(book).toContain('Book online');
      expect(book).toContain('561-236-8260');
      expect(html).not.toContain('>Facebook</a>');
      expect(html).not.toContain('>TikTok</a>');
      expect(html).toContain('si-5.png');
      expect(html).toContain('si-tiktok.png');
      expect(html).toContain('https://www.facebook.com/safeswimmingschool');
      expect(html).toContain('https://www.tiktok.com/@safe.swimming.sch');
      expect(html).toContain('info@safeswimmingschool.com');
      expect(html).toContain('>Safe Swimming School</h2>');
      const copyright = html.slice(html.indexOf('copyright-text'), html.indexOf('</p>', html.indexOf('copyright-text')));
      expect(copyright).toContain('All Rights Reserved');
      expect(copyright).not.toMatch(/\band\b/);
    }
  });
});
