import riderNorth from '../assets/motorcycle/rider-north.png';
import riderNortheast from '../assets/motorcycle/rider-northeast.png';
import riderEast from '../assets/motorcycle/rider-east.png';
import riderSoutheast from '../assets/motorcycle/rider-southeast.png';
import riderSouth from '../assets/motorcycle/rider-south.png';
import riderSouthwest from '../assets/motorcycle/rider-southwest.png';
import riderWest from '../assets/motorcycle/rider-west.png';
import riderNorthwest from '../assets/motorcycle/rider-northwest.png';
import {
  preloadDirectionalMotorcycles,
  stableMotorcycleDirection,
  type MotorcycleDirection,
} from '../deliveries/motorcycleDirection';

export const DIRECTIONAL_MOTORCYCLE_ICONS: Record<MotorcycleDirection, string> = {
  north: riderNorth,
  northeast: riderNortheast,
  east: riderEast,
  southeast: riderSoutheast,
  south: riderSouth,
  southwest: riderSouthwest,
  west: riderWest,
  northwest: riderNorthwest,
};

preloadDirectionalMotorcycles(Object.values(DIRECTIONAL_MOTORCYCLE_ICONS));

export function directionalMotorcycleUrl(id: string): string {
  return DIRECTIONAL_MOTORCYCLE_ICONS[stableMotorcycleDirection(id)];
}
