import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import Books from '../src/pages/books.astro';

const amazon = 'https://www.amazon.com/dp/B0HRG5R6HR';

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'public') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) found.push(...sourceFiles(path));
    else if (/\.(astro|html|js|ts|json|txt|md)$/.test(name)) found.push(path);
  }
  return found;
}

describe('books page', () => {
  it('links the Pearl pack, the $9 bundle, and the Ko-fi shop next to the Amazon paperback', async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(Books);
    expect(html).toContain('href="https://www.amazon.com/dp/B0HRG5R6HR" target="_blank" rel="noopener"');
    expect(html).toContain('>Buy on Amazon</a>');
    expect(html).not.toContain('B0HNP7NKDM');
    expect(html.match(/Buy on Amazon/g)).toEqual(['Buy on Amazon']);
    expect(html).toContain('Bubbles and Wet Eyes');
    expect(html).not.toContain('Find Your Float');
    expect(html).toContain("Pearl's Float Practice printable activity pack");
    expect(html).toContain('A printable companion to The Day I Found My Float.');
    expect(html).toContain('>$4</strong>');
    expect(html).toContain('href="https://ko-fi.com/s/cdb6697f79" target="_blank" rel="noopener"');
    expect(html).toContain('>Get it on Ko-fi</a>');
    expect(html).toContain('href="https://ko-fi.com/safeswimmingschoolbooks/shop" target="_blank" rel="noopener"');
    expect(html).toContain('>See all printables in our Ko-fi shop</a>');
    expect(html).toContain('The Day I Found My Float printable bundle');
    expect(html).toContain("The Book 1 printable PDF plus Pearl's Float Practice activity pack.");
    expect(html).toContain('>$9</strong>');
    expect(html).toContain('href="https://ko-fi.com/s/a1bfdb2d75" target="_blank" rel="noopener"');
    expect(html).toContain('>Get the bundle on Ko-fi</a>');
  });

  it('puts the Buy on Amazon button on every page that names Book 1', () => {
    const root = new URL('..', import.meta.url).pathname;
    const hits = sourceFiles(join(root, 'src')).filter((file) => {
      const text = readFileSync(file, 'utf8');
      return text.includes('The Day I Found My Float') || text.includes('B0HNP7NKDM') || text.includes('B0HRG5R6HR');
    });
    expect(hits.map((file) => file.slice(root.length))).toEqual(['src/pages/books.astro']);
    const page = readFileSync(hits[0], 'utf8');
    expect(page).toContain(`const amazon = '${amazon}'`);
    expect(page).toContain('>Buy on Amazon</a>');
    expect(page).not.toContain('B0HNP7NKDM');
  });
});
