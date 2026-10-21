import type { LoginStart } from './auth.types';

export function readLoginStart(value: unknown): LoginStart {
  if (!isRecord(value) || (value.status !== 'pending' && value.status !== 'unavailable')) {
    throw new Error('Sign in could not be started.');
  }
  return { status: value.status };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
