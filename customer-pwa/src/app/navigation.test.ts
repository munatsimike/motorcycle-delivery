import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isProtectedPath,
  showsTabBar,
  visibleTree,
  signedInDestination,
  signedOutDestination,
} from './navigation.ts';

test('signed-out customers cannot open protected pages', () => {
  for (const path of ['/home', '/deliveries', '/deliveries/parcel-1', '/profile', '/book']) {
    assert.equal(isProtectedPath(path), true);
    assert.equal(signedOutDestination(path), '/sign-in');
    assert.equal(showsTabBar(path) && signedOutDestination(path) === null, false);
  }
  assert.equal(signedOutDestination('/'), null);
  assert.equal(signedOutDestination('/sign-in'), null);
  assert.equal(signedOutDestination('/create-account'), null);
});

test('an unauthenticated booking visit returns to Send a Parcel after sign-in', () => {
  assert.equal(isProtectedPath('/book'), true);
  assert.equal(signedOutDestination('/book'), '/sign-in');
  assert.equal(showsTabBar('/book'), false);
  assert.equal(signedInDestination('/book'), null);
});

test('a signed-in customer opening the welcome address reaches Home', () => {
  assert.equal(signedInDestination('/'), '/home');
  assert.equal(signedInDestination('/sign-in'), '/home');
  assert.equal(signedInDestination('/create-account'), '/home');
  assert.equal(signedInDestination('/home'), null);
});

test('bottom navigation is only on the three main tabs', () => {
  assert.equal(showsTabBar('/home'), true);
  assert.equal(showsTabBar('/deliveries'), true);
  assert.equal(showsTabBar('/profile'), true);
  assert.equal(showsTabBar('/book'), false);
  assert.equal(showsTabBar('/deliveries/parcel-1'), false);
  assert.equal(showsTabBar('/'), false);
  assert.equal(showsTabBar('/sign-in'), false);
});

test('session restoration stays on the session check instead of a protected screen', () => {
  assert.equal(visibleTree('loading'), 'session-check');
  assert.notEqual(visibleTree('loading'), 'signed-in');
  assert.equal(visibleTree('signed-out'), 'signed-out');
  assert.equal(visibleTree('signed-in'), 'signed-in');
});
