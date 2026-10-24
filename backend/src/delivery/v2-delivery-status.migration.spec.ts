import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync('prisma/migrations/20261024170000_v2_delivery_statuses/migration.sql', 'utf8');
const schema = readFileSync('prisma/schema.prisma', 'utf8');

describe('V2 delivery status migration', () => {
  it('adds the native V2 statuses and a separate progress idempotency table', () => {
    expect(sql.includes('\r')).toBe(false);
    expect(sql).toContain("ADD VALUE IF NOT EXISTS 'COLLECTING' AFTER 'RIDER_ASSIGNED'");
    expect(sql).toContain("ADD VALUE IF NOT EXISTS 'COLLECTED' AFTER 'COLLECTING'");
    expect(sql).toContain("ADD VALUE IF NOT EXISTS 'OUT_FOR_DELIVERY' AFTER 'COLLECTED'");
    expect(sql).toContain('CREATE TABLE "delivery_progress_commands"');
    expect(sql).toContain('CREATE UNIQUE INDEX "delivery_progress_commands_idempotency_key_key"');
    expect(sql).not.toContain('INSERT INTO');
    expect(sql.split('\n').some((line) => line.trimStart().startsWith('UPDATE'))).toBe(false);
    expect(schema).toContain('COLLECTING');
    expect(schema).toContain('COLLECTED');
    expect(schema).toContain('OUT_FOR_DELIVERY');
    expect(schema).toContain('model DeliveryProgressCommand');
  });
});
