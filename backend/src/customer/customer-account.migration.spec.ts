import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('customer account migration', () => {
  it('moves delivery ownership to customer accounts without dropping the SQL-only foreign keys', () => {
    const names = readdirSync('prisma/migrations');
    const phase = names.filter((name) => name.endsWith('_customer_accounts'));
    expect(phase).toEqual(['20261013210000_customer_accounts']);
    const statements = readFileSync(`prisma/migrations/${phase[0]}/migration.sql`, 'utf8')
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');

    expect(statements).toContain('customer_accounts_kind_chk');
    expect(statements).toContain('REFERENCES "customer_accounts"("id")');
    expect(statements).toContain('DROP CONSTRAINT "deliveries_customer_id_fkey"');
    expect(statements).not.toContain('delivery_assignments_motorcycle_owner_fkey');
    expect(statements).not.toContain('rider_licence_reviews_image_owner_fkey');
    expect(statements).not.toContain('users_passwordless_account_chk');
  });
});
