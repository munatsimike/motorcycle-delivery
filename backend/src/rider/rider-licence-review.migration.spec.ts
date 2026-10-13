import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('rider licence review migration', () => {
  it('adds the ownership foreign key and append-only trigger without dropping the motorcycle owner key', () => {
    const names = readdirSync('prisma/migrations');
    const phase = names.filter((name) => name.endsWith('_rider_licence_reviews'));
    expect(phase).toEqual(['20261013200000_rider_licence_reviews']);
    const sql = readFileSync(`prisma/migrations/${phase[0]}/migration.sql`, 'utf8');

    const statements = sql
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    expect(statements).toContain('rider_licence_reviews_image_owner_fkey');
    expect(statements).toContain('rider_licence_reviews_append_only');
    expect(statements).toContain('rider_licence_reviews_decision_chk');
    expect(statements.toUpperCase()).not.toContain('DROP CONSTRAINT');
    expect(statements).not.toContain('delivery_assignments');
  });
});
