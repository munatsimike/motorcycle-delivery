import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  fcmMessageBody,
  permanentTokenFailure,
  signServiceAccount,
  FcmOfferSender,
} from './fcm-offer-sender.js';

const message = {
  token: 'device-token',
  assignmentId: 'assignment-1',
  deliveryId: 'delivery-1',
  expiresAt: '2026-10-23T00:00:40.000Z',
  ttlSeconds: 40,
};

describe('FCM offer messages', () => {
  it('sends a high-priority data message and leaves display to Android', () => {
    const body = fcmMessageBody(message);
    expect(body.message.data).toEqual({
      type: 'rider_offer',
      assignmentId: 'assignment-1',
      deliveryId: 'delivery-1',
      expiresAt: '2026-10-23T00:00:40.000Z',
    });
    expect(body.message.android).toEqual({
      priority: 'HIGH',
      ttl: '40s',
      collapse_key: 'assignment-1',
    });
    expect(body.message).not.toHaveProperty('notification');
    expect(JSON.stringify(body)).not.toMatch(/price|address|pickup/i);
  });

  it('treats an unregistered token as permanent and a server error as temporary', () => {
    expect(permanentTokenFailure(404, '{"error":{"status":"NOT_FOUND"}}')).toBe(true);
    expect(permanentTokenFailure(400, '{"error":{"details":[{"errorCode":"UNREGISTERED"}]}}')).toBe(true);
    expect(permanentTokenFailure(400, 'INVALID_ARGUMENT')).toBe(true);
    expect(permanentTokenFailure(429, 'UNAVAILABLE')).toBe(false);
    expect(permanentTokenFailure(500, 'internal')).toBe(false);
  });

  it('stays unconfigured when the service account is absent', () => {
    const previous = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    try {
      expect(new FcmOfferSender().configured()).toBe(false);
    } finally {
      if (previous === undefined) {
        delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
      } else {
        process.env.FIREBASE_SERVICE_ACCOUNT_JSON = previous;
      }
    }
  });

  it('signs a service-account assertion without putting the key in the header', () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const assertion = signServiceAccount({
      project_id: 'riders-dev',
      client_email: 'alerts@riders-dev.iam.gserviceaccount.com',
      private_key: pem,
    }, 1_700_000_000);
    const [header] = assertion.split('.');
    expect(assertion.split('.')).toHaveLength(3);
    expect(Buffer.from(header, 'base64url').toString()).toContain('"alg":"RS256"');
    expect(assertion).not.toContain(pem.slice(30, 60));
  });
});
