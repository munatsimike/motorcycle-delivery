import { RIDER_ALERT_PUSH } from './rider-availability-alert.constants.js';

export type PushOutcome = 'sent' | 'invalid-token' | 'retry';

type PushTicket = {
  status?: string;
  details?: { error?: string };
};

type PushResponse = {
  data?: PushTicket | PushTicket[];
  errors?: unknown[];
};

export type PushSender = {
  send(token: string): Promise<PushOutcome>;
};

export async function sendExpoPush(token: string, fetchImpl: typeof fetch = fetch): Promise<PushOutcome> {
  try {
    const response = await fetchImpl('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: token,
        title: RIDER_ALERT_PUSH.title,
        body: RIDER_ALERT_PUSH.body,
        sound: 'default',
        priority: 'high',
        channelId: RIDER_ALERT_PUSH.channelId,
        data: RIDER_ALERT_PUSH.data,
      }),
    });
    if (response.status === 429 || response.status >= 500) {
      return 'retry';
    }
    if (!response.ok) {
      return 'retry';
    }
    const payload = await response.json() as PushResponse;
    if (payload.errors && payload.errors.length > 0) {
      return 'retry';
    }
    const ticket = Array.isArray(payload.data) ? payload.data[0] : payload.data;
    if (ticket?.status === 'ok') {
      return 'sent';
    }
    if (ticket?.details?.error === 'DeviceNotRegistered') {
      return 'invalid-token';
    }
    return 'retry';
  } catch {
    return 'retry';
  }
}
