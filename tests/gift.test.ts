import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import Gift from '../src/pages/gift.astro';
import GiftCertificates from '../src/pages/gift-certificates.astro';

describe('gift pay links', () => {
  it('renders the holiday certificate pay link only on /gift-certificates/', async () => {
    const container = await AstroContainer.create();
    const certificates = await container.renderToString(GiftCertificates);
    const gift = await container.renderToString(Gift);

    expect(certificates).toContain('href="https://square.link/u/IiddEmp0"');
    expect(certificates).toContain('aria-label="Pay Holiday gift certificate, $475"');
    expect(certificates).toContain('href="https://square.link/u/RSY4plY8"');
    expect(certificates).toContain('aria-label="Pay 20 lessons, $1,100"');
    expect(certificates).toContain('$475');
    expect(certificates).not.toContain('https://square.link/u/wTx6tPan');
    expect(certificates).not.toContain('https://square.link/u/ZpLS9ENJ');

    expect(gift).toContain('href="https://square.link/u/wTx6tPan"');
    expect(gift).toContain('aria-label="Pay 8 lessons, $520"');
    expect(gift).toContain('href="https://square.link/u/ZpLS9ENJ"');
    expect(gift).toContain('aria-label="Pay 12 lessons, $720"');
    expect(gift).toContain('href="https://square.link/u/RSY4plY8"');
    expect(gift).toContain('aria-label="Pay 20 lessons, $1,100"');
    expect(gift).not.toContain('IiddEmp0');
    expect(gift).not.toContain('$475');
  });
});
