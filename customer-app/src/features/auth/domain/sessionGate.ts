export type SessionGate = 'signed-out' | 'biometric' | 'biometric-unavailable' | 'restore';

export function sessionGate(input: {
  hasStoredSession: boolean;
  biometricEnabled: boolean;
  biometricAvailable: boolean;
}): SessionGate {
  if (!input.hasStoredSession) {
    return 'signed-out';
  }
  if (input.biometricEnabled && input.biometricAvailable) {
    return 'biometric';
  }
  if (input.biometricEnabled) {
    return 'biometric-unavailable';
  }
  return 'restore';
}
