import { describe, expect, it } from 'vitest';

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

