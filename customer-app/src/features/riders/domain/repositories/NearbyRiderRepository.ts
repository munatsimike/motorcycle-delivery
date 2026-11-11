import type { NearbyRiderMap } from '../nearbyRiderCount';

export type NearbyRiderRepository = {
  count(accessToken: string, latitude: number, longitude: number): Promise<number>;
  nearby(accessToken: string, latitude: number, longitude: number): Promise<NearbyRiderMap>;
};
