import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import Books from '../src/pages/books.astro';

describe('books page', () => {
  it('links the Pearl pack and the Ko-fi shop next to the Amazon paperback', async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(Books);
    expect(html).toContain('href="https://www.amazon.com/dp/B0HNP7NKDM" target="_blank" rel="noopener"');
    expect(html).toContain('>Get it on Amazon →</a>');
    expect(html).toContain("Pearl's Float Practice printable activity pack");
    expect(html).toContain('A printable companion to The Day I Found My Float.');
    expect(html).toContain('>$4</strong>');
    expect(html).toContain('href="https://ko-fi.com/s/cdb6697f79" target="_blank" rel="noopener"');
    expect(html).toContain('>Get it on Ko-fi</a>');
    expect(html).toContain('href="https://ko-fi.com/safeswimmingschoolbooks/shop" target="_blank" rel="noopener"');
    expect(html).toContain('>See all printables in our Ko-fi shop</a>');
    expect(html).not.toContain('$9');
  });
});
