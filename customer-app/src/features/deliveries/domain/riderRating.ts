export type CustomerDeliveryRating = {
  eligible: boolean;
  submitted: boolean;
  stars: number | null;
};

export function readCustomerDeliveryRating(value: unknown): CustomerDeliveryRating {
  if (!isRecord(value)) {
    return { eligible: false, submitted: false, stars: null };
  }
  const stars = readStars(value.stars);
  const submitted = value.submitted === true;
  return {
    eligible: value.eligible === true && !submitted,
    submitted,
    stars: submitted ? stars : null,
  };
}

export function ratingPromptVisible(rating: CustomerDeliveryRating, skipped: boolean): boolean {
  return rating.eligible && !rating.submitted && !skipped;
}

function readStars(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 5) {
    return null;
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
