import { describe, expect, it } from 'vitest';

import { HOME_NEIGHBORHOOD_DELTA, customerNeighborhoodFrame, frameContainsPoints, nearbyMapFrame } from './nearbyMapFrame';

describe('nearby map frame', () => {
  it('keeps a neighborhood span when only the customer is known', () => {
    const frame = nearbyMapFrame({ latitude: -17.82, longitude: 31.05 }, []);
    expect(frame?.latitude).toBeCloseTo(-17.82, 6);
    expect(frame?.longitude).toBeCloseTo(31.05, 6);
    expect(frame?.latitudeDelta).toBe(HOME_NEIGHBORHOOD_DELTA);
    expect(frame?.longitudeDelta).toBe(HOME_NEIGHBORHOOD_DELTA);
    expect(HOME_NEIGHBORHOOD_DELTA * 111).toBeGreaterThan(2);
    expect(HOME_NEIGHBORHOOD_DELTA * 111).toBeLessThan(3.2);
  });

  it('does not zoom in when a single rider is on the same street', () => {
    const customer = { latitude: -17.82, longitude: 31.05 };
    const frame = nearbyMapFrame(customer, [{ latitude: -17.8187, longitude: 31.0504 }]);
    expect(frame?.latitudeDelta).toBe(HOME_NEIGHBORHOOD_DELTA);
    expect(frame?.longitudeDelta).toBe(HOME_NEIGHBORHOOD_DELTA);
    expect(frameContainsPoints(nearbyMapFrame(customer, [])!, [customer, { latitude: -17.8187, longitude: 31.0504 }])).toBe(true);
  });

  it('expands the frame so a farther rider stays inside it', () => {
    const frame = nearbyMapFrame(
      { latitude: -17.82, longitude: 31.05 },
      [{ latitude: -17.79, longitude: 31.05 }],
    );
    expect(frame?.latitude).toBeCloseTo(-17.805, 5);
    expect(frame?.latitudeDelta).toBeGreaterThan(HOME_NEIGHBORHOOD_DELTA);
    expect(frame!.latitude - frame!.latitudeDelta / 2).toBeLessThan(-17.82);
    expect(frame!.latitude + frame!.latitudeDelta / 2).toBeGreaterThan(-17.79);
  });

  it('includes several riders without dropping below the neighborhood span', () => {
    const frame = nearbyMapFrame(
      { latitude: -17.82, longitude: 31.05 },
      [
        { latitude: -17.825, longitude: 31.045 },
        { latitude: -17.815, longitude: 31.055 },
      ],
    );
    expect(frame?.latitudeDelta).toBe(HOME_NEIGHBORHOOD_DELTA);
    expect(frame?.longitudeDelta).toBe(HOME_NEIGHBORHOOD_DELTA);
    expect(frameContainsPoints(frame!, [
      { latitude: -17.82, longitude: 31.05 },
      { latitude: -17.825, longitude: 31.045 },
      { latitude: -17.815, longitude: 31.055 },
    ])).toBe(true);
  });

  it('returns nothing until there is a real point to show', () => {
    expect(nearbyMapFrame(null, [])).toBeNull();
  });

  it('keeps the home background centered on the customer at the neighborhood span', () => {
    const customer = { latitude: -17.82, longitude: 31.05 };
    const frame = customerNeighborhoodFrame(customer);
    expect(frame).toEqual({
      latitude: customer.latitude,
      longitude: customer.longitude,
      latitudeDelta: HOME_NEIGHBORHOOD_DELTA,
      longitudeDelta: HOME_NEIGHBORHOOD_DELTA,
    });
    expect(customerNeighborhoodFrame(null)).toBeNull();
  });
});
