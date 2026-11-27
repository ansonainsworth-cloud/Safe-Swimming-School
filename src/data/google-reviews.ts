/**
 * Public Google Maps listing. Refresh rating, count, url, and checkedDate together.
 * as of 2026-11-26.
 */
export const googleReviews: {
  rating: number | null;
  count: number | null;
  url: string | null;
  checkedDate: string | null;
} = {
  rating: 4.4,
  count: 7,
  url: 'https://maps.app.goo.gl/uhvbr4NSqpAEsPSE9',
  // as of 2026-11-26. Refresh this date when the listing is checked again.
  checkedDate: '2026-11-26',
};

export function googleReviewsReady(source = googleReviews): boolean {
  return source.rating != null && source.count != null && Boolean(source.url);
}
