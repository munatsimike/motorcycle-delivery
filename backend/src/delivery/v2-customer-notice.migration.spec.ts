import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync('prisma/migrations/20261024180000_v2_customer_notices/migration.sql', 'utf8');
const failureSql = readFileSync('prisma/migrations/20261024190000_v2_notice_failure/migration.sql', 'utf8');
const schema = readFileSync('prisma/schema.prisma', 'utf8');
const reminder = readFileSync('src/delivery/v2-deadline-reminder.ts', 'utf8');
const sender = readFileSync('src/delivery/v2-outbox-sender.service.ts', 'utf8');

describe('V2 customer notice migration', () => {
  it('adds the customer outbox types, claim lease, and a separate FCM device table', () => {
    expect(sql.includes('\r')).toBe(false);
    expect(sql).toContain("ADD VALUE IF NOT EXISTS 'COLLECTING'");
    expect(sql).toContain("ADD VALUE IF NOT EXISTS 'COLLECTED'");
    expect(sql).toContain("ADD VALUE IF NOT EXISTS 'OUT_FOR_DELIVERY'");
    expect(sql).toContain("ADD VALUE IF NOT EXISTS 'DELIVERED'");
    expect(sql).toContain("ADD VALUE IF NOT EXISTS 'DEADLINE_REMINDER'");
    expect(sql).toContain('ADD COLUMN "claimed_at"');
    expect(sql).toContain('ADD COLUMN "claim_token"');
    expect(sql).toContain('ADD COLUMN "next_attempt_at"');
    expect(sql).toContain('CREATE TABLE "customer_fcm_devices"');
    expect(sql).toContain('"event_type" <> \'BID_ACCEPTED\'::"v2_outbox_event_type"');
    expect(sql).not.toContain('CREATE TABLE "delivery_progress_commands"');
    expect(sql).not.toContain('INSERT INTO');
    expect(sql.split('\n').some((line) => line.trimStart().startsWith('UPDATE'))).toBe(false);
    expect(schema).toContain('model CustomerFcmDevice');
    expect(schema).toContain('DEADLINE_REMINDER');
    expect(reminder).toContain('ON CONFLICT ("assignment_id", "event_type") DO NOTHING');
    expect(reminder).not.toContain('UPDATE "deliveries"');
    expect(sender).toContain('FOR UPDATE SKIP LOCKED');
    expect(sender).not.toContain('rider_offer');
    expect(sender).not.toContain('delivery.update');
    expect(failureSql.includes('\r')).toBe(false);
    expect(failureSql).toContain("ADD VALUE IF NOT EXISTS 'FAILED'");
    expect(failureSql).toContain('ADD COLUMN "last_failure"');
    expect(failureSql).toContain('ADD COLUMN "last_attempt_at"');
    expect(failureSql).toContain('ADD COLUMN "failed_at"');
    expect(failureSql).not.toContain('INSERT INTO');
    expect(failureSql.split('\n').some((line) => line.trimStart().startsWith('UPDATE'))).toBe(false);
    expect(schema).toContain('FAILED');
    expect(sender).toContain('Exactly-once push delivery is not guaranteed');
  });
});
