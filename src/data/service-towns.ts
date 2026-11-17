/** Example towns in Palm Beach County. Not a closed list and not a range. */
export const serviceTowns = [
  { name: 'Jupiter', href: '/locations/jupiter/' },
  { name: 'Palm Beach Gardens', href: '/locations/palm-beach-gardens/' },
  { name: 'North Palm Beach', href: '/locations/north-palm-beach/' },
  { name: 'Tequesta', href: '/locations/tequesta/' },
  { name: 'Jupiter Farms', href: '/locations/jupiter-farms/' },
  { name: 'Westlake', href: '/locations/westlake/' },
  { name: 'Juno Beach', href: '/locations/juno-beach/' },
  { name: 'Riviera Beach', href: '/locations/riviera-beach/' },
  { name: 'West Palm Beach', href: '/locations/west-palm-beach/' },
  { name: 'Palm Beach', href: '/locations/palm-beach/' },
  { name: 'Wellington', href: '/locations/wellington/' },
  { name: 'Royal Palm Beach', href: '/locations/royal-palm-beach/' },
] as const;

export const browardLimited = {
  name: 'Coral Springs and Parkland',
  href: '/swim-lessons-coral-springs-parkland/',
  line: 'Coral Springs and Parkland, in Broward County, have limited availability.',
} as const;

export function serviceTownsHtml(): string {
  const links = serviceTowns.map((town) => `<a href="${town.href}">${town.name}</a>`).join(', ');
  return `<p>Lessons are available across Palm Beach County, including West Palm Beach and surrounding areas. These towns are examples, not a limit: ${links}, and surrounding areas. If your town is not listed, ask. <a href="/locations/">See all locations</a>.</p><p>${browardLimited.line} <a href="${browardLimited.href}">Ask about openings</a>.</p>`;
}
