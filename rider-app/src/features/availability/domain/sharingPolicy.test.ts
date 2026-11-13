import { describe, expect, it } from 'vitest';

import { readGpsFix, readLatestTaskFix } from './gpsFix';
import { canGoOffline, canGoOnline, sharingStep, shouldShareLocation } from './sharingPolicy';
import type { RiderOnboarding } from '../../onboarding/domain/riderOnboarding';

const ready: RiderOnboarding = {
  licenceVerificationStatus: 'VERIFIED',
  approvalStatus: 'APPROVED',
  availability: 'OFFLINE',
  licenceNumber: 'ABC123',
  licenceClass: '4',
  rejectionReason: null,
  verifiedMotorcycleCount: 1,
  activeVerifiedMotorcycle: true,
};

describe('rider location sharing policy', () => {
  it('shares only while the server says available', () => {
    expect(shouldShareLocation('AVAILABLE')).toBe(true);
    expect(shouldShareLocation('BUSY')).toBe(false);
    expect(shouldShareLocation('OFFLINE')).toBe(false);
  });

  it('lets an eligible offline rider go online and blocks everyone else', () => {
    expect(canGoOnline(ready)).toBe(true);
    expect(canGoOnline({ ...ready, approvalStatus: 'PENDING' })).toBe(false);
    expect(canGoOnline({ ...ready, licenceVerificationStatus: 'PENDING' })).toBe(false);
    expect(canGoOnline({ ...ready, activeVerifiedMotorcycle: false })).toBe(false);
    expect(canGoOnline({ ...ready, availability: 'BUSY' })).toBe(false);
    expect(canGoOnline({ ...ready, availability: 'AVAILABLE' })).toBe(false);
    expect(canGoOffline({ ...ready, availability: 'AVAILABLE' })).toBe(true);
    expect(canGoOffline({ ...ready, availability: 'BUSY' })).toBe(true);
    expect(canGoOffline({ ...ready, availability: 'OFFLINE' })).toBe(false);
  });

  it('follows the server when a rider becomes busy or the app is backgrounded', () => {
    expect(sharingStep({ server: 'BUSY', sharing: true, appForeground: true })).toBe('stop');
    expect(sharingStep({ server: 'OFFLINE', sharing: true, appForeground: true })).toBe('stop');
    expect(sharingStep({ server: 'AVAILABLE', sharing: true, appForeground: false })).toBe('keep');
    expect(sharingStep({ server: 'AVAILABLE', sharing: false, appForeground: false })).toBe('wait-for-foreground');
    expect(sharingStep({ server: 'AVAILABLE', sharing: false, appForeground: true })).toBe('resume');
  });

  it('rejects coordinates that did not come from a device fix', () => {
    expect(readGpsFix(-17.8, 31.05)).toEqual({ latitude: -17.8, longitude: 31.05 });
    expect(readGpsFix(Number.NaN, 31)).toBeNull();
    expect(readGpsFix(91, 0)).toBeNull();
    expect(readLatestTaskFix({
      locations: [
        { coords: { latitude: '1', longitude: 2 } },
        { coords: { latitude: -17.8, longitude: 31.05 } },
      ],
    })).toEqual({ latitude: -17.8, longitude: 31.05 });
    expect(readLatestTaskFix({ locations: [] })).toBeNull();
    expect(readLatestTaskFix(null)).toBeNull();
  });
});
