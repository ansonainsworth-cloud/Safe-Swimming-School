/**
 * Fill rating, count, and url from the live Google Business Profile before showing the strip.
 * Leave them null until those three values are verified. checkedDate is the day they were checked.
 */
export const googleReviews: {
  rating: number | null;
  count: number | null;
  url: string | null;
  checkedDate: string | null;
} = {
  rating: null,
  count: null,
  url: null,
  checkedDate: null,
};

export function googleReviewsReady(source = googleReviews): boolean {
  return source.rating != null && source.count != null && Boolean(source.url);
}
