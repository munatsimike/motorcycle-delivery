import { describe, expect, it } from 'vitest';

import {
  REGISTRATION_NAME_AND_ADDRESS,
  REGISTRATION_NAME_AND_SURNAME,
  REGISTRATION_NAME_LETTERS,
  collapseRegistrationName,
  registrationFullNameIssue,
} from './registrationName';

describe('registration full name', () => {
  it('accepts a name and surname and collapses extra spaces', () => {
    expect(registrationFullNameIssue('  Tendai   Moyo ', '12 First Street')).toBeNull();
    expect(collapseRegistrationName('  Tendai   Moyo ')).toBe('Tendai Moyo');
    expect(registrationFullNameIssue('Tendai Joe Moyo', '12 First Street')).toBeNull();
    expect(registrationFullNameIssue('Ann Moyo', '12 First Street')).toBeNull();
  });

  it('rejects a name or surname shorter than 3 letters', () => {
    expect(registrationFullNameIssue('Tendai M', '12 First Street')).toBe(REGISTRATION_NAME_LETTERS);
    expect(registrationFullNameIssue('Te Moyo', '12 First Street')).toBe(REGISTRATION_NAME_LETTERS);
  });

  it('rejects a single word', () => {
    expect(registrationFullNameIssue('Tendai', '12 First Street')).toBe(REGISTRATION_NAME_AND_SURNAME);
    expect(registrationFullNameIssue('  Tendai  ', '12 First Street')).toBe(REGISTRATION_NAME_AND_SURNAME);
  });

  it('still requires both the name and the address', () => {
    expect(registrationFullNameIssue('', '12 First Street')).toBe(REGISTRATION_NAME_AND_ADDRESS);
    expect(registrationFullNameIssue('Tendai Moyo', '   ')).toBe(REGISTRATION_NAME_AND_ADDRESS);
  });
});
