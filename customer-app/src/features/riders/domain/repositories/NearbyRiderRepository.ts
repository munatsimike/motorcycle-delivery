export type NearbyRiderRepository = {
  count(accessToken: string, latitude: number, longitude: number): Promise<number>;
};
