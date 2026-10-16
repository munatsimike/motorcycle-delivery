import { describe, expect, it } from 'vitest';

import { colors } from '../../../theme';
import { customerAvatarColors, customerInitials } from './customerAvatar';

describe('customerInitials', () => {
  it('uses the first and last initials of an individual full name', () => {
    expect(customerInitials({ kind: 'INDIVIDUAL', name: 'Rudo Ncube' })).toBe('RN');
  });

  it('uses one initial when an individual has a single name', () => {
    expect(customerInitials({ kind: 'INDIVIDUAL', name: 'Rudo' })).toBe('R');
  });

  it('uses the first and last initials of a business name', () => {
    expect(customerInitials({ kind: 'BUSINESS', name: 'Moyo Deliveries' })).toBe('MD');
  });

  it('uses the first and last words when a name has more than two parts', () => {
    expect(customerInitials({ kind: 'INDIVIDUAL', name: 'Mary Ann Smith' })).toBe('MS');
  });

  it('ignores extra spaces and lowercase letters', () => {
    expect(customerInitials({ kind: 'INDIVIDUAL', name: '  rudo   ncube  ' })).toBe('RN');
  });

  it('falls back to R when no name is available', () => {
    expect(customerInitials({ kind: 'INDIVIDUAL', name: null })).toBe('R');
    expect(customerInitials({ kind: 'BUSINESS', name: '   ' })).toBe('R');
    expect(customerInitials({ kind: 'BUSINESS', name: '123' })).toBe('R');
  });
});

describe('customerAvatarColors', () => {
  it('keeps the same theme color for the same customer', () => {
    expect(customerAvatarColors('customer-1')).toEqual(customerAvatarColors('customer-1'));
  });

  it('uses a neutral color when the customer id is missing', () => {
    expect(customerAvatarColors(null)).toEqual({
      backgroundColor: '#3D5A80',
      color: colors.textInverse,
    });
  });

  it('chooses a non-green avatar color', () => {
    const chosen = customerAvatarColors('customer-42');
    expect(['#3D5A80', '#C46B4A', '#6B5478', '#F3E6D8']).toContain(chosen.backgroundColor);
    expect(chosen.backgroundColor).not.toBe(colors.primary);
  });
});
