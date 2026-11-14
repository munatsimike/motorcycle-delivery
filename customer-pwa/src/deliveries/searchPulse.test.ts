import assert from 'node:assert/strict';
import test from 'node:test';
import { SEARCH_PULSE_MS, SEARCH_RING_COUNT, searchPulseRings, searchRingColor } from './searchPulse.ts';

test('rider search pulse repeats a short sweep with three soft rings', () => {
  assert.ok(SEARCH_PULSE_MS >= 2500);
  assert.ok(SEARCH_PULSE_MS <= 3000);
  const rings = searchPulseRings(0, false);
  assert.equal(rings.length, SEARCH_RING_COUNT);
  assert.ok(rings.every((ring) => ring.opacity > 0 && ring.opacity <= 0.16));
  assert.ok((rings[0]?.radius ?? 0) < (rings[1]?.radius ?? 0));
  assert.ok((rings[1]?.radius ?? 0) < (rings[2]?.radius ?? 0));
});

test('rider search pulse expands and fades as the sweep advances', () => {
  const start = searchPulseRings(0, false)[0];
  const later = searchPulseRings(0.2, false)[0];
  assert.ok((later?.radius ?? 0) > (start?.radius ?? 0));
  assert.ok((later?.opacity ?? 1) < (start?.opacity ?? 1));
});

test('rider search pulse returns to the same rings when the sweep repeats', () => {
  assert.deepEqual(searchPulseRings(0, false), searchPulseRings(1, false));
  assert.deepEqual(searchPulseRings(1.2, false), searchPulseRings(0.2, false));
});

test('rider search pulse uses one static ring when motion is reduced', () => {
  assert.deepEqual(searchPulseRings(0.4, true), [{ radius: 260, opacity: 0.14 }]);
});

test('rider search pulse keeps the green tint faint', () => {
  assert.equal(searchRingColor(0.16), 'rgba(22,155,98,0.160)');
  assert.equal(searchRingColor(0.16, 1.7), 'rgba(22,155,98,0.272)');
});
