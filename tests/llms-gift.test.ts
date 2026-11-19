import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('llms.txt gift certificates', () => {
  it('mentions both certificate prices and the gift certificate page', () => {
    const text = readFileSync(new URL('../public/llms.txt', import.meta.url), 'utf8');
    expect(text).toContain('https://safeswimmingschool.com/gift-certificates/');
    expect(text).toContain('https://safeswimmingschool.com/infant-swim-lessons-palm-beach-county/');
    expect(text).toContain('https://safeswimmingschool.com/survival-swim-lessons-palm-beach-county/');
    expect(text).toContain('https://safeswimmingschool.com/adult-swim-lessons-palm-beach-county/');
    expect(text).toContain('$475 for 8 private 30-minute lessons');
    expect(text).toContain('$1,100 for 20 private 30-minute lessons');
    expect(text).toContain('the $35 annual registration is waived');
    expect(text).toContain('the $475 offer ends December 24, 2026');
    expect(text).toContain('good through December 31, 2027. Offer ends December 31, 2026.');
    expect(text).not.toContain('$1,100 offer ends');
  });
});
