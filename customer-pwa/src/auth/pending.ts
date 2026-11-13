import type { AuthFlow } from './contracts';

const STORAGE_KEY = 'riders.customer.pending';

export type PendingVerification = {
  flow: AuthFlow;
  phone: string;
};

export function savePendingVerification(pending: PendingVerification): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(pending));
}

export function readPendingVerification(flow: AuthFlow): string | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.flow !== flow || typeof parsed.phone !== 'string' || !parsed.phone) {
      return null;
    }
    return parsed.phone;
  } catch {
    return null;
  }
}

export function clearPendingVerification(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
