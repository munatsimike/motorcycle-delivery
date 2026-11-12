import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('rider wallet migration', () => {
  it('adds wallets and configuration without crediting existing riders', () => {
    const names = readdirSync('prisma/migrations');
    const phase = names.filter((name) => name.endsWith('_rider_wallets'));
    expect(phase).toEqual(['20261014100000_rider_wallets']);
    const statements = readFileSync(`prisma/migrations/${phase[0]}/migration.sql`, 'utf8')
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');

    expect(statements).toContain('CREATE TABLE "rider_wallets"');
    expect(statements).toContain('CREATE TABLE "rider_wallet_entries"');
    expect(statements).toContain('CREATE TABLE "wallet_configs"');
    expect(statements).toContain('CREATE TABLE "wallet_payments"');
    expect(statements).toContain('CREATE TABLE "wallet_top_up_requests"');
    expect(statements).toContain('CREATE TABLE "wallet_fee_reservations"');
    expect(statements).toContain('wallet_configs_one_active_idx');
    expect(statements).toContain('rider_wallet_entries_append_only');
    expect(statements).toContain('rider_wallet_entries_one_welcome_bonus_idx');
    expect(statements).toContain("'APPROVED'");
    expect(statements).toContain("'SUSPENDED'");
    expect(statements).toContain('1.00');
    expect(statements).toContain('0.30');
    expect(statements).toContain('INSERT INTO "rider_wallets"');
    expect(statements).not.toContain('INSERT INTO "rider_wallet_entries"');
    expect(statements).not.toContain('INSERT INTO "wallet_payments"');
    expect(statements).not.toContain('INSERT INTO "wallet_fee_reservations"');
    expect(statements).not.toContain('DROP CONSTRAINT');
    expect(statements).not.toContain('DROP TABLE');
    expect(statements).not.toContain('delivery_assignments_motorcycle_owner_fkey');
    expect(statements).not.toContain('rider_licence_reviews_image_owner_fkey');
    expect(statements).not.toContain('deliveries_price_nonnegative_chk');
  });

  it('separates future promotional credit without rewriting historical wallet rows', () => {
    const statements = readFileSync('prisma/migrations/20261029180000_promotional_wallet_balance/migration.sql', 'utf8')
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    expect(statements).toContain('CREATE TABLE "rider_promotional_entries"');
    expect(statements).toContain('promotional_balance');
    expect(statements).toContain('500.00');
    expect(statements).toContain('default_borrowing_limit" = 500.00');
    expect(statements).not.toContain('UPDATE "rider_wallets"');
    expect(statements).not.toContain('UPDATE "rider_wallet_entries"');
    expect(statements).not.toContain('welcome_bonus_awarded_at');
    expect(statements).not.toContain('20261014100000');
  });
});
