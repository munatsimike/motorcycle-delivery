import { describe, expect, it, vi } from 'vitest';

import { createBody, emptyStop, prepareBooking, quoteBody, type StopDraft } from './bookingDraft';
import {
  LOCATION_PERMISSION_MESSAGE,
  LOCATION_SERVICES_MESSAGE,
  LOCATION_UNAVAILABLE_MESSAGE,
  OUTSIDE_SERVICE_AREA,
  applyConfirmedPickup,
  classifyGpsFix,
  detectPickupLocation,
  formatReverseAddress,
  pickupAfterCancel,
  pickupLocationMessage,
  runPickupDetection,
  showsCurrentLocationAction,
  type PickupDetection,
  type PickupFix,
} from './pickupLocation';

const NOW = 1_700_000_000_000;

function fix(overrides: Partial<PickupFix> = {}): PickupFix {
  return {
    latitude: -17.8292,
    longitude: 31.0522,
    accuracyMetres: 12,
    capturedAt: NOW - 1_000,
    ...overrides,
  };
}

function ports(overrides: Partial<Parameters<typeof detectPickupLocation>[0]> = {}) {
  return {
    servicesEnabled: true,
    permission: 'granted' as const,
    requestPermission: vi.fn(async () => 'granted' as const),
    readFix: vi.fn(async () => fix()),
    reverseGeocode: vi.fn(async () => '12 Samora Machel Avenue, Harare'),
    now: NOW,
    ...overrides,
  };
}

