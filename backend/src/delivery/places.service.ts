import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createGeoapifyClient, GeoapifyRequestError, type PlaceSuggestion } from './geoapify.js';

@Injectable()
export class PlacesService {
  private readonly geoapify = createGeoapifyClient();

  async search(
    text: string,
    bias?: { latitude: number; longitude: number } | null,
  ): Promise<{ suggestions: PlaceSuggestion[] }> {
    const query = text.trim();
    if (query.length < 3 || query.length > 120) {
      throw new BadRequestException('Enter at least 3 characters.');
    }
    try {
      return { suggestions: await this.geoapify.autocomplete(query, bias) };
    } catch (error) {
      throw placesFailure(error);
    }
  }

  async pointMap(latitude: number, longitude: number): Promise<Uint8Array> {
    assertCoordinate(latitude, 90);
    assertCoordinate(longitude, 180);
    try {
      return await this.geoapify.pointMap(latitude, longitude);
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }
      throw new ServiceUnavailableException('The map preview is unavailable.');
    }
  }

  async deliveryMap(
    pickupLatitude: number,
    pickupLongitude: number,
    dropoffLatitude: number,
    dropoffLongitude: number,
  ): Promise<Uint8Array> {
    assertCoordinate(pickupLatitude, 90);
    assertCoordinate(pickupLongitude, 180);
    assertCoordinate(dropoffLatitude, 90);
    assertCoordinate(dropoffLongitude, 180);
    let line: Array<[number, number]> = [];
    try {
      line = (await this.geoapify.route(pickupLatitude, pickupLongitude, dropoffLatitude, dropoffLongitude)).line;
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }
    }
    try {
      return await this.geoapify.staticMap(
        pickupLatitude,
        pickupLongitude,
        dropoffLatitude,
        dropoffLongitude,
        line,
      );
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }
      throw new ServiceUnavailableException('The map preview is unavailable.');
    }
  }
}

function placesFailure(error: unknown): ServiceUnavailableException {
  if (error instanceof ServiceUnavailableException) {
    return error;
  }
  if (error instanceof GeoapifyRequestError && (error.status === 401 || error.status === 403)) {
    return new ServiceUnavailableException('Address search was rejected.');
  }
  return new ServiceUnavailableException('Address suggestions are unavailable.');
}

export function readSearchBias(
  latitude: unknown,
  longitude: unknown,
): { latitude: number; longitude: number } | null {
  if (typeof latitude !== 'string' || typeof longitude !== 'string' || !latitude.trim() || !longitude.trim()) {
    return null;
  }
  const parsedLatitude = Number(latitude);
  const parsedLongitude = Number(longitude);
  if (
    !Number.isFinite(parsedLatitude)
    || !Number.isFinite(parsedLongitude)
    || parsedLatitude < -90
    || parsedLatitude > 90
    || parsedLongitude < -180
    || parsedLongitude > 180
  ) {
    return null;
  }
  return { latitude: parsedLatitude, longitude: parsedLongitude };
}

function assertCoordinate(value: number, limit: number) {
  if (!Number.isFinite(value) || value < -limit || value > limit) {
    throw new BadRequestException('Enter a valid location.');
  }
}
