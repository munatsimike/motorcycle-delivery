import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { AuthPurpose } from '../generated/prisma/client.js';

export const PRIVATE_TEST_CODE = '000000';
const SID_PREFIX = 'private-test-auth:';

export function privateTestAuthEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PRIVATE_TEST_AUTH_ENABLED === 'true';
}

export function privateTestChallengeAllowed(
  purpose: AuthPurpose,
  user: { privateTestAccount: boolean } | null,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!privateTestAuthEnabled(env)) {
    return false;
  }
  if (user?.privateTestAccount === true) {
    return true;
  }
  return !user && purpose === AuthPurpose.WHATSAPP_REGISTRATION;
}

export function stampPrivateTestChallenge(input: {
  challengeId: string;
  phone: string;
  purpose: string;
}): { sid: string; codeHash: string } {
  return {
    sid: `${SID_PREFIX}${randomBytes(16).toString('hex')}`,
    codeHash: privateTestCodeHash({ ...input, code: PRIVATE_TEST_CODE }),
  };
}

export function isPrivateTestChallenge(sid: string | null | undefined): boolean {
  return typeof sid === 'string' && sid.startsWith(SID_PREFIX);
}

export function privateTestCodeMatches(
  code: string,
  challenge: { id: string; phone: string; purpose: string; twilioSid: string | null; codeHash: string | null },
): boolean {
  if (!isPrivateTestChallenge(challenge.twilioSid) || !challenge.codeHash || !/^[a-f0-9]{64}$/i.test(challenge.codeHash)) {
    return false;
  }
  const actual = Buffer.from(privateTestCodeHash({
    challengeId: challenge.id,
    phone: challenge.phone,
    purpose: challenge.purpose,
    code,
  }), 'hex');
  const expected = Buffer.from(challenge.codeHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function privateTestCodeHash(input: {
  challengeId: string;
  phone: string;
  purpose: string;
  code: string;
}): string {
  return createHash('sha256')
    .update(`${input.challengeId}\0${input.phone}\0${input.purpose}\0${input.code}`)
    .digest('hex');
}
