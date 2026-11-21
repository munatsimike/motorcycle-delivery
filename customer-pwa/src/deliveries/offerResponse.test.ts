import assert from 'node:assert/strict';
import test from 'node:test';
import { offerResponseSeconds, offerResponseLabel, routeCooldownSeconds, routeCooldownErrorDeadline } from './offerResponse.ts';

test('countdown follows absolute server deadline and stops at zero', () => {
  const now = Date.parse('2026-11-21T20:00:00Z');
  const delivery = { status: 'CREATED', offerResponseExpiresAt: new Date(now + 300000).toISOString() };
  assert.equal(offerResponseSeconds(delivery, now), 300);
  assert.equal(offerResponseSeconds({...delivery}, now + 61000), 239);
  assert.equal(offerResponseSeconds(delivery, now + 300000), 0);
  assert.equal(offerResponseSeconds(delivery, now + 400000), 0);
  assert.equal(offerResponseSeconds({...delivery, status: 'RIDER_ASSIGNED'}, now), null);
  assert.equal(offerResponseSeconds({...delivery, offerResponseExpiresAt: null}, now), null);
  assert.equal(offerResponseLabel(239), '3:59');
  assert.equal(offerResponseLabel(0), '0:00');
});

test('route cooldown uses the original response deadline', () => {
  const now = Date.parse('2026-11-21T20:00:00Z');
  const delivery = {status: 'NO_RIDER_FOUND', offerResponseExpiresAt: new Date(now).toISOString()};
  assert.equal(routeCooldownSeconds(delivery, now), 300);
  assert.equal(routeCooldownSeconds(delivery, now + 299999), 1);
  assert.equal(routeCooldownSeconds(delivery, now + 300000), 0);
  assert.equal(routeCooldownSeconds({...delivery, status: 'DELIVERED'}, now), 0);
  assert.equal(routeCooldownErrorDeadline('ROUTE_COOLDOWN_UNTIL 2026-11-21T20:00:00.000Z'), now);
});
