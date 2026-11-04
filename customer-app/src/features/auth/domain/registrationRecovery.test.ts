import { describe, expect, it } from 'vitest';

import {
  createSingleFlight,
  formSeed,
  proofValidUntil,
  registrationAfterHardwareBack,
  registrationAfterSubmissionFailure,
  registrationDestination,
  storeProof,
  verifiedRegistrationPhone,
  withRegistrationDraft,
  type RegistrationDraft,
  type RegistrationRecoveryState,
} from './registrationRecovery';

const NOW = Date.parse('2026-11-01T12:00:00.000Z');
const FIFTEEN_MINUTES = 15 * 60_000;

describe('customer registration recovery', () => {
  it('reads the verified number from the registration proof', () => {
    const payload = Buffer.from(JSON.stringify({ exp: 1, phone: '+263771234567' })).toString('base64url');
    expect(verifiedRegistrationPhone(`header.${payload}.signature`)).toBe('+263771234567');
    expect(verifiedRegistrationPhone('not-a-proof')).toBeNull();
  });

  it('restores the registration form when the app restarts before submission and the proof is still valid', () => {
    const proof = storeProof(proofToken(NOW + FIFTEEN_MINUTES));
    const draft = { fullName: 'Rudo Ncube', address: '4 Jason Moyo' };
    expect(proof).not.toBeNull();
    expect(registrationDestination(proof, draft, NOW + 60_000)).toEqual({
      kind: 'form',
      registrationToken: proof!.registrationToken,
      fullName: draft.fullName,
      address: draft.address,
    });
  });

  it('requires a new code after the proof expires and keeps the draft', () => {
    const proof = storeProof(proofToken(NOW + FIFTEEN_MINUTES));
    const draft = { fullName: 'Rudo Ncube', address: '4 Jason Moyo' };
    const destination = registrationDestination(proof, draft, NOW + FIFTEEN_MINUTES + 6_000);
    expect(destination).toEqual({ kind: 'otp', fullName: draft.fullName, address: draft.address });
  });

  it('does not extend the original proof expiry when a later date is stored beside it', () => {
    const token = proofToken(NOW + FIFTEEN_MINUTES);
    const proof = storeProof(token);
    expect(proof).not.toBeNull();
    const tampered = { ...proof!, expiresAt: new Date(NOW + 24 * 60 * 60_000).toISOString() };
    expect(proofValidUntil(tampered)).toBe(NOW + FIFTEEN_MINUTES);
    expect(registrationDestination(tampered, emptyDraft(), NOW + FIFTEEN_MINUTES + 6_000).kind).toBe('otp');
  });

  it('keeps the form and proof when submission is interrupted by the network', () => {
    const state = savedState();
    const next = registrationAfterSubmissionFailure('interrupted', state);
    expect(next.stayOnForm).toBe(true);
    expect(next.state).toEqual(state);
  });

  it('ignores a second submission while the first is still running', () => {
    const flight = createSingleFlight();
    expect(flight.enter()).toBe(true);
    expect(flight.enter()).toBe(false);
    flight.leave();
    expect(flight.enter()).toBe(true);
  });

  it('clears the proof after a rejected completion and keeps the typed draft', () => {
    const next = registrationAfterSubmissionFailure('rejected', savedState());
    expect(next.stayOnForm).toBe(false);
    expect(next.state.proof).toBeNull();
    expect(next.state.draft).toEqual({ fullName: 'Rudo Ncube', address: '4 Jason Moyo' });
  });

  it('keeps the proof and draft when Android back leaves the registration screen', () => {
    const state = savedState();
    const afterBack = registrationAfterHardwareBack(state);
    expect(afterBack).toEqual(state);
    expect(registrationDestination(afterBack.proof, afterBack.draft, NOW).kind).toBe('form');
  });

  it('saves a new proof with its own expiry and does not keep the previous one', () => {
    const first = storeProof(proofToken(NOW + FIFTEEN_MINUTES));
    const second = storeProof(proofToken(NOW + 5 * 60_000));
    expect(first?.expiresAt).not.toBe(second?.expiresAt);
    expect(proofValidUntil(second!)).toBe(NOW + 5 * 60_000);
  });

  it('prefills a new code with the saved draft instead of replacing it', () => {
    expect(formSeed(
      { fullName: 'Rudo Ncube', address: '4 Jason Moyo' },
      { fullName: 'Server Name', address: null },
    )).toEqual({ fullName: 'Rudo Ncube', address: '4 Jason Moyo' });
  });

  it('uses the server name when the draft is empty', () => {
    expect(formSeed(emptyDraft(), { fullName: 'Rudo Ncube', address: '4 Jason Moyo' })).toEqual({
      fullName: 'Rudo Ncube',
      address: '4 Jason Moyo',
    });
  });

  it('updates the draft without changing the saved proof', () => {
    const state = savedState();
    const next = withRegistrationDraft(state, { fullName: 'Chipo Dube', address: '12 First Street' });
    expect(next.proof).toBe(state.proof);
    expect(next.draft.fullName).toBe('Chipo Dube');
  });
});

function savedState(): RegistrationRecoveryState {
  return {
    proof: storeProof(proofToken(NOW + FIFTEEN_MINUTES)),
    draft: { fullName: 'Rudo Ncube', address: '4 Jason Moyo' },
  };
}

function emptyDraft(): RegistrationDraft {
  return { fullName: '', address: '' };
}

function proofToken(expiresAtMs: number): string {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(expiresAtMs / 1000) })).toString('base64url');
  return `header.${payload}.signature`;
}
