export const SIGNED_IN_ELSEWHERE =
  'Your account was signed in on another device. Please sign in again to continue.';

let pending = false;
const listeners = new Set<() => void>();

function publish(): void {
  for (const listener of listeners) listener();
}

export function isReplacementSignOut(error: unknown): boolean {
  return error instanceof Error && error.message === SIGNED_IN_ELSEWHERE;
}

export function rememberReplacementSignOut(error: unknown): void {
  if (!isReplacementSignOut(error) || pending) return;
  pending = true;
  publish();
}

export function replacementSignOutPending(): boolean {
  return pending;
}

export function clearReplacementSignOut(): void {
  if (!pending) return;
  pending = false;
  publish();
}

export function subscribeReplacementSignOut(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
