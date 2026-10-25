export type SessionGate = 'signed-out' | 'restore';

export function sessionGate(hasStoredSession: boolean): SessionGate {
  return hasStoredSession ? 'restore' : 'signed-out';
}
