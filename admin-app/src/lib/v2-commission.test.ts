import { describe, expect, it } from 'vitest';
import { basisPointsFromCommissionPercentage } from './v2-commission';

describe('V2 commission percentage input', () => {
  it.each([
    ['0', 0],
    ['0.00', 0],
    ['0%', 0],
    ['10', 1000],
    ['10.5', 1050],
    ['10.25', 1025],
    ['100', 10_000],
    ['100.00', 10_000],
  ])('accepts %s as %i basis points', (input, basisPoints) => {
    expect(basisPointsFromCommissionPercentage(input)).toBe(basisPoints);
  });

  it.each(['', '-1', '100.01', '101', '10.555', 'abc', '010'])('rejects %s', (input) => {
    expect(basisPointsFromCommissionPercentage(input)).toBeNull();
  });
});