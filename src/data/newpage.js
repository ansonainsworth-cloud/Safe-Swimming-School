import pages from './migrated-pages.json';
const svc = pages.find((p) => p.slug === 'service');
export const pageChrome = { bodyClass: svc.bodyClass, pageStyle: svc.pageStyle };
export const SITE = 'https://safeswimmingschool.com';
export function webPage(path, name, description, extra = []) {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebPage', '@id': SITE + path, url: SITE + path, name, description, isPartOf: { '@id': SITE + '/#website' }, about: { '@id': SITE + '/#localbusiness' }, inLanguage: 'en-US' },
      { '@type': 'BreadcrumbList', itemListElement: [ { '@type': 'ListItem', position: 1, name: 'Home', item: SITE + '/' }, { '@type': 'ListItem', position: 2, name } ] },
      ...extra,
    ],
  });
}
export function faqSchema(items) {
  return JSON.stringify({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: items.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) });
}
