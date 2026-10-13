import { createHash, randomBytes } from 'node:crypto';

export function hashSecret(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function newRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}
