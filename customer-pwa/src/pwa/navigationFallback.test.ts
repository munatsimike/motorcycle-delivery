import assert from 'node:assert/strict';
import test from 'node:test';
import { navigationUsesAppShell } from './navigationFallback.ts';

test('the app shell fallback skips auth, admin, and customer API navigations', () => {
  assert.equal(navigationUsesAppShell('/book'), true);
  assert.equal(navigationUsesAppShell('/deliveries/delivery-1'), true);
  assert.equal(navigationUsesAppShell('/auth/session/refresh'), false);
  assert.equal(navigationUsesAppShell('/admin/'), false);
  assert.equal(navigationUsesAppShell('/customers/me/deliveries'), false);
});
