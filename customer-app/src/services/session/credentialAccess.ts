export type RotationWrite = 'recreate' | 'update';

export function rotationWrite(platform: 'ios' | 'android'): RotationWrite {
  return platform === 'ios' ? 'recreate' : 'update';
}

export function supportsBiometricCredentialProtection(platform: 'ios' | 'android'): boolean {
  return platform === 'ios';
}

export function credentialFailure(error: unknown): 'cancelled' | 'invalidated' | 'unavailable' {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (message.includes('cancel') || message.includes('user cancel') || message.includes('authentication failed')) {
    return 'cancelled';
  }
  if (
    message.includes('invalid')
    || message.includes('enroll')
    || message.includes('biometr')
    || message.includes('no hardware')
  ) {
    return 'invalidated';
  }
  return 'unavailable';
}

export class BiometricPromptCancelled extends Error {
  constructor() {
    super('Biometric unlock was cancelled.');
    this.name = 'BiometricPromptCancelled';
  }
}
