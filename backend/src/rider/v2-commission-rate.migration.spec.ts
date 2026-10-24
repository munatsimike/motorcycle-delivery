import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync('prisma/migrations/20261024100000_v2_commission_rates/migration.sql', 'utf8');
const schema = readFileSync('prisma/schema.prisma', 'utf8');
const statements = sql
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

describe('V2 commission rate migration', () => {
  it('stores basis points with one active row and no seeded percentage', () => {
    expect(sql).toContain('CREATE TABLE "v2_commission_rates"');
    expect(sql).toContain('CONSTRAINT "v2_commission_rates_basis_points_chk" CHECK ("basis_points" >= 0 AND "basis_points" <= 10000)');
    expect(sql).toContain('CREATE UNIQUE INDEX "v2_commission_rates_rate_version_key"');
    expect(sql).toContain('ON "v2_commission_rates"("rate_version")');
    expect(sql).toContain('CREATE UNIQUE INDEX "v2_commission_rates_one_active_idx"');
    expect(sql).toContain('WHERE "is_active" = true');
    expect(sql).toContain('CREATE UNIQUE INDEX "v2_commission_rate_audits_next_version_key"');
    expect(sql).toContain('ON "v2_commission_rate_audits"("next_version")');
    expect(schema).toMatch(/nextVersion\s+Int\s+@unique/);
    expect(sql).toContain('CREATE TABLE "v2_commission_rate_audits"');
    expect(sql).toContain('REFERENCES "users"("id")');
    expect(statements).not.toMatch(/\bINSERT\b/i);
    expect(schema).toContain('model V2CommissionRate');
    expect(schema).toContain('model V2CommissionRateAudit');
    expect(sql.includes('\r')).toBe(false);
  });

  it('leaves the V1 wallet fee and commission timing tables unchanged', () => {
    expect(statements).not.toContain('wallet_configs');
    expect(statements).not.toContain('platform_fee');
    expect(statements).not.toContain('commission_policies');
    expect(statements).not.toContain('commission_model');
    expect(statements).not.toContain('delivery_assignments');
    expect(statements).not.toContain('DROP INDEX');
    expect(statements).not.toContain('DROP TABLE');
    expect(statements).not.toContain('delivery_assignments_one_accepted_per_rider_idx');
    expect(statements).not.toContain('delivery_assignments_one_live_express_per_rider_idx');
  });
});
