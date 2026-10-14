const EARTH_RADIUS_METRES = 6_371_000;

export type TariffCents = {
  baseFeeCents: number;
  pricePerKilometreCents: number;
  minimumTripMetres: number;
  maximumTripMetres: number;
};

export function straightLineMetres(latitudeA: number, longitudeA: number, latitudeB: number, longitudeB: number): number {
  const latitudeARadians = toRadians(latitudeA);
  const latitudeBRadians = toRadians(latitudeB);
  const deltaLatitude = latitudeBRadians - latitudeARadians;
  const deltaLongitude = toRadians(longitudeB - longitudeA);
  const haversine = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(latitudeARadians) * Math.cos(latitudeBRadians) * Math.sin(deltaLongitude / 2) ** 2;
  const arc = 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
  return roundHalfUp(EARTH_RADIUS_METRES * arc);
}

export function suggestedCents(distanceMetres: number, tariff: Pick<TariffCents, 'baseFeeCents' | 'pricePerKilometreCents'>): number {
  const distanceCharge = (BigInt(tariff.pricePerKilometreCents) * BigInt(distanceMetres) + 500n) / 1000n;
  const total = BigInt(tariff.baseFeeCents) + distanceCharge;
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('Suggested price is too large');
  }
  return Number(total);
}

function toRadians(degrees: number): number {
  return degrees * Math.PI / 180;
}

function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5);
}
