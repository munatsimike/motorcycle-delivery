import { describe, expect, it } from 'vitest';

import { resolveApiBaseUrl } from './apiBaseUrl';

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
});
