import assert from 'node:assert/strict';
import test from 'node:test';
import { customerAvatarColors, customerInitials, customerPhotoFileIssue, profileKindLabel, profileRows } from './profile.ts';

test('profile shows the native account rows and initials', () => {
  assert.equal(customerInitials({ kind: 'INDIVIDUAL', name: 'Tariro Moyo' }), 'TM');
  assert.equal(customerInitials({ kind: 'BUSINESS', name: 'Carry' }), 'C');
  assert.equal(profileKindLabel('BUSINESS'), 'Business');
  assert.deepEqual(profileRows({
    phone: '+263771234567',
    email: 'tariro@example.com',
    contactName: 'Rudo',
    appearance: 'System default',
  }).map((row) => row.label), ['WhatsApp number', 'Email address', 'Contact person', 'Appearance']);
  assert.equal(customerAvatarColors('customer-1').backgroundColor.length > 0, true);
  assert.equal(customerPhotoFileIssue(0), 'Choose a profile photo');
  assert.equal(customerPhotoFileIssue(5 * 1024 * 1024 + 1), 'Profile photo is too large');
});
