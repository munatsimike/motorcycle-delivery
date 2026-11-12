import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync('prisma/migrations/20261024140000_v2_pre_pickup_cancel/migration.sql', 'utf8');

describe('V2 pre-pickup cancellation migration', () => {
  it('keeps historical accepted bids and allows one current acceptance', () => {
    expect(sql.includes('\r')).toBe(false);
    expect(sql).toContain('ADD COLUMN "closed_at"');
    expect(sql).toContain('DROP INDEX "bids_one_accepted_per_delivery_idx"');
    expect(sql).toContain('AND "closed_at" IS NULL');
    expect(sql).toContain('cancellation_idempotency_key');
    expect(sql).not.toContain('delivery_assignments_one_accepted_per_rider_idx');
    expect(sql).not.toContain('DROP INDEX "delivery_assignments_one_accepted_per_delivery_idx"');
    expect(sql).not.toContain('INSERT INTO');
  });
});
