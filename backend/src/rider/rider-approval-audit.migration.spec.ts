import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('rider approval audit migration', () => {
  it('adds an append-only approval history table without changing approval rules', () => {
    const names = readdirSync('prisma/migrations');
    const phase = names.filter((name) => name.endsWith('_rider_approval_audits'));
    expect(phase).toEqual(['20261102190000_rider_approval_audits']);
    const sql = readFileSync(`prisma/migrations/${phase[0]}/migration.sql`, 'utf8');
    const statements = sql
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');

    expect(statements).toContain('CREATE TABLE "rider_approval_audits"');
    expect(statements).toContain('rider_approval_audits_action_chk');
    expect(statements).toContain('rider_approval_audits_append_only');
    expect(statements).toContain("'APPROVE'");
    expect(statements).toContain("'SUSPEND'");
    expect(statements.toUpperCase()).not.toContain('DROP TABLE');
    expect(statements).not.toContain('password');
    expect(statements).not.toContain('refresh');
    expect(statements).not.toContain('licence_image');
  });
});
