import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync('prisma/migrations/20261024160000_v2_flexible_express/migration.sql', 'utf8');

describe('V2 flexible and Express migration', () => {
  it('replaces the broad one-accepted-per-rider index and keeps one assignment per delivery', () => {
    expect(sql.includes('\r')).toBe(false);
    expect(sql).toContain('DROP INDEX "delivery_assignments_one_accepted_per_rider_idx"');
    expect(sql).toContain('CREATE UNIQUE INDEX "delivery_assignments_one_live_express_per_rider_idx"');
    expect(sql).toContain("\"status\" = 'ACCEPTED' AND \"service_class\" = 'EXPRESS'");
    expect(sql).toContain('CREATE UNIQUE INDEX "delivery_assignments_one_accepted_v1_per_rider_idx"');
    expect(sql).toContain("\"status\" = 'ACCEPTED' AND \"accepted_bid_amount\" IS NULL");
    expect(sql).not.toContain('delivery_assignments_one_accepted_per_delivery_idx');
    expect(sql).not.toContain('INSERT INTO');
    expect(sql).not.toContain('UPDATE ');
  });
});
