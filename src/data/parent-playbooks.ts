/** Tally form for the parent playbook signup. Submissions email info@. */
export const PARENT_PLAYBOOKS_TALLY_ID = 'e5RAAJ';

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'] as const;

/** Tally reads hidden fields from the embed URL. Keep only the page URL and the UTM params from this page. */
export function playbookEmbedUrl(pageUrl: string): string {
  const current = new URL(pageUrl);
  const embed = new URL(`https://tally.so/embed/${PARENT_PLAYBOOKS_TALLY_ID}`);
  embed.searchParams.set('alignLeft', '1');
  embed.searchParams.set('hideTitle', '1');
  embed.searchParams.set('transparentBackground', '1');
  embed.searchParams.set('dynamicHeight', '1');
  for (const key of UTM_KEYS) {
    const value = current.searchParams.get(key);
    if (value) embed.searchParams.set(key, value);
  }
  embed.searchParams.set('page_url', current.href);
  return embed.toString();
}
