import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  'prisma/migrations/20261014170000_assignment_fee_snapshot/migration.sql',
  'utf8',
);

function block(name: string): string {
  const start = sql.indexOf(`DO $${name}$`);
  const end = sql.indexOf(`$${name}$;`);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end);
}

describe('assignment fee snapshot migration', () => {
  const backfill = block('backfill_accepted_fee');
  const verification = block('verify_accepted_fee');

  it('adds nullable snapshot columns before backfill and the check', () => {
    const columns = sql.indexOf('ADD COLUMN "accepted_platform_fee" DECIMAL(12,2)');
    const version = sql.indexOf('ADD COLUMN "accepted_fee_config_version" INTEGER');
    const constraint = sql.indexOf('ADD CONSTRAINT "delivery_assignments_accepted_fee_chk"');
    expect(columns).toBeGreaterThanOrEqual(0);
    expect(version).toBeGreaterThan(columns);
    expect(sql.indexOf('DO $backfill_accepted_fee$')).toBeGreaterThan(version);
    expect(sql.indexOf('DO $verify_accepted_fee$')).toBeGreaterThan(sql.indexOf('$backfill_accepted_fee$;'));
    expect(constraint).toBeGreaterThan(sql.indexOf('$verify_accepted_fee$;'));
    expect(sql).toContain('"accepted_platform_fee" >= 0');
    expect(sql).toContain('"accepted_fee_config_version" >= 1');
    expect(sql).toContain('Do not drop delivery_assignments_motorcycle_owner_fkey');
    expect(sql).not.toContain('DROP CONSTRAINT');
    expect(sql).not.toContain('DROP TABLE');
    expect(sql).not.toContain('DROP INDEX');
    expect(sql).not.toContain('INSERT INTO');
    expect(sql).not.toMatch(/UPDATE\s+"wallet_fee_reservations"/);
    expect(sql).not.toMatch(/UPDATE\s+"rider_wallets"/);
    expect(sql).not.toMatch(/UPDATE\s+"rider_wallet_entries"/);
    expect(sql).not.toMatch(/UPDATE\s+"deliveries"/);
  });

  it('copies the one matching reservation, including released and captured rows', () => {
    expect(backfill).toContain(`"status" IN ('ACCEPTED', 'RELEASED', 'COMPLETED', 'FAILED')`);
    expect(backfill).toContain('reservation."delivery_id" = historical.delivery_id');
    expect(backfill).toContain('wallet."rider_profile_id" = historical.rider_profile_id');
    expect(backfill).toContain('wallet."id" = reservation."rider_wallet_id"');
    expect(backfill).not.toContain('reservation."status"');
    expect(sql).toContain('OPEN, RELEASED, and CAPTURED reservations are all eligible');
    expect(backfill).toContain('SELECT reservation."amount", reservation."config_version"');
    expect(backfill).toContain('"accepted_platform_fee" = reserved_amount');
    expect(backfill).toContain('"accepted_fee_config_version" = reserved_version');
    expect(backfill).toContain('WHERE "id" = historical.id');
    expect(backfill.indexOf('FOR historical IN')).toBeLessThan(backfill.indexOf('RAISE EXCEPTION'));
    expect(verification).toContain('accepted delivery assignments exist without a platform fee snapshot');
    expect(verification).toContain('"accepted_platform_fee" IS NULL');
    expect(verification).toContain('"accepted_fee_config_version" < 1');
  });

  it('rejects a missing reservation and more than one matching reservation', () => {
    expect(backfill).toContain('IF match_count = 0 THEN');
    expect(backfill).toContain('has no matching platform fee reservation');
    expect(backfill).toContain('IF match_count <> 1 THEN');
    expect(backfill).toContain('has % matching platform fee reservations');
    expect(backfill.indexOf('has no matching platform fee reservation')).toBeLessThan(
      backfill.indexOf('UPDATE "delivery_assignments"'),
    );
    expect(backfill.indexOf('has % matching platform fee reservations')).toBeLessThan(
      backfill.indexOf('UPDATE "delivery_assignments"'),
    );
  });
});
