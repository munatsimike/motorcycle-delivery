import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { straightLineMetres, suggestedCents } from './straight-line.js';

describe('straight-line pricing', () => {
  it('prices a fixture tariff in integer cents', () => {
    expect(straightLineMetres(0, 0, 0, 0)).toBe(0);
    const oneDegree = Math.round((6_371_000 * Math.PI) / 180);
    expect(straightLineMetres(0, 0, 0, 1)).toBe(oneDegree);
    expect(suggestedCents(0, { baseFeeCents: 200, pricePerKilometreCents: 100 })).toBe(200);
    expect(suggestedCents(1_000, { baseFeeCents: 200, pricePerKilometreCents: 50 })).toBe(250);
    expect(suggestedCents(1_500, { baseFeeCents: 200, pricePerKilometreCents: 50 })).toBe(275);
  });

  it('keeps production pricing free of a hardcoded tariff', () => {
    const source = [
      'src/delivery/delivery-pricing.service.ts',
      'src/delivery/delivery.service.ts',
      'src/delivery/straight-line.ts',
    ].map((path) => readFileSync(path, 'utf8')).join('\n');
    expect(source).not.toMatch(/baseFeeCents\s*=/);
    expect(source).not.toContain("baseFee: '2.00'");
    expect(source).not.toContain("pricePerKilometre: '0.50'");
  });
});
