import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync('prisma/migrations/20261024110000_v2_commission_snapshots/migration.sql', 'utf8');
const schema = readFileSync('prisma/schema.prisma', 'utf8');
const statements = sql
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

describe('V2 commission snapshot migration', () => {
  it('stores the accepted bid, basis points, rate version, and calculated amount together', () => {
    expect(sql).toContain('ADD COLUMN "accepted_bid_amount" DECIMAL(12,2)');
    expect(sql).toContain('ADD COLUMN "accepted_commission_basis_points" INTEGER');
    expect(sql).toContain('ADD COLUMN "accepted_v2_commission_rate_version" INTEGER');
    expect(sql).toContain('ADD COLUMN "accepted_commission_amount" DECIMAL(12,2)');
    expect(sql).toContain('CONSTRAINT "delivery_assignments_v2_commission_snapshot_chk"');
    expect(sql).toContain('BETWEEN 0 AND 10000');
    expect(sql).toContain('+ 5000) / 10000');
    expect(sql).toContain('REFERENCES "v2_commission_rates"("rate_version")');
    expect(sql).toContain('ON UPDATE RESTRICT');
    expect(sql).toContain('CREATE TRIGGER "delivery_assignments_v2_commission_snapshot_immutable"');
    expect(schema).toContain('acceptedBidAmount');
    expect(schema).toContain('acceptedCommissionBasisPoints');
    expect(schema).toContain('acceptedV2CommissionRateVersion');
    expect(schema).toContain('acceptedCommissionAmount');
    expect(statements).not.toMatch(/\bINSERT\b/i);
    expect(statements).not.toMatch(/UPDATE\s+"delivery_assignments"\s+SET/i);
    expect(sql.includes('\r')).toBe(false);
  });

  it('leaves V1 fee snapshots, wallets, and bids unchanged', () => {
    expect(statements).not.toContain('accepted_platform_fee');
    expect(statements).not.toContain('accepted_commission_model');
    expect(statements).not.toContain('accepted_commission_policy_version');
    expect(statements).not.toContain('wallet_configs');
    expect(statements).not.toContain('commission_policies');
    expect(statements).not.toContain('suggested_price');
    expect(statements).not.toContain('"bids"');
    expect(statements).not.toContain('DROP INDEX');
    expect(statements).not.toContain('delivery_assignments_one_accepted_per_rider_idx');
    expect(statements).not.toContain('delivery_assignments_one_live_express_per_rider_idx');
  });
});
