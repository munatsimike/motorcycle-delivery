import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { customerDeliveryNotification, v2FcmBody } from './fcm-v2-sender.js';
import {
  approvalDedupe,
  bidNoticeDedupe,
  customerBidNoticeType,
  hasActiveVerifiedMotorcycle,
  insertMarketplaceNotice,
  mayReceiveDeliveryOpportunity,
  noticeDisposition,
  opportunityDedupe,
  v2PushCollapseKey,
  v2PushTtlSeconds,
} from './v2-marketplace-notice.js';

const DELIVERY = '11111111-1111-4111-8111-111111111111';
const BID = '22222222-2222-4222-8222-222222222222';
const RIDER = '33333333-3333-4333-8333-333333333333';
const OPENED = new Date('2026-11-01T16:00:00.000Z');

const ELIGIBLE = {
  approvalStatus: 'APPROVED',
  accountStatus: 'ACTIVE',
  phoneVerified: true,
  licenceVerified: true,
  receivingRequests: true,
  activeVerifiedMotorcycle: true,
};

describe('marketplace notice policy', () => {
  it('separates a matching bid from a counteroffer and keeps one row per bid', () => {
    expect(customerBidNoticeType(750, 750)).toBe('BID_RECEIVED');
    expect(customerBidNoticeType(800, 750)).toBe('COUNTEROFFER');
    expect(bidNoticeDedupe(BID, 'BID_RECEIVED')).toBe(bidNoticeDedupe(BID, 'BID_RECEIVED'));
    expect(bidNoticeDedupe(BID, 'BID_RECEIVED')).not.toBe(bidNoticeDedupe(BID, 'COUNTEROFFER'));
    expect(opportunityDedupe(DELIVERY, OPENED)).toBe(`opportunity:${DELIVERY}:${OPENED.toISOString()}`);
    expect(approvalDedupe(RIDER, OPENED)).toBe(approvalDedupe(RIDER, OPENED));
    expect(approvalDedupe(RIDER, OPENED)).not.toBe(approvalDedupe(RIDER, new Date(OPENED.getTime() + 1)));
  });

  it('sends a delivery opportunity only to an approved rider who can bid', () => {
    expect(mayReceiveDeliveryOpportunity(ELIGIBLE)).toBe(true);
    expect(mayReceiveDeliveryOpportunity({ ...ELIGIBLE, approvalStatus: 'SUSPENDED' })).toBe(false);
    expect(mayReceiveDeliveryOpportunity({ ...ELIGIBLE, approvalStatus: 'REJECTED' })).toBe(false);
    expect(mayReceiveDeliveryOpportunity({ ...ELIGIBLE, approvalStatus: 'PENDING' })).toBe(false);
    expect(mayReceiveDeliveryOpportunity({ ...ELIGIBLE, accountStatus: 'SUSPENDED' })).toBe(false);
    expect(mayReceiveDeliveryOpportunity({ ...ELIGIBLE, phoneVerified: false })).toBe(false);
    expect(mayReceiveDeliveryOpportunity({ ...ELIGIBLE, licenceVerified: false })).toBe(false);
    expect(mayReceiveDeliveryOpportunity({ ...ELIGIBLE, receivingRequests: false })).toBe(false);
    expect(mayReceiveDeliveryOpportunity({ ...ELIGIBLE, activeVerifiedMotorcycle: false })).toBe(false);
    expect(hasActiveVerifiedMotorcycle([
      { isActive: true, verificationStatus: 'VERIFIED' },
      { isActive: false, verificationStatus: 'PENDING' },
    ])).toBe(true);
    expect(hasActiveVerifiedMotorcycle([
      { isActive: true, verificationStatus: 'VERIFIED' },
      { isActive: true, verificationStatus: 'VERIFIED' },
    ])).toBe(false);
  });

  it('keeps provider retries and does not treat a missing token as a failed attempt', () => {
    expect(noticeDisposition({
      configured: true,
      knownType: true,
      deviceCount: 1,
      outcomes: ['temporary'],
    })).toEqual({ disposition: 'retry', failure: 'provider_unavailable' });
    expect(noticeDisposition({
      configured: true,
      knownType: true,
      deviceCount: 1,
      outcomes: ['timeout'],
    })).toEqual({ disposition: 'retry', failure: 'provider_timeout' });
    expect(noticeDisposition({
      configured: true,
      knownType: true,
      deviceCount: 2,
      outcomes: ['accepted', 'invalid'],
    })).toEqual({ disposition: 'sent', failure: null });
    expect(noticeDisposition({
      configured: true,
      knownType: true,
      deviceCount: 0,
      outcomes: [],
    })).toEqual({ disposition: 'defer', failure: null });
    expect(noticeDisposition({
      configured: false,
      knownType: true,
      deviceCount: 1,
      outcomes: [],
    })).toEqual({ disposition: 'defer', failure: null });
  });

  it('uses a longer lifetime than 60 seconds and omits personal details', () => {
    expect(v2PushTtlSeconds('rider_offer')).toBe(5 * 60);
    expect(v2PushTtlSeconds('v2_bid_received')).toBe(60 * 60);
    expect(v2PushTtlSeconds('v2_counteroffer')).toBe(60 * 60);
    expect(v2PushTtlSeconds('v2_bid_accepted')).toBe(60 * 60);
    expect(v2PushTtlSeconds('v2_delivered')).toBe(60 * 60);
    expect(v2PushTtlSeconds('rider_account_approved')).toBe(24 * 60 * 60);
    const offer = v2FcmBody({
      token: 'device-token',
      type: 'v2_bid_received',
      deliveryId: DELIVERY,
      assignmentId: '',
      audience: 'customer',
      ttlSeconds: v2PushTtlSeconds('v2_bid_received'),
      collapseKey: v2PushCollapseKey('v2_bid_received', DELIVERY),
    });
    expect(offer.message.data).toEqual({ type: 'v2_bid_received', deliveryId: DELIVERY });
    expect(offer.message.notification).toEqual(customerDeliveryNotification('v2_bid_received'));
    expect(offer.message.android.ttl).toBe('3600s');
    expect(offer.message.android.collapse_key).toBe(`v2_bid_received:${DELIVERY}`);
    const encoded = JSON.stringify(offer);
    expect(encoded).not.toContain('+263');
    expect(encoded).not.toContain('Samora');
    expect(encoded).not.toMatch(/"amount"/);
    const opportunity = v2FcmBody({
      token: 'device-token',
      type: 'rider_offer',
      deliveryId: DELIVERY,
      assignmentId: '',
      audience: 'rider',
      ttlSeconds: v2PushTtlSeconds('rider_offer'),
      expiresAt: OPENED.toISOString(),
    });
    expect(opportunity.message).not.toHaveProperty('notification');
    expect(opportunity.message.data).toEqual({
      type: 'rider_offer',
      deliveryId: DELIVERY,
      expiresAt: OPENED.toISOString(),
    });
    const approved = v2FcmBody({
      token: 'device-token',
      type: 'rider_account_approved',
      deliveryId: '',
      assignmentId: '',
      audience: 'rider',
      approvedAt: OPENED.toISOString(),
    });
    expect(approved.message.data).toEqual({
      type: 'rider_account_approved',
      approvedAt: OPENED.toISOString(),
    });
    expect(JSON.stringify(approved)).not.toContain(RIDER);
  });

  it('writes one marketplace row when the same event is recorded twice', async () => {
    const statements: string[] = [];
    const values: unknown[][] = [];
    const tx = {
      async $executeRawUnsafe(query: string, ...args: unknown[]) {
        statements.push(query);
        values.push(args);
        return 0;
      },
    };
    const input = {
      eventType: 'BID_RECEIVED' as const,
      deliveryId: DELIVERY,
      riderProfileId: null,
      customerAccountId: '44444444-4444-4444-8444-444444444444',
      createdAt: OPENED,
      dedupeKey: bidNoticeDedupe(BID, 'BID_RECEIVED'),
    };
    await insertMarketplaceNotice(tx, input);
    await insertMarketplaceNotice(tx, input);
    expect(statements.filter((query) => query.includes('INSERT'))).toHaveLength(2);
    expect(statements.some((query) => query.includes('ON CONFLICT ("dedupe_key") DO NOTHING'))).toBe(true);
    expect(values.filter((args) => args.includes(input.dedupeKey))).toHaveLength(2);
    expect(JSON.stringify(values)).not.toContain(RIDER);
  });

  it('keeps the recipient check from sending an opportunity to a customer account', () => {
    const sql = readFileSync('prisma/migrations/20261101170100_marketplace_push_notice_rows/migration.sql', 'utf8');
    expect(sql).toContain("'RIDER_OPPORTUNITY'");
    expect(sql).toContain("'ACCOUNT_APPROVED'");
    expect(sql).toContain('"dedupe_key"');
    expect(sql).not.toContain('INSERT INTO "deliveries"');
    expect(sql).toContain('"customer_account_id" IS NULL');
    expect(sql).toContain('"rider_profile_id" IS NULL');
  });
});
