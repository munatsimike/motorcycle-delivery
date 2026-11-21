export function offerResponseSeconds(delivery: { status: string; offerResponseExpiresAt?: string | null }, now: number): number | null {
  if (delivery.status !== 'CREATED' || !delivery.offerResponseExpiresAt) return null;
  const deadline = Date.parse(delivery.offerResponseExpiresAt);
  return Number.isFinite(deadline) ? Math.max(0, Math.ceil((deadline - now) / 1000)) : null;
}

export function offerResponseLabel(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
