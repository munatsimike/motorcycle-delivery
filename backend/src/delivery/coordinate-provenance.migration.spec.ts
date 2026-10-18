import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('delivery coordinate provenance migration', () => {
  const names = readdirSync('prisma/migrations');
  const phase = names.filter((name) => name.endsWith('_delivery_coordinate_provenance'));
  const statements = readFileSync(`prisma/migrations/${phase[0]}/migration.sql`, 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

  it('adds provenance without rewriting stored coordinates', () => {
    expect(phase).toEqual(['20261018180000_delivery_coordinate_provenance']);
    expect(statements).toContain('CREATE TYPE "coordinate_source"');
    expect(statements).toContain("'GOOGLE_PLACES'");
    expect(statements).toContain("'DEVICE_GEOCODER'");
    expect(statements).toContain("'UNREVIEWED'");
    expect(statements).toContain('ADD COLUMN "pickup_place_id"');
    expect(statements).toContain('ADD COLUMN "dropoff_place_id"');
    expect(statements).toContain('ADD COLUMN "pickup_coordinate_source"');
    expect(statements).toContain('ADD COLUMN "dropoff_coordinate_source"');
    expect(statements).toContain('ADD COLUMN "pickup_coordinate_retrieved_at"');
    expect(statements).toContain('ADD COLUMN "dropoff_coordinate_retrieved_at"');
    expect(statements).toContain('ALTER COLUMN "pickup_latitude" DROP NOT NULL');
    expect(statements).toContain('ALTER COLUMN "dropoff_longitude" DROP NOT NULL');
    expect(statements).not.toContain('UPDATE "deliveries"');
    expect(statements).not.toContain('SET "pickup_latitude"');
    expect(statements).not.toContain('DELETE FROM');
  });

  it('does not treat unreviewed rows as outside the retention check', () => {
    expect(statements).toContain('"pickup_coordinate_source" = \'UNREVIEWED\'');
    expect(statements).not.toContain('legacy');
  });
});

describe('coordinate retention lock migration', () => {
  const names = readdirSync('prisma/migrations');
  const phase = names.filter((name) => name.endsWith('_coordinate_retention_lock'));
  const statements = readFileSync(`prisma/migrations/${phase[0]}/migration.sql`, 'utf8');

  it('adds the lock and refresh attempt columns without rewriting coordinates', () => {
    expect(phase).toEqual(['20261018193000_coordinate_retention_lock']);
    expect(statements).toContain('pickup_coordinate_refresh_attempted_at');
    expect(statements).toContain('dropoff_coordinate_refresh_attempted_at');
    expect(statements).toContain('CREATE TABLE "coordinate_retention_lock"');
    expect(statements).not.toContain('UPDATE "deliveries"');
    expect(statements).not.toContain('DELETE FROM "deliveries"');
  });
});
