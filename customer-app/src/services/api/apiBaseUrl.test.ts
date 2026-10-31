import { describe, expect, it } from 'vitest';

import { looksLikeAndroidEmulator, resolveApiBaseUrl } from './apiBaseUrl';

describe('resolveApiBaseUrl', () => {
  it('requires an API address', () => {
    expect(() => resolveApiBaseUrl({ configured: '  ', dev: true, platform: 'android' }))
      .toThrow('The app is missing its API address.');
  });

  it('rejects an address that is not a URL', () => {
    expect(() => resolveApiBaseUrl({ configured: 'not a url', dev: false, platform: 'ios' }))
      .toThrow('The app has an invalid API address.');
  });

  it('accepts https for release builds', () => {
    expect(resolveApiBaseUrl({
      configured: 'https://api.example.com/',
      dev: false,
      platform: 'ios',
    })).toBe('https://api.example.com');
  });

  it('allows a local http address only for Android development', () => {
    expect(resolveApiBaseUrl({
      configured: 'http://192.168.1.20:3000/',
      dev: true,
      platform: 'android',
    })).toBe('http://192.168.1.20:3000');
    expect(() => resolveApiBaseUrl({
      configured: 'http://192.168.1.20:3000',
      dev: true,
      platform: 'ios',
    })).toThrow('The app requires an https API address.');
    expect(() => resolveApiBaseUrl({
      configured: 'http://192.168.1.20:3000',
      dev: false,
      platform: 'android',
    })).toThrow('The app requires an https API address.');
    expect(() => resolveApiBaseUrl({
      configured: 'http://example.com',
      dev: true,
      platform: 'android',
    })).toThrow('The app requires an https API address.');
  });

  it('keeps phone loopback and rewrites it only on an Android emulator', () => {
    expect(resolveApiBaseUrl({
      configured: 'http://127.0.0.1:3000',
      dev: true,
      platform: 'android',
      emulator: false,
    })).toBe('http://127.0.0.1:3000');
    expect(resolveApiBaseUrl({
      configured: 'http://localhost:3000/',
      dev: true,
      platform: 'android',
      emulator: true,
    })).toBe('http://10.0.2.2:3000');
    expect(resolveApiBaseUrl({
      configured: 'http://192.168.178.212:3000',
      dev: true,
      platform: 'android',
      emulator: true,
    })).toBe('http://192.168.178.212:3000');
  });

  it('recognizes an emulator fingerprint and leaves a phone alone', () => {
    expect(looksLikeAndroidEmulator({
      fingerprint: 'google/sdk_gphone64_arm64/emulator',
      hardware: 'ranchu',
      product: 'sdk_gphone64_arm64',
    })).toBe(true);
    expect(looksLikeAndroidEmulator({
      fingerprint: 'samsung/g0sxeea/g0s:14/UP1A',
      model: 'SM-S906B',
      hardware: 'qcom',
      product: 'g0sxeea',
      manufacturer: 'samsung',
    })).toBe(false);
  });
});
