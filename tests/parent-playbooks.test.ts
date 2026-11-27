import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import Landing from '../src/pages/parent-playbooks/index.astro';
import Thanks from '../src/pages/parent-playbooks/thank-you.astro';
import { PARENT_PLAYBOOKS_TALLY_ID, playbookEmbedUrl } from '../src/data/parent-playbooks';

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
    expect(PARENT_PLAYBOOKS_TALLY_ID).toBe('e5RAAJ');
    const embed = new URL(playbookEmbedUrl('https://safeswimmingschool.com/parent-playbooks/?utm_source=ig&utm_medium=social&utm_campaign=playbooks&utm_content=bio&gclid=skip'));
    expect(embed.origin + embed.pathname).toBe('https://tally.so/embed/e5RAAJ');
    expect(embed.searchParams.get('dynamicHeight')).toBe('1');
    expect(embed.searchParams.get('alignLeft')).toBe('1');
    expect(embed.searchParams.get('hideTitle')).toBe('1');
    expect(embed.searchParams.get('transparentBackground')).toBe('1');
    expect(embed.searchParams.get('utm_source')).toBe('ig');
    expect(embed.searchParams.get('utm_medium')).toBe('social');
    expect(embed.searchParams.get('utm_campaign')).toBe('playbooks');
    expect(embed.searchParams.get('utm_content')).toBe('bio');
    expect(embed.searchParams.get('gclid')).toBeNull();
    expect(embed.searchParams.get('page_url')).toBe('https://safeswimmingschool.com/parent-playbooks/?utm_source=ig&utm_medium=social&utm_campaign=playbooks&utm_content=bio&gclid=skip');
    expect(playbookEmbedUrl('https://safeswimmingschool.com/parent-playbooks/').includes('utm_source=')).toBe(false);
    const container = await AstroContainer.create();
    const landing = await container.renderToString(Landing);
    const thanks = await container.renderToString(Thanks);
    const landingArticle = article(landing);
    const thanksArticle = article(thanks);

    expect(landing).toContain('<title>Get the Parent Playbooks | Safe Swimming School</title>');
    expect(landing).toContain('Get the Parent Playbooks for free');
    expect(landing).toContain('I have taught survival swim in home pools across Palm Beach County since 2009.');
    expect(landing).not.toContain('Form placeholder.');
    const embeds = [...landing.matchAll(/data-tally-src="([^"]+)"/g)].map((match) => match[1]);
    expect(embeds).toHaveLength(2);
    expect(embeds[0]).toBe(embeds[1]);
    expect(embeds[0]).toContain('https://tally.so/embed/e5RAAJ');
    expect(embeds[0]).toContain('dynamicHeight=1');
    const formSource = readFileSync(join(root, 'src/components/PlaybookForm.astro'), 'utf8');
    expect(formSource).toContain('scroll-padding-top: 96px');
    expect(formSource).toContain('scroll-margin-top: 96px');
    expect(formSource).toContain('scroll-padding-top: 76px');
    expect(formSource).toContain('https://tally.so/widgets/embed.js');
    expect(landing).toContain('id="playbook-form"');
    expect(formSource).toContain('playbookEmbedUrl');
    expect(formSource).not.toContain('webhook');
    expect(landing).toContain('rel="canonical" href="https://safeswimmingschool.com/parent-playbooks/"');
    expect(landing).toContain('googletagmanager.com/gtag/js');
    expect(thanks).toContain('noindex');
    expect(thanks).toContain('<title>Your playbooks are on the way | Safe Swimming School</title>');
    expect(thanksArticle).toContain('Your playbooks are on the way to your inbox. Start with Playbook 1, then watch Trust Before Technique when you have ten minutes. If you are in Palm Beach County and you want to talk through whether lessons fit your child, text me at');
    expect(thanksArticle).toContain('href="sms:+15612368260"');
    expect(thanksArticle).toContain('>561 236 8260</a>');
    expect(thanksArticle).toContain('Check your spam folder if you do not see it soon.');
    expect(thanksArticle).not.toContain('Video link: TODO');
    expect(thanksArticle).not.toContain('Calendar link: TODO');
    expect(thanksArticle).not.toContain('TODO');
    expect(thanksArticle).not.toContain('<img');

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
