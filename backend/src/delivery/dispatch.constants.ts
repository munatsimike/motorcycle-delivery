export const GPS_FRESH_MS = 60_000;
export const OFFER_TTL_MS = 5 * 60 * 1000;
export const DISPATCH_POLL_MS = 2_000;
export const DISPATCH_ROUND_RADII_METRES = [2_000, 5_000, 10_000] as const;

export function gpsIsFresh(updatedAt: Date, now: Date): boolean {
  return updatedAt.getTime() > now.getTime() - GPS_FRESH_MS;
}

export function offerIsOpen(expiresAt: Date, now: Date): boolean {
  return expiresAt.getTime() > now.getTime();
}

