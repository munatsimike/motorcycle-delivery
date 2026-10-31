import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync('prisma/migrations/20261026190000_rider_multiple_assignments/migration.sql', 'utf8');

describe('rider multiple assignments migration', () => {
  it('drops the per-rider assignment indexes and keeps one assignment per delivery', () => {
    expect(sql.includes('\r')).toBe(false);
    expect(sql).toContain('DROP INDEX "delivery_assignments_one_live_express_per_rider_idx"');
    expect(sql).toContain('DROP INDEX "delivery_assignments_one_accepted_v1_per_rider_idx"');
    expect(sql.match(/DROP INDEX/g)).toHaveLength(2);
    expect(sql).not.toContain('delivery_assignments_one_accepted_per_delivery_idx');
    expect(sql).not.toContain('delivery_assignments_one_open_offer_per_rider_idx');
    expect(sql).not.toContain('bids_one_open_per_rider_delivery_idx');
    expect(sql).not.toContain('DROP CONSTRAINT');
    expect(sql).not.toContain('ALTER TABLE');
    expect(sql).not.toContain('CREATE UNIQUE INDEX');
    expect(sql).not.toContain('INSERT INTO');
    expect(sql).not.toContain('UPDATE ');
  });
});
