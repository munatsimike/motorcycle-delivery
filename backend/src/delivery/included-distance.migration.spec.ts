import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const enumSql = readFileSync('prisma/migrations/20261027160000_included_distance_model/migration.sql', 'utf8');
const columnSql = readFileSync('prisma/migrations/20261027160100_included_metres/migration.sql', 'utf8');
const schema = readFileSync('prisma/schema.prisma', 'utf8');

describe('included distance migration', () => {
  it('adds the pricing model without rewriting tariff rows', () => {
    expect(enumSql).toContain(`ALTER TYPE "pricing_model" ADD VALUE 'INCLUDED_DISTANCE'`);
    expect(enumSql).not.toMatch(/\bUPDATE\b/);
    expect(enumSql).not.toContain('delivery_pricing_configs');
    expect(enumSql.includes('\r')).toBe(false);
  });

  it('adds a nullable included distance and leaves stored fees alone', () => {
    expect(columnSql).toContain('ADD COLUMN "included_metres" INTEGER');
    expect(columnSql).toContain('delivery_pricing_configs_included_metres_chk');
    expect(columnSql).toContain(`"pricing_model" = 'INCLUDED_DISTANCE'`);
    expect(columnSql).toContain('"included_metres" IS NULL');
    expect(columnSql).not.toMatch(/\bUPDATE\b/);
    expect(columnSql).not.toMatch(/SET\s+"base_fee"/);
    expect(columnSql).not.toMatch(/SET\s+"price_per_kilometre"/);
    expect(columnSql).not.toMatch(/SET\s+"pricing_version"/);
    expect(columnSql).not.toContain('DELETE FROM');
    expect(columnSql.includes('\r')).toBe(false);
    expect(schema).toContain('INCLUDED_DISTANCE');
    expect(schema).toMatch(/includedMetres\s+Int\?/);
  });
});
