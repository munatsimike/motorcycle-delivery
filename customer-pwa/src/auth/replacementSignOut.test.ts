import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  clearReplacementSignOut,
  isReplacementSignOut,
  rememberReplacementSignOut,
  replacementSignOutPending,
} from './replacementSignOut.ts';

test('a replacement sign-out is separate from expiry, logout, and network loss', () => {
  clearReplacementSignOut();
  assert.equal(isReplacementSignOut(new Error('Authentication failed.')), false);
  assert.equal(isReplacementSignOut(new Error('Network request failed. Check your connection and try again.')), false);
  assert.equal(isReplacementSignOut(new Error('The request timed out. Check your connection and try again.')), false);
  rememberReplacementSignOut(new Error('Authentication failed.'));
  assert.equal(replacementSignOutPending(), false);

  rememberReplacementSignOut(new Error('Your account was signed in on another device. Please sign in again to continue.'));
  assert.equal(replacementSignOutPending(), true);
  clearReplacementSignOut();
  assert.equal(replacementSignOutPending(), false);
});
