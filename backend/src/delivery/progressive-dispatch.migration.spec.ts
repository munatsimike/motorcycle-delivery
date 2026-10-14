import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('progressive dispatch migration', () => {
  const sql = readFileSync(
    'prisma/migrations/20261014160000_progressive_dispatch/migration.sql',
    'utf8',
  );

  it('adds GPS, rounds, and search generations without dropping existing protections', () => {
    expect(sql).toContain('geography(Point,4326)');
    expect(sql).toContain('USING GIST ("position")');
    expect(sql).toContain('CREATE TABLE "rider_locations"');
    expect(sql).toContain('CREATE TABLE "delivery_dispatch_rounds"');
    expect(sql).toContain('"radius_metres" = 2000');
    expect(sql).toContain('"radius_metres" = 5000');
    expect(sql).toContain('"radius_metres" = 10000');
    expect(sql).toContain('postgis_catalog_guard');
    expect(sql).toContain('ADD COLUMN "search_generation" INTEGER NOT NULL DEFAULT 0');
    expect(sql).not.toContain('DROP CONSTRAINT');
    expect(sql).not.toContain('DROP TABLE');
    expect(sql).not.toContain('DROP INDEX');
    expect(sql).not.toContain('delivery_assignments_motorcycle_owner_fkey');
    expect(sql).not.toContain('rider_wallet_entries_append_only');
    expect(sql).not.toContain('INSERT INTO "rider_wallet_entries"');
    expect(sql).not.toContain('INSERT INTO "wallet_fee_reservations"');
  });
});
