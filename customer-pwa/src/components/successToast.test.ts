import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SUCCESS_TOAST_DISMISS_MS,
  acceptToast,
  currentSuccessToast,
  deliveryCancelledToast,
  dismissSuccessToast,
  resetSuccessToastForTests,
  riderConfirmedToast,
  showSuccessToast,
  toastDismissed,
} from './successToast.ts';

test('a success toast is accepted once and dismissed after three seconds', () => {
  resetSuccessToastForTests();
  const consumed = new Set<string>();
  assert.equal(acceptToast('  ', consumed), null);
  assert.equal(acceptToast('delivery-cancelled:1', consumed), 'delivery-cancelled:1');
  consumed.add('delivery-cancelled:1');
  assert.equal(acceptToast('delivery-cancelled:1', consumed), null);
  assert.equal(acceptToast('rider-confirmed:1', consumed), 'rider-confirmed:1');
  assert.equal(toastDismissed(1_000, 3_999), false);
  assert.equal(toastDismissed(1_000, 1_000 + SUCCESS_TOAST_DISMISS_MS), true);
});

test('cancellation and rider confirmation each show once and stay until dismissed', () => {
  resetSuccessToastForTests();
  assert.equal(showSuccessToast({ id: 'delivery-cancelled:1', message: '   ' }), false);
  assert.equal(currentSuccessToast(), null);
  assert.equal(showSuccessToast(deliveryCancelledToast('1')), true);
  assert.deepEqual(currentSuccessToast(), { id: 'delivery-cancelled:1', message: 'Delivery cancelled' });
  assert.equal(showSuccessToast(deliveryCancelledToast('1')), false);
  assert.equal(currentSuccessToast()?.message, 'Delivery cancelled');
  dismissSuccessToast('someone-else');
  assert.equal(currentSuccessToast()?.id, 'delivery-cancelled:1');
  dismissSuccessToast('delivery-cancelled:1');
  assert.equal(currentSuccessToast(), null);
  assert.equal(showSuccessToast(deliveryCancelledToast('1')), false);
  assert.equal(showSuccessToast(riderConfirmedToast('1')), true);
  assert.deepEqual(currentSuccessToast(), { id: 'rider-confirmed:1', message: 'Rider confirmed!' });
});
