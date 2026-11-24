import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BUTTON_LOADING_LABEL,
  beginAction,
  modalActionFeedback,
  pageActionFeedback,
  searchAgainControl,
} from './buttonState.ts';

test('page actions use one spinner label with three dots only while they are running', () => {
  for (const label of Object.values(BUTTON_LOADING_LABEL)) {
    assert.equal(label.endsWith('...'), true);
    assert.equal(label.includes('…'), false);
    assert.equal(label.split('...').length, 2);
  }
  assert.equal(pageActionFeedback('search', false), null);
  assert.deepEqual(pageActionFeedback('cancel', true), { label: 'Cancelling...', spinner: true });
  assert.deepEqual(pageActionFeedback('delete', true), { label: 'Deleting...', spinner: true });
  assert.deepEqual(pageActionFeedback('loadMore', true), { label: 'Loading...', spinner: true });
  assert.equal(pageActionFeedback('loadMore', false), null);
  assert.equal(pageActionFeedback('retry', false), null);
  assert.equal(pageActionFeedback('signIn', true)?.label, 'Signing in...');
  assert.equal(pageActionFeedback('verify', true)?.label, 'Verifying...');
  assert.equal(pageActionFeedback('createAccount', true)?.label, 'Creating account...');
  assert.equal(pageActionFeedback('sendCode', true)?.label, 'Sending code...');
  assert.equal(modalActionFeedback('save', true)?.spinner, false);
});

test('open confirmation dialogs name the action and do not use a spinner', () => {
  assert.deepEqual(modalActionFeedback('choose', true), { label: 'Confirming...', spinner: false });
  assert.deepEqual(modalActionFeedback('decline', true), { label: 'Declining...', spinner: false });
  assert.deepEqual(modalActionFeedback('save', true), { label: 'Saving...', spinner: false });
  assert.equal(modalActionFeedback('search', false), null);
});

test('a running action cannot be started again', () => {
  assert.equal(beginAction(false), true);
  assert.equal(beginAction(true), false);
});

test('search again stays quiet during cooldown and other work', () => {
  assert.deepEqual(searchAgainControl({ searching: false, busy: false, coolingDown: true }), {
    feedback: null,
    disabled: true,
  });
  assert.deepEqual(searchAgainControl({ searching: false, busy: true, coolingDown: false }), {
    feedback: null,
    disabled: true,
  });
  assert.deepEqual(searchAgainControl({ searching: true, busy: true, coolingDown: false }), {
    feedback: { label: 'Searching...', spinner: true },
    disabled: true,
  });
});

test('dark secondary buttons use the lighter primary token', () => {
  const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../styles/app.css'), 'utf8');
  assert.match(css, /\[data-theme="dark"\] \.button-secondary \{\s*color: var\(--primary\);/);
  assert.match(css, /\.button-secondary \{\s*background: var\(--surface\);\s*color: var\(--primary-dark\);/);
});
