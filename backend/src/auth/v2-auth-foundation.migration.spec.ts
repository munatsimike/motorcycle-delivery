import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { v2MarketplaceEnabled } from './v2-flags.js';

const sql = readFileSync('prisma/migrations/20261023180000_v2_auth_foundation/migration.sql', 'utf8');
const whatsappSql = readFileSync('prisma/migrations/20261023200000_whatsapp_verification/migration.sql', 'utf8');
const offerSql = readFileSync('prisma/migrations/20261023010000_rider_offer_notifications/migration.sql', 'utf8');
const schema = readFileSync('prisma/schema.prisma', 'utf8');

describe('V2 auth foundation migration', () => {
  it('replaces the passwordless check and does not drop the one-accepted-per-rider index', () => {
    expect(sql).toContain('DROP CONSTRAINT "users_passwordless_account_chk"');
    expect(sql).toContain('ADD CONSTRAINT "users_account_credential_chk"');
    expect(sql).toContain('"password_hash" IS NOT NULL');
    expect(sql).toContain('"phone_verified_at" IS NOT NULL');
    expect(sql).toContain('delivery_assignments_one_accepted_per_rider_idx');
    expect(sql).not.toMatch(/DROP\s+(INDEX|CONSTRAINT)[^;]*delivery_assignments_one_accepted_per_rider_idx/);
    expect(sql).not.toContain('DROP INDEX');
    expect(sql).not.toContain('ALTER TABLE "deliveries" DROP');
    expect(sql).not.toContain('wallet_fee_reservations');
  });

  it('matches the authentication schema and leaves offer tables and V1 indexes alone', () => {
    expect(schema).toContain('whatsappConsentAt');
    expect(sql).toContain('CREATE TABLE "password_login_attempts"');
    expect(schema).not.toContain('model PasswordLoginAttempt');
    expect(schema).toContain('model Bid');
    expect(schema).toContain('model PricingWindow');
    expect(schema).toContain('model PricingConfigAudit');
    expect(schema).toContain('enum VerificationChannel');
    expect(schema).toContain('WHATSAPP_REGISTRATION');
    expect(schema).toContain('PASSWORD_RECOVERY');
    expect(schema).toContain('receivingRequests');
    expect(schema).toContain('serviceClass');
    expect(schema).toContain('deliverBy');
    expect(whatsappSql).toContain("ADD VALUE 'WHATSAPP_REGISTRATION'");
    expect(whatsappSql).toContain("ADD VALUE 'PASSWORD_RECOVERY'");
    expect(whatsappSql).toContain('ADD COLUMN "channel"');
    expect(whatsappSql).toContain('ADD COLUMN "whatsapp_consent_at"');
    expect(whatsappSql).not.toContain('DROP INDEX');
    expect(sql).not.toContain('rider_offer_notifications');
    expect(sql).not.toContain('rider_push_devices');
    expect(offerSql).not.toContain('users_account_credential_chk');
    expect(offerSql).not.toContain('DROP INDEX');
    expect(offerSql).not.toContain('delivery_assignments_one_accepted_per_rider_idx');
    expect(sql.includes('\r')).toBe(false);
    expect(whatsappSql.includes('\r')).toBe(false);
    const attributes = readFileSync('../.gitattributes', 'utf8');
    expect(attributes).toContain('backend/prisma/migrations/**/*.sql text eol=lf');
  });

  it('adds unused marketplace columns and keeps V2 disabled', () => {
    expect(sql).toContain('ADD COLUMN "receiving_requests" BOOLEAN');
    expect(sql).toContain('ADD COLUMN "service_class"');
    expect(sql).toContain('ADD COLUMN "deliver_by"');
    expect(sql).toContain('CREATE TABLE "bids"');
    expect(sql).toContain('CREATE TABLE "pricing_windows"');
    expect(sql).toContain('CREATE TABLE "pricing_config_audits"');
    expect(sql).toContain('"phone_hash" CHAR(64) NOT NULL');
    delete process.env.V2_MARKETPLACE_ENABLED;
    expect(v2MarketplaceEnabled()).toBe(false);
  });
});
