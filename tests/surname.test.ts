import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = new URL('..', import.meta.url).pathname;

function htmlFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) htmlFiles(path, out);
    else if (name.endsWith('.html')) out.push(path);
  }
  return out;
}

describe('cofounder surname', () => {
  it('uses cofounder Anson Ainsworth in the built pages', () => {
    execSync('npm run build', { cwd: root, stdio: 'pipe' });
    const missing = /co-?founder,?\s+Anson(?! Ainsworth)/i;
    const hits: string[] = [];
    for (const file of htmlFiles(join(root, 'dist'))) {
      const text = readFileSync(file, 'utf8');
      if (missing.test(text)) hits.push(file.slice(root.length));
    }
    expect(hits).toEqual([]);
  });
});
