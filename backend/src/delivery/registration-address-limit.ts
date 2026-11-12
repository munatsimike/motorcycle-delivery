export const REGISTRATION_PLACE_LIMIT = 60;
export const REGISTRATION_PLACE_WINDOW_MS = 10 * 60_000;

export class RegistrationPlaceLimiter {
  private readonly hits = new Map<string, number[]>();

  allow(ip: string, now = Date.now()): boolean {
    const key = ip.trim() || 'unknown';
    const recent = (this.hits.get(key) ?? []).filter((at) => now - at < REGISTRATION_PLACE_WINDOW_MS);
    if (recent.length >= REGISTRATION_PLACE_LIMIT) {
      this.hits.set(key, recent);
      this.prune(now);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    this.prune(now);
    return true;
  }

  private prune(now: number): void {
    if (this.hits.size <= 500) {
      return;
    }
    for (const [key, times] of this.hits) {
      const recent = times.filter((at) => now - at < REGISTRATION_PLACE_WINDOW_MS);
      if (recent.length === 0) {
        this.hits.delete(key);
      } else {
        this.hits.set(key, recent);
      }
    }
  }
}
