import { createSign } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { OFFER_NOTICE_HTTP_TIMEOUT_MS } from './offer-notice.js';

export type OfferPushMessage = {
  token: string;
  assignmentId: string;
  deliveryId: string;
  expiresAt: string;
  ttlSeconds: number;
};

export type OfferPushResult =
  | { outcome: 'accepted' }
  | { outcome: 'invalid' }
  | { outcome: 'temporary' };

type ServiceAccount = {
  project_id: string;
  client_email: string;
  private_key: string;
};

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const MESSAGING_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

export abstract class OfferPushSender {
  abstract configured(): boolean;
  abstract send(message: OfferPushMessage): Promise<OfferPushResult>;
}

@Injectable()
export class FcmOfferSender extends OfferPushSender {
  private cached: { token: string; expiresAtMs: number } | null = null;

  configured(): boolean {
    return this.account() !== null;
  }

  async send(message: OfferPushMessage): Promise<OfferPushResult> {
    const account = this.account();
    if (!account) {
      return { outcome: 'temporary' };
    }
    try {
      const accessToken = await this.accessToken(account);
      const response = await fetch(
        `https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${accessToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(fcmMessageBody(message)),
          signal: AbortSignal.timeout(OFFER_NOTICE_HTTP_TIMEOUT_MS),
        },
      );
      if (response.ok) {
        return { outcome: 'accepted' };
      }
      const body = await response.text();
      if (permanentTokenFailure(response.status, body)) {
        return { outcome: 'invalid' };
      }
      return { outcome: 'temporary' };
    } catch {
      return { outcome: 'temporary' };
    }
  }

  private account(): ServiceAccount | null {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!raw?.trim()) {
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

  private async accessToken(account: ServiceAccount): Promise<string> {
    const now = Date.now();
    if (this.cached && this.cached.expiresAtMs - 60_000 > now) {
      return this.cached.token;
    }
    const issuedAt = Math.floor(now / 1_000);
    const assertion = signServiceAccount(account, issuedAt);
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
      signal: AbortSignal.timeout(OFFER_NOTICE_HTTP_TIMEOUT_MS),
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

export function fcmMessageBody(message: OfferPushMessage) {
  return {
    message: {
      token: message.token,
      data: {
        type: 'rider_offer',
        assignmentId: message.assignmentId,
        deliveryId: message.deliveryId,
        expiresAt: message.expiresAt,
      },
      android: {
        priority: 'HIGH',
        ttl: `${message.ttlSeconds}s`,
        collapse_key: message.assignmentId,
      },
    },
  };
}

export function signServiceAccount(account: ServiceAccount, issuedAtSeconds: number): string {
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64Url(JSON.stringify({
    iss: account.client_email,
    scope: MESSAGING_SCOPE,
    aud: TOKEN_URL,
    iat: issuedAtSeconds,
    exp: issuedAtSeconds + 3_600,
  }));
  const unsigned = `${header}.${claim}`;
  const signature = createSign('RSA-SHA256');
  signature.update(unsigned);
  signature.end();
  return `${unsigned}.${signature.sign(account.private_key).toString('base64url')}`;
}

function base64Url(value: string): string {
  return Buffer.from(value).toString('base64url');
}

export function permanentTokenFailure(status: number, body: string): boolean {
  if (status === 404) {
    return true;
  }
  const upper = body.toUpperCase();
  if (upper.includes('UNREGISTERED') || upper.includes('INVALID_ARGUMENT')) {
    return status === 400 || status === 404;
  }
  return false;
}
