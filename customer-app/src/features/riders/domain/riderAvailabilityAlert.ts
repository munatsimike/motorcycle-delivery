export type RiderAlertRecord = {
  status: 'active';
  expiresAt: string;
};

export type CreateRiderAlertResult =
  | { result: 'active'; expiresAt: string }
  | { result: 'riders-available'; count: number };

export function decideNotificationPermission(status: string): 'use-token' | 'request' | 'denied' {
  if (status === 'granted') return 'use-token';
  if (status === 'undetermined') return 'request';
  return 'denied';
}

export function readRiderAlert(body: unknown): RiderAlertRecord | null {
  if (!body || typeof body !== 'object' || !('alert' in body)) {
    throw new Error('Invalid response from server.');
  }
  const alert = body.alert;
  if (alert === null) {
    return null;
  }
  if (!isActiveAlert(alert)) {
    throw new Error('Invalid response from server.');
  }
  return { status: 'active', expiresAt: alert.expiresAt };
}

export function readCreateRiderAlertResult(body: unknown): CreateRiderAlertResult {
  if (!body || typeof body !== 'object' || !('result' in body)) {
    throw new Error('Invalid response from server.');
  }
  const record = body as { result?: unknown; expiresAt?: unknown; count?: unknown };
  if (record.result === 'active' && typeof record.expiresAt === 'string' && record.expiresAt.trim()) {
    return { result: 'active', expiresAt: record.expiresAt };
  }
  if (record.result === 'riders-available' && Number.isInteger(record.count) && Number(record.count) > 0) {
    return { result: 'riders-available', count: Number(record.count) };
  }
  throw new Error('Invalid response from server.');
}

function isActiveAlert(value: unknown): value is { status: 'active'; expiresAt: string } {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as { status?: unknown; expiresAt?: unknown };
  return record.status === 'active' && typeof record.expiresAt === 'string' && record.expiresAt.trim().length > 0;
}
