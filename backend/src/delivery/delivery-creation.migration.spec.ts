import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('customer delivery creation migration', () => {
  it('adds pricing configuration without dropping existing delivery protections', () => {
    const names = readdirSync('prisma/migrations');
    const phase = names.filter((name) => name.endsWith('_customer_delivery_creation'));
    expect(phase).toEqual(['20261013220000_customer_delivery_creation']);
    const statements = readFileSync(`prisma/migrations/${phase[0]}/migration.sql`, 'utf8')
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');

    expect(statements).toContain('CREATE TABLE "delivery_pricing_configs"');
    expect(statements).toContain('delivery_pricing_configs_one_active_idx');
    expect(statements).toContain('deliveries_suggested_price_nonnegative_chk');
    expect(statements).toContain('deliveries_creation_text_chk');
    expect(statements).not.toContain('INSERT INTO "delivery_pricing_configs"');
    expect(statements).not.toContain('DROP CONSTRAINT');
    expect(statements).not.toContain('delivery_assignments_motorcycle_owner_fkey');
    expect(statements).not.toContain('rider_licence_reviews_image_owner_fkey');
    expect(statements).not.toContain('deliveries_price_nonnegative_chk');
  });
});
