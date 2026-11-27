import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import Landing from '../src/pages/parent-playbooks/index.astro';
import Thanks from '../src/pages/parent-playbooks/thank-you.astro';
import { PARENT_PLAYBOOKS_TALLY_ID } from '../src/data/parent-playbooks';

const root = new URL('..', import.meta.url).pathname;

function article(html: string) {
  const match = html.match(/<article[\s\S]*<\/article>/);
  if (!match) throw new Error('missing article');
  return match[0];
}

function schemas(html: string) {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => JSON.parse(match[1]));
}

describe('parent playbooks', () => {
  it('renders the landing page and the noindex thank-you page without banned copy', async () => {
    expect(PARENT_PLAYBOOKS_TALLY_ID).toBe('');
    const container = await AstroContainer.create();
    const landing = await container.renderToString(Landing);
    const thanks = await container.renderToString(Thanks);
    const landingArticle = article(landing);
    const thanksArticle = article(thanks);

    expect(landing).toContain('<title>Get the Parent Playbooks | Safe Swimming School</title>');
    expect(landing).toContain('Get the Parent Playbooks for free');
    expect(landing).toContain('I have taught survival swim in home pools across Palm Beach County since 2009.');
    expect(landing).toContain('Form placeholder.');
    expect(landing.match(/Form placeholder\./g)).toHaveLength(2);
    expect(landing).toContain('rel="canonical" href="https://safeswimmingschool.com/parent-playbooks/"');
    expect(landing).toContain('googletagmanager.com/gtag/js');
    expect(thanks).toContain('noindex');
    expect(thanks).toContain('The library is on its way by email.');
    expect(thanks).toContain('Trust Before Technique');
    expect(thanks).toContain('Video link: TODO');
    expect(thanks).toContain('Calendar link: TODO');
    expect(thanksArticle).not.toContain('<img');
    const thanksSource = readFileSync(join(root, 'src/pages/parent-playbooks/thank-you.astro'), 'utf8');
    expect(thanksSource).toContain('TODO: hero image');
    expect(thanksSource).toContain('Video link: TODO');
    expect(thanksSource).toContain('Calendar link: TODO');

    for (const html of [landing, thanks, landingArticle, thanksArticle]) {
      expect(html).not.toContain('Find Your Float');
      expect(html).not.toContain('FLOAT');
      expect(html).not.toContain('drive.google.com');
    }
    for (const html of [landingArticle, thanksArticle]) {
      expect(html).not.toContain('$');
      expect(html).not.toMatch(/[—–]| - /);
    }

    const nodes = schemas(landing).flatMap((block) => (Array.isArray(block['@graph']) ? block['@graph'] : [block]));
    const faq = nodes.find((node) => node['@type'] === 'FAQPage');
    expect(faq.mainEntity).toHaveLength(3);
    expect(faq.mainEntity.map((item: { name: string }) => item.name)).toEqual([
      'Is this a replacement for lessons?',
      'Do I need a home pool?',
      'What happens after I sign up?',
    ]);
    expect(JSON.stringify(nodes)).not.toMatch(/Review|AggregateRating/);

    const title = landing.match(/<title>([^<]*)<\/title>/)?.[1] ?? '';
    const description = landing.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? '';
    expect(title.length).toBeLessThan(60);
    expect(description.length).toBeLessThan(155);
    const thanksTitle = thanks.match(/<title>([^<]*)<\/title>/)?.[1] ?? '';
    const thanksDescription = thanks.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? '';
    expect(thanksTitle.length).toBeLessThan(60);
    expect(thanksDescription.length).toBeLessThan(155);

    const sitemap = readFileSync(join(root, 'src/pages/sitemap.xml.js'), 'utf8');
    expect(sitemap).toContain("'/parent-playbooks/'");
    expect(sitemap).not.toContain('parent-playbooks/thank-you');
  });
});
