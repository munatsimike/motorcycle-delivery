import { describe, expect, it } from 'vitest';

import type { CustomerLocationPort, DeviceLocation } from '../../riders/domain/customerLocation';
import { readDropoffPin, readPickupPin, type AddressGeocoder } from './pickupLocation';

function port(readings: DeviceLocation[]): CustomerLocationPort {
  const pending = [...readings];
  return {
    async read() {
      return pending.shift() ?? { status: 'position-unavailable' };
    },
    async requestPermission() {
      return pending.shift() ?? { status: 'position-unavailable' };
    },
    async openLocationSettings() {},
    async openAppSettings() {},
  };
}

describe('readPickupPin', () => {
  it('uses the phone position as the pickup pin', async () => {
    const pin = await readPickupPin(port([
      { status: 'ready', latitude: -17.8292, longitude: 31.0522 },
    ]));
    expect(pin).toEqual({ ok: true, latitude: '-17.8292000', longitude: '31.0522000' });
  });

  it('asks for permission when the phone can still prompt', async () => {
    const pin = await readPickupPin(port([
      { status: 'permission-denied', canAskAgain: true },
      { status: 'ready', latitude: 52.1, longitude: 5.1 },
    ]));
    expect(pin).toEqual({ ok: true, latitude: '52.1000000', longitude: '5.1000000' });
  });

  it('explains when location is switched off', async () => {
    const pin = await readPickupPin(port([{ status: 'services-off' }]));
    expect(pin).toEqual({
      ok: false,
      error: 'Turn on your device location so the rider can find this address.',
    });
  });
});

describe('readDropoffPin', () => {
  it('uses the geocoded address as the drop-off pin', async () => {
    const geocoder: AddressGeocoder = {
      async geocode(address) {
        expect(address).toBe('4 Jason Moyo Avenue');
        return [{ latitude: -17.825, longitude: 31.033 }];
      },
    };
    const pin = await readDropoffPin(
      '4 Jason Moyo Avenue',
      port([{ status: 'ready', latitude: 0, longitude: 0 }]),
      geocoder,
    );
    expect(pin).toEqual({ ok: true, latitude: '-17.8250000', longitude: '31.0330000' });
  });

  it('asks for a clearer address when nothing matches', async () => {
    const geocoder: AddressGeocoder = {
      async geocode() {
        return [];
      },
    };
    const pin = await readDropoffPin(
      'unknown',
      port([{ status: 'ready', latitude: 0, longitude: 0 }]),
      geocoder,
    );
    expect(pin).toEqual({
      ok: false,
      error: 'This address could not be found. Enter a more specific address.',
    });
  });
});
