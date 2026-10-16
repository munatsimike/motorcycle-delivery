import { apiGet } from '../../../services/api/apiClient';
import { readNearbyRiderCount } from '../domain/nearbyRiderCount';
import type { NearbyRiderRepository } from '../domain/repositories/NearbyRiderRepository';

export class NearbyRiderApiRepository implements NearbyRiderRepository {
  async count(accessToken: string, latitude: number, longitude: number): Promise<number> {
    const path = `/customers/me/riders/nearby?latitude=${encodeURIComponent(String(latitude))}&longitude=${encodeURIComponent(String(longitude))}`;
    const body = await apiGet<unknown>(path, { accessToken });
    return readNearbyRiderCount(body);
  }
}

export const nearbyRiderRepository = new NearbyRiderApiRepository();
