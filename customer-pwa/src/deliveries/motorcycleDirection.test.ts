import assert from 'node:assert/strict';
import test from 'node:test';
import {
  motorcycleDirection,
  nearestMotorcycleDirection,
  stableMotorcycleDirection,
  MOTORCYCLE_DIRECTIONS,
} from './motorcycleDirection.ts';

test('the nearest sprite is one of the eight compass directions', () => {
  assert.equal(nearestMotorcycleDirection(0), 'north');
  assert.equal(nearestMotorcycleDirection(22.4), 'north');
  assert.equal(nearestMotorcycleDirection(22.5), 'northeast');
  assert.equal(nearestMotorcycleDirection(45), 'northeast');
  assert.equal(nearestMotorcycleDirection(90), 'east');
  assert.equal(nearestMotorcycleDirection(135), 'southeast');
  assert.equal(nearestMotorcycleDirection(180), 'south');
  assert.equal(nearestMotorcycleDirection(225), 'southwest');
  assert.equal(nearestMotorcycleDirection(270), 'west');
  assert.equal(nearestMotorcycleDirection(315), 'northwest');
  assert.equal(nearestMotorcycleDirection(359), 'north');
  assert.equal(nearestMotorcycleDirection(-90), 'west');
});

test('hysteresis keeps the current sprite until the bearing clears the boundary', () => {
  assert.equal(motorcycleDirection(30, 'north'), 'north');
  assert.equal(motorcycleDirection(33, 'north'), 'northeast');
  assert.equal(motorcycleDirection(23, 'northeast'), 'northeast');
  assert.equal(motorcycleDirection(12, 'northeast'), 'north');
  assert.equal(motorcycleDirection(350, 'north'), 'north');
  assert.equal(motorcycleDirection(180, 'north'), 'south');
});

test('an available rider keeps one direction for the same id', () => {
  const ids = [
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333',
    '44444444-4444-4444-8444-444444444444',
  ];
  const chosen = ids.map((id) => stableMotorcycleDirection(id));
  for (const [index, id] of ids.entries()) {
    assert.equal(stableMotorcycleDirection(id), chosen[index]);
    assert.equal(MOTORCYCLE_DIRECTIONS.includes(chosen[index]!), true);
  }
  assert.ok(new Set(chosen).size > 1);
});

test('a stationary rider keeps the last direction for collection and delivery', () => {
  assert.equal(motorcycleDirection(null, 'east'), 'east');
  assert.equal(motorcycleDirection(undefined, 'east'), 'east');
  assert.equal(motorcycleDirection(Number.NaN, 'southwest'), 'southwest');
  assert.equal(motorcycleDirection(null, null), null);
  assert.equal(motorcycleDirection(90, null), 'east');
  assert.equal(motorcycleDirection(90, 'east'), 'east');
});
