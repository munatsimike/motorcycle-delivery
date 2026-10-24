import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync('prisma/migrations/20261023210000_pricing_class_tariffs/migration.sql', 'utf8');
const schema = readFileSync('prisma/schema.prisma', 'utf8');

describe('pricing class tariff migration', () => {
  it('keeps the existing V1 tariff on the null class and base-plus model', () => {
    expect(sql).toContain("CREATE TYPE \"pricing_model\" AS ENUM");
    expect(sql).toContain("'BASE_PLUS_PER_KILOMETRE'");
    expect(sql).toContain('ADD COLUMN "service_class" "service_class"');
    expect(sql).toContain("SET \"pricing_model\" = 'BASE_PLUS_PER_KILOMETRE'");
    expect(sql).not.toMatch(/SET\s+"base_fee"/);
    expect(sql).not.toMatch(/SET\s+"price_per_kilometre"/);
    expect(sql).not.toMatch(/SET\s+"pricing_version"/);
    expect(sql).not.toContain('DELETE FROM "delivery_pricing_configs"');
    expect(sql).not.toContain('INSERT INTO "delivery_pricing_configs"');
  });

  it('allows one active null-class tariff and one active tariff per service class', () => {
    const drops = [...sql.matchAll(/DROP INDEX[^;]+/g)].map((match) => match[0]);
    expect(drops).toEqual(['DROP INDEX "delivery_pricing_configs_one_active_idx"']);
    expect(sql).toContain('CREATE UNIQUE INDEX "delivery_pricing_configs_one_active_v1_idx"');
    expect(sql).toContain('WHERE "is_active" = true AND "service_class" IS NULL');
    expect(sql).toContain('CREATE UNIQUE INDEX "delivery_pricing_configs_one_active_per_class_idx"');
    expect(sql).toContain('WHERE "is_active" = true AND "service_class" IS NOT NULL');
    expect(sql).toContain('CREATE TABLE "pricing_distance_tiers"');
    expect(sql).toContain('REFERENCES "delivery_pricing_configs"("id")');
    expect(schema).toContain('enum PricingModel');
    expect(schema).toContain('model PricingDistanceTier');
    expect(schema).toMatch(/serviceClass\s+ServiceClass\?/);
  });

  it('does not drop V1 assignment, bid, or account protections', () => {
    const statements = sql
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    expect(statements).not.toMatch(/DROP\s+(INDEX|CONSTRAINT)[^;]*delivery_assignments_one_accepted_per_rider_idx/);
    expect(statements).not.toContain('delivery_assignments_one_live_express_per_rider_idx');
    expect(statements).not.toContain('bids_one_open_per_rider_delivery_idx');
    expect(statements).not.toContain('bids_one_accepted_per_delivery_idx');
    expect(statements).not.toContain('users_account_credential_chk');
    expect(statements).not.toContain('DROP CONSTRAINT');
    expect(statements).not.toContain('DROP TABLE');
    expect(sql.includes('\r')).toBe(false);
  });
});
