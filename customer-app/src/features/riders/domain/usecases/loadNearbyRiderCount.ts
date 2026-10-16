import type { NearbyRiderRepository } from '../repositories/NearbyRiderRepository';

export function loadNearbyRiderCount(
  repository: NearbyRiderRepository,
  accessToken: string,
  latitude: number,
  longitude: number,
): Promise<number> {
  return repository.count(accessToken, latitude, longitude);
}
