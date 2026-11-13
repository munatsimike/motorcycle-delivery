import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appearanceLabel,
  parseAppearanceMode,
  profileSignOutRequest,
  readStoredAppearance,
  resolvedScheme,
  writeStoredAppearance,
} from './appearance.ts';

test('appearance preference is saved and restored', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
  assert.equal(readStoredAppearance(storage), 'system');
  writeStoredAppearance(storage, 'dark');
  assert.equal(readStoredAppearance(storage), 'dark');
  assert.equal(parseAppearanceMode('nope'), 'system');
});

test('system appearance follows the device scheme', () => {
  assert.equal(resolvedScheme('system', 'dark'), 'dark');
  assert.equal(resolvedScheme('system', 'light'), 'light');
  assert.equal(resolvedScheme('light', 'dark'), 'light');
  assert.equal(resolvedScheme('dark', 'light'), 'dark');
  assert.equal(appearanceLabel('system'), 'System default');
  assert.equal(appearanceLabel('light'), 'Light');
  assert.equal(appearanceLabel('dark'), 'Dark');
});

test('sign-out returns to welcome and marks the account as left', () => {
  assert.deepEqual(profileSignOutRequest(), { path: '/', replace: true, leftAccount: true });
});
