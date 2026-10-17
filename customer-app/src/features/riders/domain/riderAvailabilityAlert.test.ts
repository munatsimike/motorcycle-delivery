import { describe, expect, it } from 'vitest';
import {
  decideNotificationPermission,
  readCreateRiderAlertResult,
  readRiderAlert,
} from './riderAvailabilityAlert';

describe('rider availability alert responses', () => {
  it('requests notification permission once and stops after denial', () => {
    expect(decideNotificationPermission('granted')).toBe('use-token');
    expect(decideNotificationPermission('undetermined')).toBe('request');
    expect(decideNotificationPermission('denied')).toBe('denied');
  });

  it('reads a saved alert and a riders-already-available response', () => {
    expect(readRiderAlert({ alert: null })).toBeNull();
    expect(readRiderAlert({ alert: { status: 'active', expiresAt: '2026-10-16T12:30:00.000Z' } })).toEqual({
      status: 'active',
      expiresAt: '2026-10-16T12:30:00.000Z',
    });
    expect(readCreateRiderAlertResult({ result: 'active', expiresAt: '2026-10-16T12:30:00.000Z' })).toEqual({
      result: 'active',
      expiresAt: '2026-10-16T12:30:00.000Z',
    });
    expect(readCreateRiderAlertResult({ result: 'riders-available', count: 2 })).toEqual({
      result: 'riders-available',
      count: 2,
    });
    expect(() => readCreateRiderAlertResult({ result: 'active' })).toThrow('Invalid response from server.');
    expect(() => readRiderAlert({})).toThrow('Invalid response from server.');
  });
});