describe('pickup current location', () => {
  it('shows the action only on the pickup step', () => {
    expect(showsCurrentLocationAction('pickup')).toBe(true);
    expect(showsCurrentLocationAction('destination')).toBe(false);
    expect(showsCurrentLocationAction('parcel')).toBe(false);
  });

  it('uses a granted permission without asking again', async () => {
    const requestPermission = vi.fn(async () => 'granted' as const);
    const result = await detectPickupLocation(ports({ requestPermission }), false);
    expect(requestPermission).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'confirm',
      latitude: '-17.8292000',
      longitude: '31.0522000',
      address: '12 Samora Machel Avenue, Harare',
    });
  });

  it('asks once when permission has not been granted', async () => {
    const requestPermission = vi.fn(async () => 'granted' as const);
    const result = await detectPickupLocation(ports({ permission: 'denied', requestPermission }), false);
    expect(requestPermission).toHaveBeenCalledOnce();
    expect(result.status).toBe('confirm');
  });

  it('reports a denied or blocked permission and does not read GPS', async () => {
    const readFix = vi.fn(async () => fix());
    const denied = await detectPickupLocation(ports({
      permission: 'denied',
      requestPermission: async () => 'denied',
      readFix,
    }), false);
    const blocked = await detectPickupLocation(ports({
      permission: 'blocked',
      requestPermission: async () => 'granted',
      readFix,
    }), false);
    expect(denied.status).toBe('permission-denied');
    expect(blocked.status).toBe('permission-blocked');
    expect(readFix).not.toHaveBeenCalled();
    expect(pickupLocationMessage('permission-denied')).toBe(LOCATION_PERMISSION_MESSAGE);
    expect(pickupLocationMessage('permission-blocked')).toBe(LOCATION_PERMISSION_MESSAGE);
  });

  it('stops when location services are off', async () => {
    const readFix = vi.fn(async () => fix());
    const result = await detectPickupLocation(ports({ servicesEnabled: false, readFix }), false);
    expect(result.status).toBe('services-off');
    expect(readFix).not.toHaveBeenCalled();
    expect(pickupLocationMessage('services-off')).toBe(LOCATION_SERVICES_MESSAGE);
  });

  it('rejects a timeout, a stale fix, poor accuracy, and invalid coordinates', async () => {
    expect((await detectPickupLocation(ports({ readFix: async () => 'timeout' }), false)).status).toBe('unavailable');
    expect((await detectPickupLocation(ports({ readFix: async () => 'invalid' }), false)).status).toBe('unavailable');
    expect((await detectPickupLocation(ports({ readFix: async () => fix({ accuracyMetres: 250 }) }), false)).status).toBe('unavailable');
    expect((await detectPickupLocation(ports({ readFix: async () => fix({ accuracyMetres: null }) }), false)).status).toBe('unavailable');
    expect((await detectPickupLocation(ports({ readFix: async () => fix({ capturedAt: NOW - 45_000 }) }), false)).status).toBe('unavailable');
    expect((await detectPickupLocation(ports({ readFix: async () => fix({ latitude: 91 }) }), false)).status).toBe('unavailable');
    expect(classifyGpsFix(fix(), NOW)).toBe('ok');
    expect(pickupLocationMessage('unavailable')).toBe(LOCATION_UNAVAILABLE_MESSAGE);
  });

  it('confirms a readable reverse-geocoded address and still confirms when geocoding fails', async () => {
    expect(formatReverseAddress({
      streetNumber: '12',
      street: 'Samora Machel Avenue',
      city: 'Harare',
      region: 'Harare',
    })).toBe('12 Samora Machel Avenue, Harare');
    expect(formatReverseAddress(null)).toBeNull();
    expect(formatReverseAddress({})).toBeNull();
    const failed = await detectPickupLocation(ports({
      reverseGeocode: async () => {
        throw new Error('geocoder down');
      },
    }), false);
    expect(failed).toMatchObject({ status: 'confirm', address: '', latitude: '-17.8292000' });
    const empty = await detectPickupLocation(ports({ reverseGeocode: async () => null }), false);
    expect(empty).toMatchObject({ status: 'confirm', address: '' });
  });

  it('rejects a production location outside Zimbabwe and allows a development Netherlands fix', async () => {
    const amsterdam = ports({ readFix: async () => fix({ latitude: 52.3676, longitude: 4.9041 }) });
    const production = await detectPickupLocation(amsterdam, false);
    expect(production.status).toBe('unsupported');
    expect(pickupLocationMessage('unsupported')).toBe(OUTSIDE_SERVICE_AREA);
    const development = await detectPickupLocation(amsterdam, true);
    expect(development).toMatchObject({ status: 'confirm', latitude: '52.3676000', longitude: '4.9041000' });
  });

  it('keeps the detected coordinates when the readable address changes', () => {
    const applied = applyConfirmedPickup({
      latitude: '-17.8292000',
      longitude: '31.0522000',
      address: '  Green gate,  Mbare  ',
      landmark: ' Near the main gate ',
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) {
      return;
    }
    expect(applied.patch).toMatchObject({
      address: 'Green gate, Mbare',
      landmark: 'Near the main gate',
      latitude: '-17.8292000',
      longitude: '31.0522000',
      coordinateSource: 'DEVICE_GEOCODER',
      placeId: null,
    });
    expect(applyConfirmedPickup({
      latitude: '-17.8292000',
      longitude: '31.0522000',
      address: '   ',
      landmark: '',
    })).toEqual({ ok: false, error: 'Enter the pickup address' });
  });

  it('leaves the existing pickup unchanged when detection fails or the customer cancels', () => {
    const current = existingPickup();
    expect(pickupAfterCancel(current)).toBe(current);
    expect(current.latitude).toBe('-17.8000000');
    const failed: PickupDetection = { status: 'unavailable' };
    expect(failed.status).not.toBe('confirm');
    expect(current.address).toBe('4 Jason Moyo Avenue');
  });

  it('does not start a second detection while one is running', async () => {
    let reads = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const state = { inFlight: false };
    const first = runPickupDetection(state, async () => {
      reads += 1;
      await gate;
      return { status: 'unavailable' };
    });
    const second = await runPickupDetection(state, async () => {
      reads += 1;
      return { status: 'unavailable' };
    });
    expect(second).toEqual({ status: 'busy' });
    release();
    await first;
    expect(reads).toBe(1);
    expect(state.inFlight).toBe(false);
  });

  it('sends the confirmed pickup coordinates to the quote and the delivery', () => {
    const draft = {
      pickup: {
        ...emptyStop(),
        address: 'Green gate, Mbare',
        landmark: 'Near the main gate',
        contactName: 'Tendai Moyo',
        contactPhone: '0771234567',
        latitude: '-17.8292000',
        longitude: '31.0522000',
        precision: 'exact' as const,
        coordinateSource: 'DEVICE_GEOCODER' as const,
      },
      dropoff: {
        ...emptyStop(),
        address: '4 Jason Moyo Avenue',
        contactName: 'Rudo Ncube',
        contactPhone: '+263777654321',
        latitude: '-17.8250000',
        longitude: '31.0330000',
        precision: 'exact' as const,
        placeId: 'ChIJdropoff001',
        coordinateSource: 'GOOGLE_PLACES' as const,
      },
      description: 'Parcel',
      size: 'SMALL' as const,
      instructions: '',
      payer: 'SENDER' as const,
      paymentMethod: 'CASH' as const,
      serviceClass: null,
      deliverBy: null,
    };
    const prepared = prepareBooking(draft);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) {
      return;
    }
    expect(quoteBody(prepared.booking)).toEqual({
      pickup: { latitude: -17.8292, longitude: 31.0522 },
      dropoff: { latitude: -17.825, longitude: 31.033 },
    });
    expect(createBody(prepared.booking, '2.50').pickup).toMatchObject({
      latitude: -17.8292,
      longitude: 31.0522,
      address: 'Green gate, Mbare',
      landmark: 'Near the main gate',
      coordinateSource: 'DEVICE_GEOCODER',
      placeId: null,
    });
    expect(createBody(prepared.booking, '2.50').dropoff).toMatchObject({
      latitude: -17.825,
      longitude: 31.033,
      coordinateSource: 'GOOGLE_PLACES',
      placeId: 'ChIJdropoff001',
    });
  });
});

function existingPickup(): StopDraft {
  return {
    ...emptyStop(),
    address: '4 Jason Moyo Avenue',
    latitude: '-17.8000000',
    longitude: '31.0400000',
    coordinateSource: 'GOOGLE_PLACES',
    placeId: 'ChIJexisting01',
    precision: 'exact',
  };
}
