export function readNearbyRiderCount(value: unknown): number {
  if (!isRecord(value) || typeof value.count !== 'number' || !Number.isInteger(value.count) || value.count < 0) {
    throw new Error('Rider availability is unavailable.');
  }
  return value.count;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
