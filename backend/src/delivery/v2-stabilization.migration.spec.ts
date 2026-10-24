import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync('prisma/migrations/20261024150000_v2_phase3_stabilization/migration.sql', 'utf8');

describe('V2 phase 3 stabilization migration', () => {
  it('stores the accepted bid and a durable outbox without dropping assignment history', () => {
    expect(sql.includes('\r')).toBe(false);
    expect(sql).toContain('ADD COLUMN "accepted_bid_id"');
    expect(sql).toContain('CREATE TABLE "v2_outbox_events"');
    expect(sql).toContain('v2_outbox_events_assignment_id_event_type_key');
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(sql).not.toContain('delivery_assignments_one_accepted_per_rider_idx');
    expect(sql).not.toContain('INSERT INTO');
    expect(sql).not.toContain('rider_offer');
  });
});
