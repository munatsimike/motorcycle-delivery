import { apiRequest } from '../api/client';
import { coordinateQuery, readNearbyRiderMap, type NearbyRiderMapPoint } from './nearby';

export function fetchNearbyRiders(
  accessToken: string,
  latitude: number,
  longitude: number,
): Promise<{ count: number; points: NearbyRiderMapPoint[] }> {
  const path = `/customers/me/riders/nearby?latitude=${encodeURIComponent(coordinateQuery(latitude))}&longitude=${encodeURIComponent(coordinateQuery(longitude))}`;
  return apiRequest<unknown>(path, { accessToken }).then((body) => readNearbyRiderMap(body));
}
