import { hash, verify, argon2id } from 'argon2';

const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_MAX_LENGTH = 128;

export async function hashAdminPassword(password: string): Promise<string> {
  validateAdminPassword(password);

  return hash(password, {
    type: argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
}

export async function verifyAdminPassword(
  passwordHash: string,
  password: string,
): Promise<boolean> {
  if (
    typeof password !== 'string' ||
    password.length > PASSWORD_MAX_LENGTH ||
    password.length === 0
  ) {
    return false;
  }

  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

function validateAdminPassword(password: string): void {
  if (
    typeof password !== 'string' ||
    password.length < PASSWORD_MIN_LENGTH ||
    password.length > PASSWORD_MAX_LENGTH
  ) {
    throw new Error('Admin password must contain 12 to 128 characters');
  }
}
