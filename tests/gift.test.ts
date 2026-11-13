import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import Gift from '../src/pages/gift.astro';
import GiftCertificates from '../src/pages/gift-certificates.astro';

describe('gift pay links', () => {
  it('renders the holiday certificate pay link only on /gift-certificates/', async () => {
    const container = await AstroContainer.create();
    const certificates = await container.renderToString(GiftCertificates);
    const gift = await container.renderToString(Gift);

    expect(certificates).toContain('href="https://square.link/u/IiddEmp0" aria-label="Pay Holiday gift certificate, $475">Pay $475</a>');
    expect(certificates).toContain('href="https://square.link/u/pNjl7ShA" aria-label="Pay Gift certificate: 12 private lessons, $720">Pay $720</a>');
    expect(certificates).toContain('href="https://square.link/u/sLsPsavs" aria-label="Pay Gift certificate: 20 private lessons, $1,100">Pay $1,100</a>');
    expect(certificates).not.toContain('>Pay</a>');
    expect(certificates).toContain('How much is the 12 lesson gift certificate?');
    expect(certificates).toContain('It is $720. That is 12 private 30 minute lessons. The $35 annual registration is waived. Expires December 31, 2027.');
    expect(certificates).toContain('</strong> 12 private 30 minute lessons. The $35 annual registration is waived. Expires December 31, 2027.');
    expect(certificates).toContain('How much is the 20 lesson gift certificate?');
    expect(certificates).toContain('It is $1,100. That is 20 private 30 minute lessons. The $35 annual registration is waived. Expires December 31, 2027.');
    expect(certificates.match(/December 24, 2026/g)).toHaveLength(3);
    expect(certificates).not.toContain('RSY4plY8');
    expect(certificates).not.toContain('never expire');
    expect(certificates).not.toContain('aria-label="Pay 20 lessons, $1,100"');
    expect(certificates).toContain('</strong> 8 private 30 minute lessons. The $35 annual registration is waived. Expires December 31, 2027. The $475 gift offer ends December 24, 2026.');
    expect(certificates).toContain('It is $475. That is 8 private 30 minute lessons. The $35 annual registration is waived. Expires December 31, 2027. The $475 gift offer ends December 24, 2026.');
    expect(certificates).toContain('$475, and the $35 annual registration is waived.');
    expect(certificates).not.toContain('8 private 30 minute lessons plus the $35 annual registration');
    expect(certificates).not.toContain('$475 including annual registration');
    expect(certificates).toContain('</strong> 20 private 30 minute lessons. The $35 annual registration is waived. Expires December 31, 2027.');
    expect(certificates).not.toContain('20 private 30 minute lessons plus the $35 annual registration');
    expect(certificates).not.toContain('https://square.link/u/wTx6tPan');
    expect(certificates).not.toContain('https://square.link/u/ZpLS9ENJ');
    const strip = (value: string) => value.replace(/<[^>]+>/g, '').replace(/&#39;|&apos;/g, "'").replace(/\s+/g, ' ').trim();
    const faqHtml = certificates.slice(certificates.indexOf('>Questions</h2>'));
    const visible = [...faqHtml.matchAll(/<p[^>]*>\s*<strong[^>]*>([\s\S]*?)<\/strong><\/p>\s*<p[^>]*>([\s\S]*?)<\/p>/g)].map((match) => [strip(match[1]), strip(match[2])]);
    const blocks = [...certificates.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => JSON.parse(match[1]));
    const nodes = blocks.flatMap((block) => (Array.isArray(block['@graph']) ? block['@graph'] : [block]));
    const schema = nodes.find((node) => node['@type'] === 'FAQPage').mainEntity.map((item: { name: string; acceptedAnswer: { text: string } }) => [item.name, item.acceptedAnswer.text]);
    expect(visible).toEqual(schema);
    expect(visible.map((item) => item[0])).toContain('How much is the 12 lesson gift certificate?');

    expect(gift).toContain('href="https://square.link/u/wTx6tPan"');
    expect(gift).toContain('aria-label="Pay 8 lessons, $520"');
    expect(gift).toContain('href="https://square.link/u/ZpLS9ENJ"');
    expect(gift).toContain('aria-label="Pay 12 lessons, $720"');
    expect(gift).toContain('href="https://square.link/u/RSY4plY8"');
    expect(gift).toContain('aria-label="Pay 20 lessons, $1,100">Pay</a>');
    expect(gift).not.toContain('IiddEmp0');
    expect(gift).not.toContain('sLsPsavs');
    expect(gift).not.toContain('pNjl7ShA');
    expect(gift).not.toContain('$475');
  });
});
