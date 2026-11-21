export function offerResponseSeconds(delivery: { status: string; offerResponseExpiresAt?: string | null }, now: number): number | null {
  if (delivery.status !== 'CREATED' || !delivery.offerResponseExpiresAt) return null;
  const deadline = Date.parse(delivery.offerResponseExpiresAt);
  return Number.isFinite(deadline) ? Math.max(0, Math.ceil((deadline - now) / 1000)) : null;
}

export function offerResponseLabel(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function routeCooldownSeconds(delivery: { status: string; offerResponseExpiresAt?: string | null }, now: number): number {
  if (delivery.status !== 'NO_RIDER_FOUND' || !delivery.offerResponseExpiresAt) return 0;
  const deadline = Date.parse(delivery.offerResponseExpiresAt) + 300_000;
  return Number.isFinite(deadline) ? Math.max(0, Math.ceil((deadline - now) / 1000)) : 0;
}
export function routeCooldownErrorDeadline(message: string): number | null {
  const match = /ROUTE_COOLDOWN_UNTIL (\d{4}-\d{2}-\d{2}T[0-9:.]+Z)/.exec(message);
  const deadline = match ? Date.parse(match[1]) : NaN;
  return Number.isFinite(deadline) ? deadline : null;
}
