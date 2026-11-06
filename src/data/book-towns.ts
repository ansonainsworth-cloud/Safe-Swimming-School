export type BookTown = {
  id: string;
  name: string;
  limited?: boolean;
};

/** Palm Beach County towns, plus Coral Springs and Parkland in Broward. */
export const BOOK_TOWNS: BookTown[] = [
  { id: 'jupiter', name: 'Jupiter' },
  { id: 'palm-beach-gardens', name: 'Palm Beach Gardens' },
  { id: 'north-palm-beach', name: 'North Palm Beach' },
  { id: 'tequesta', name: 'Tequesta' },
  { id: 'jupiter-farms', name: 'Jupiter Farms' },
  { id: 'westlake', name: 'Westlake' },
  { id: 'juno-beach', name: 'Juno Beach' },
  { id: 'riviera-beach', name: 'Riviera Beach' },
  { id: 'west-palm-beach', name: 'West Palm Beach' },
  { id: 'palm-beach', name: 'Palm Beach' },
  { id: 'wellington', name: 'Wellington' },
  { id: 'royal-palm-beach', name: 'Royal Palm Beach' },
  { id: 'coral-springs-parkland', name: 'Coral Springs and Parkland', limited: true },
];

export function bookTown(id: string): BookTown | undefined {
  return BOOK_TOWNS.find((town) => town.id === id);
}
