import { describe, expect, it } from 'vitest';

import { readDeviceAddressPin } from './deviceAddress';

describe('readDeviceAddressPin', () => {
  it('returns a phone geocode without reading GPS', async () => {
    const pin = await readDeviceAddressPin(
      '66 Mungongoma Road',
      { async ensure() { return 'ready'; } },
      { async geocode() { return [{ latitude: -17.891, longitude: 30.961 }]; } },
    );
    expect(pin).toEqual({ status: 'found', latitude: '-17.8910000', longitude: '30.9610000' });
  });

  it('reports no match separately from a failed lookup', async () => {
    await expect(readDeviceAddressPin('Nowhere', { async ensure() { return 'ready'; } }, { async geocode() { return []; } }))
      .resolves.toEqual({ status: 'none' });
    await expect(readDeviceAddressPin('Nowhere', { async ensure() { return 'ready'; } }, {
      async geocode() { throw new Error('network'); },
    })).resolves.toEqual({ status: 'unavailable', message: 'The phone address lookup failed. Try again.' });
  });

  it('does not geocode when location access is off', async () => {
    let called = false;
    const pin = await readDeviceAddressPin('66 Mungongoma Road', { async ensure() { return 'services-off'; } }, {
      async geocode() {
        called = true;
        return [];
      },
    });
    expect(called).toBe(false);
    expect(pin).toEqual({ status: 'unavailable', message: 'Turn on your device location so this address can be found.' });
  });
});
