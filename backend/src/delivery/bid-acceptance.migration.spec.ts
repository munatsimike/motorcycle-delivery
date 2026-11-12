import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync('prisma/migrations/20261024130000_v2_bid_acceptance/migration.sql', 'utf8');
const schema = readFileSync('prisma/schema.prisma', 'utf8');

describe('V2 bid acceptance migration', () => {
  it('adds the assigned status and lets a V2 snapshot stand in for the V1 fee columns', () => {
    expect(sql.includes('\r')).toBe(false);
    expect(sql).toContain("ADD VALUE IF NOT EXISTS 'RIDER_ASSIGNED' AFTER 'ASSIGNED'");
    expect(sql).toContain('ADD COLUMN "service_class" "service_class"');
    expect(sql).toContain('DROP CONSTRAINT "delivery_assignments_accepted_fee_chk"');
    expect(sql).toContain('OR "accepted_bid_amount" IS NOT NULL');
    expect(sql).not.toContain('delivery_assignments_one_live_express');
    expect(sql).not.toContain('DROP INDEX');
    expect(sql).not.toContain('INSERT INTO');
    expect(sql).not.toContain('wallet_fee_reservations');
    expect(sql).not.toContain('rider_wallet_entries');
    expect(schema).toContain('RIDER_ASSIGNED');
    expect(schema).toContain('serviceClass ServiceClass? @map("service_class")');
  });
});
