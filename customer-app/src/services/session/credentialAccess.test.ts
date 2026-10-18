import { describe, expect, it } from 'vitest';

import { credentialFailure, rotationWrite, supportsBiometricCredentialProtection } from './credentialAccess';
import { decideInstall } from './installState';

describe('install marker', () => {
  it('keeps an updated install that has no marker yet', () => {
    expect(decideInstall({
      sandboxAvailable: true,
      sandboxMarker: null,
      keychainMarker: null,
    })).toBe('establish');
  });

  it('continues when the sandbox and keychain markers match', () => {
    expect(decideInstall({
      sandboxAvailable: true,
      sandboxMarker: 'install-1',
      keychainMarker: 'install-1',
    })).toBe('continue');
  });

  it('treats mismatched markers as a reinstall', () => {
    expect(decideInstall({
      sandboxAvailable: true,
      sandboxMarker: 'install-2',
      keychainMarker: 'install-1',
    })).toBe('reinstall');
  });

  it('treats a missing sandbox marker with a surviving keychain marker as a reinstall', () => {
    expect(decideInstall({
      sandboxAvailable: true,
      sandboxMarker: null,
      keychainMarker: 'install-1',
    })).toBe('reinstall');
  });

  it('does not clear a session when sandbox storage cannot be read', () => {
    expect(decideInstall({
      sandboxAvailable: false,
      sandboxMarker: null,
      keychainMarker: 'install-1',
    })).toBe('continue');
  });
});

describe('protected credential writes', () => {
  it('recreates the iOS item so rotation does not prompt again', () => {
    expect(rotationWrite('ios')).toBe('recreate');
    expect(rotationWrite('android')).toBe('update');
  });

  it('keeps biometric credential protection on iOS and defers new Android enrollment', () => {
    expect(supportsBiometricCredentialProtection('ios')).toBe(true);
    expect(supportsBiometricCredentialProtection('android')).toBe(false);
  });

  it('distinguishes cancellation from an enrollment change', () => {
    expect(credentialFailure(new Error('User canceled the biometric prompt'))).toBe('cancelled');
    expect(credentialFailure(new Error('Key permanently invalidated'))).toBe('invalidated');
    expect(credentialFailure(new Error('No biometrics are currently enrolled'))).toBe('invalidated');
    expect(credentialFailure(new Error('Network request failed'))).toBe('unavailable');
  });
});
