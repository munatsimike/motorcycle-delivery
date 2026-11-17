import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { v2FcmBody } from './fcm-v2-sender.js';
import {
  approvalDedupe,
  assignmentNoticeDedupe,
  bidNoticeDedupe,
  customerBidNoticeType,
  hasActiveVerifiedMotorcycle,
  insertMarketplaceNotice,
  mayReceiveDeliveryOpportunity,
  noticeDisposition,
  opportunityDedupe,
  v2PushAudience,
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
  availability: 'AVAILABLE',
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
    expect(mayReceiveDeliveryOpportunity({ ...ELIGIBLE, availability: 'OFFLINE' })).toBe(false);
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
    expect(offer.message.data).toEqual({
      type: 'v2_bid_received',
      title: 'New offer',
      body: 'A rider sent an offer on your delivery.',
      deliveryId: DELIVERY,
    });
    expect(offer.message).not.toHaveProperty('notification');
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
    const delivered = v2FcmBody({
      token: 'device-token',
      type: 'v2_delivered',
      deliveryId: DELIVERY,
      assignmentId: 'assignment-1',
      audience: 'customer',
      ttlSeconds: v2PushTtlSeconds('v2_delivered'),
    });
    expect(delivered.message).not.toHaveProperty('notification');
    expect(delivered.message.data).toMatchObject({
      title: 'Delivered',
      body: 'Your parcel has been delivered.',
      deliveryId: DELIVERY,
    });
    const collected = v2FcmBody({
      token: 'device-token',
      type: 'v2_collected',
      deliveryId: DELIVERY,
      assignmentId: 'assignment-1',
      audience: 'customer',
      accountId: 'customer-1',
    });
    expect(collected.message.data.body).toBe('Your parcel has been collected.');
    expect(collected.message.data.accountId).toBe('customer-1');
    const riderCancelled = v2FcmBody({
      token: 'device-token',
      type: 'v2_rider_cancelled',
      deliveryId: DELIVERY,
      assignmentId: 'assignment-1',
      audience: 'customer',
      accountId: 'customer-1',
    });
    expect(riderCancelled.message).not.toHaveProperty('notification');
    expect(riderCancelled.message.data).toMatchObject({
      title: 'Rider cancelled',
      body: 'Your rider cancelled the delivery.',
      accountId: 'customer-1',
      deliveryId: DELIVERY,
    });
    const customerCancelled = v2FcmBody({
      token: 'device-token',
      type: 'v2_customer_cancelled',
      deliveryId: DELIVERY,
      assignmentId: 'assignment-1',
      audience: 'rider',
    });
    expect(customerCancelled.message).not.toHaveProperty('notification');
    expect(customerCancelled.message.data).toEqual({
      type: 'v2_customer_cancelled',
      deliveryId: DELIVERY,
      assignmentId: 'assignment-1',
    });
  });

  it('routes cancellation notices to the owner or the accepted rider only', () => {
    expect(v2PushAudience('RIDER_CANCELLED')).toBe('customer');
    expect(v2PushAudience('CUSTOMER_CANCELLED')).toBe('rider');
    expect(v2PushAudience('BID_RECEIVED')).toBe('customer');
    expect(v2PushAudience('BID_ACCEPTED')).toBe('rider');
    expect(v2PushAudience('COLLECTED')).toBe('customer');
    expect(v2PushAudience('DELIVERED')).toBe('customer');
    const assignment = '55555555-5555-4555-8555-555555555555';
    expect(assignmentNoticeDedupe(assignment, 'RIDER_CANCELLED')).toBe(`assignment:${assignment}:RIDER_CANCELLED`);
    expect(assignmentNoticeDedupe(assignment, 'CUSTOMER_CANCELLED')).toBe(`assignment:${assignment}:CUSTOMER_CANCELLED`);
    expect(assignmentNoticeDedupe(assignment, 'RIDER_CANCELLED'))
      .not.toBe(assignmentNoticeDedupe(assignment, 'CUSTOMER_CANCELLED'));
    const dispatch = readFileSync(new URL('./dispatch.service.ts', import.meta.url), 'utf8');
    const riderCancel = dispatch.slice(
      dispatch.indexOf('async function cancelBeforePickup'),
      dispatch.indexOf('async function cancellationReplay'),
    );
    const customerCancel = dispatch.slice(
      dispatch.indexOf('async function cancelV2DeliveryByCustomer'),
      dispatch.indexOf('async function cancelDelivery'),
    );
    expect(riderCancel).toContain('recordRiderCancelled');
    expect(riderCancel).not.toContain('recordCustomerCancelled');
    expect(customerCancel).toContain('recordCustomerCancelled');
    expect(customerCancel).not.toContain('NO_RIDER_FOUND');
    expect(noticeDisposition({
      configured: true,
      knownType: true,
      deviceCount: 1,
      outcomes: ['invalid'],
    })).toEqual({ disposition: 'defer', failure: null });
    expect(noticeDisposition({
      configured: true,
      knownType: true,
      deviceCount: 1,
      outcomes: ['temporary'],
    }).disposition).toBe('retry');
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
    expect(sql).toContain('v2_outbox_events_assign_dedupe_key');
    expect(sql.indexOf('CREATE TRIGGER "v2_outbox_events_assign_dedupe_key"')).toBeLessThan(
      sql.indexOf('ALTER COLUMN "dedupe_key" SET NOT NULL'),
    );
    expect(sql).not.toContain('INSERT INTO "deliveries"');
    expect(sql).toContain('"customer_account_id" IS NULL');
    expect(sql).toContain('"rider_profile_id" IS NULL');
  });
});
