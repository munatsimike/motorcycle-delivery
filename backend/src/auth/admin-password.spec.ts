import {
  hashAdminPassword,
  verifyAdminPassword,
} from './admin-password.js';

describe('Admin password security', () => {
  it('hashes passwords using Argon2id', async () => {
    const password = 'SecureAdminPassword123!';
    const passwordHash = await hashAdminPassword(password);

    expect(passwordHash).toMatch(/^\$argon2id\$/);
    expect(passwordHash).not.toBe(password);
  });

  it('verifies the correct password', async () => {
    const password = 'SecureAdminPassword123!';
    const passwordHash = await hashAdminPassword(password);

    expect(await verifyAdminPassword(passwordHash, password)).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const passwordHash = await hashAdminPassword('SecureAdminPassword123!');

    expect(
      await verifyAdminPassword(passwordHash, 'WrongPassword123!'),
    ).toBe(false);
  });

  it('rejects passwords shorter than 12 characters', async () => {
    await expect(hashAdminPassword('short')).rejects.toThrow();
  });

  it('rejects invalid password hashes', async () => {
    expect(
      await verifyAdminPassword('invalid-hash', 'SecureAdminPassword123!'),
    ).toBe(false);
  });
});
