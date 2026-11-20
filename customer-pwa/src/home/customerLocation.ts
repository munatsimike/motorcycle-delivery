/** Small blue dot for the customer's own device location. Never a motorcycle. */
export const CUSTOMER_LOCATION_DOT = {
  fillColor: '#1A73E8',
  fillOpacity: 1,
  strokeColor: '#FFFFFF',
  strokeWeight: 2,
  scale: 6,
} as const;

export function customerLocationIcon<T>(circle: T): {
  path: T;
  fillColor: string;
  fillOpacity: number;
  strokeColor: string;
  strokeWeight: number;
  scale: number;
} {
  return { path: circle, ...CUSTOMER_LOCATION_DOT };
}
