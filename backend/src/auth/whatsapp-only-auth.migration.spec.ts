import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync('prisma/migrations/20261024220000_customer_rider_whatsapp_only/migration.sql', 'utf8');

describe('customer and rider WhatsApp-only credential migration', () => {
  it('clears customer and rider passwords and keeps the shared admin hash column', () => {
    expect(sql).toContain('SET "password_hash" = NULL');
    expect(sql).toContain("'CUSTOMER'");
    expect(sql).toContain("'RIDER'");
    expect(sql).toContain("\"role\" = 'ADMIN'::\"user_role\"");
    expect(sql).toContain('DROP CONSTRAINT "users_account_credential_chk"');
    expect(sql).toContain('ADD CONSTRAINT "users_account_credential_chk"');
    expect(sql).toContain('"password_hash" IS NULL');
    expect(sql).toContain('"phone_verified_at" IS NOT NULL');
    expect(sql).toContain('DROP TABLE "password_login_attempts"');
    expect(sql).not.toContain('DROP TABLE "users"');
    expect(sql).not.toContain('ALTER TABLE "users" DROP COLUMN "password_hash"');
    expect(sql.includes('\r')).toBe(false);
  });
});
