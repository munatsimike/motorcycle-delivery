import { Injectable } from '@nestjs/common';
import { permanentTokenFailure, signServiceAccount } from './fcm-offer-sender.js';
import { V2PushSender, type V2PushMessage, type V2PushOutcome } from './v2-push-sender.js';

type ServiceAccount = {
  project_id: string;
  client_email: string;
  private_key: string;
};

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export function firebaseAccountReady(raw: string | undefined): raw is string {
  if (!raw?.trim()) {
    return false;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ServiceAccount>;
    return Boolean(parsed.project_id && parsed.client_email && parsed.private_key);
  } catch {
    return false;
  }
}

const CUSTOMER_DELIVERY_NOTIFICATION: Record<string, { title: string; body: string }> = {
  v2_request_reopened: {
    title: 'Delivery request',
    body: 'Your delivery request is open again.',
  },
  v2_deadline_reminder: {
    title: 'Delivery deadline',
    body: 'Your delivery deadline needs attention.',
  },
  v2_collecting: {
    title: 'Rider collecting',
    body: 'Your rider is collecting your parcel.',
  },
  v2_collected: {
    title: 'Parcel collected',
    body: 'Your parcel has been collected.',
  },
  v2_out_for_delivery: {
    title: 'On the way',
    body: 'Your parcel is on its way.',
  },
  v2_delivered: {
    title: 'Delivered',
    body: 'Your parcel has been delivered.',
  },
};

export const CUSTOMER_DELIVERY_CHANNEL_ID = 'default';

export function customerDeliveryNotification(type: string): { title: string; body: string } | null {
  return CUSTOMER_DELIVERY_NOTIFICATION[type] ?? null;
}

@Injectable()
export class FcmV2PushSender extends V2PushSender {
  private cached: { token: string; expiresAtMs: number } | null = null;
  private tokenRequest: Promise<string> | null = null;

  configured(): boolean {
    return this.account() !== null;
  }

  async send(message: V2PushMessage, timeoutMs: number): Promise<V2PushOutcome> {
    const account = this.account();
    if (!account) {
      return 'temporary';
    }
    try {
      const accessToken = await this.accessToken(account, timeoutMs);
      const response = await fetch(
        `https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${accessToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(v2FcmBody(message)),
          signal: AbortSignal.timeout(timeoutMs),
        },
      );
      if (response.ok) {
        return 'accepted';
      }
      const body = await response.text();
      if (permanentTokenFailure(response.status, body)) {
        return 'invalid';
      }
      return 'temporary';
    } catch (error) {
      return v2ProviderFailure(error);
    }
  }

  private account(): ServiceAccount | null {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!firebaseAccountReady(raw)) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as Partial<ServiceAccount>;
      if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
        return null;
      }
      return {
        project_id: parsed.project_id,
        client_email: parsed.client_email,
        private_key: parsed.private_key,
      };
    } catch {
      return null;
    }
  }

  private accessToken(account: ServiceAccount, timeoutMs: number): Promise<string> {
    const now = Date.now();
    if (this.cached && this.cached.expiresAtMs - 60_000 > now) {
      return Promise.resolve(this.cached.token);
    }
    if (!this.tokenRequest) {
      this.tokenRequest = this.fetchAccessToken(account, timeoutMs, now).finally(() => {
        this.tokenRequest = null;
      });
    }
    return this.tokenRequest;
  }

  private async fetchAccessToken(account: ServiceAccount, timeoutMs: number, now: number): Promise<string> {
    const issuedAt = Math.floor(now / 1_000);
    const assertion = signServiceAccount(account, issuedAt);
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      throw new Error('firebase_token');
    }
    const payload = await response.json() as { access_token?: string; expires_in?: number };
    if (!payload.access_token) {
      throw new Error('firebase_token');
    }
    const expiresIn = payload.expires_in ?? 3_600;
    this.cached = {
      token: payload.access_token,
      expiresAtMs: now + expiresIn * 1_000,
    };
    return payload.access_token;
  }
}

export function v2ProviderFailure(error: unknown): 'timeout' | 'temporary' {
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return 'timeout';
  }
  return 'temporary';
}

export function v2FcmBody(message: V2PushMessage) {
  const notification = message.audience === 'customer' ? customerDeliveryNotification(message.type) : null;
  return {
    message: {
      token: message.token,
      data: {
        type: message.type,
        deliveryId: message.deliveryId,
        assignmentId: message.assignmentId,
      },
      ...(notification ? { notification } : {}),
      android: {
        priority: 'HIGH',
        ttl: '60s',
        collapse_key: message.assignmentId,
        ...(notification
          ? { notification: { channel_id: CUSTOMER_DELIVERY_CHANNEL_ID } }
          : {}),
      },
    },
  };
}
