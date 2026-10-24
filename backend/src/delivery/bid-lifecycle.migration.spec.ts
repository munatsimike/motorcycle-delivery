import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync('prisma/migrations/20261024120000_v2_bid_lifecycle/migration.sql', 'utf8');
const schema = readFileSync('prisma/schema.prisma', 'utf8');

describe('V2 bid lifecycle migration', () => {
  it('lets a V2 request omit the agreed price and stores a bid idempotency key', () => {
    expect(sql.includes('\r')).toBe(false);
    expect(sql).toContain('ALTER COLUMN "price" DROP NOT NULL');
    expect(sql).toContain('ALTER COLUMN "payer" DROP NOT NULL');
    expect(sql).toContain('ALTER COLUMN "payment_method" DROP NOT NULL');
    expect(sql).toContain('"pricing_model"');
    expect(sql).toContain('"pricing_basis_points"');
    expect(sql).toContain('"pricing_window_id"');
    expect(sql).toContain('bids_idempotency_key_key');
    expect(sql).toContain('bids_amount_nonnegative_chk');
    expect(sql).toContain('bids_currency_usd_chk');
    expect(sql).toContain('bids_idempotency_pair_chk');
    expect(sql).not.toMatch(/\bINSERT\b/);
    expect(sql).not.toMatch(/UPDATE\s+"bids"\s+SET/);
    expect(sql).not.toContain('wallet_fee_reservations');
    expect(sql).not.toContain('rider_wallet_entries');
    expect(sql).not.toContain('accepted_platform_fee');
    expect(sql).not.toMatch(/DROP\s+(INDEX|CONSTRAINT)[^;]*delivery_assignments_one_accepted_per_rider_idx/);
    expect(sql).not.toContain('delivery_assignments_one_live_express_per_rider_idx');
    expect(schema).toContain('idempotencyKey String?   @unique');
    expect(schema).toContain('price                Decimal?');
  });
});
