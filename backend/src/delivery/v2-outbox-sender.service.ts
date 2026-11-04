import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { v2MarketplaceEnabled } from '../auth/v2-flags.js';
import { remindLateV2Deliveries } from './v2-deadline-reminder.js';
import { V2PushSender, type V2PushOutcome } from './v2-push-sender.js';
import {
  hasActiveVerifiedMotorcycle,
  mayReceiveDeliveryOpportunity,
  noticeDisposition,
  tokenlessDeferAt,
  v2PushAudience,
  v2PushCollapseKey,
  v2PushTtlSeconds,
  v2PushType,
} from './v2-marketplace-notice.js';
import {
  V2_NOTICE_BATCH,
  v2NoticeConfig,
  v2RetryAt,
  type V2NoticeConfig,
} from './v2-notice.js';

type ClaimedNotice = {
  id: string;
  eventType: string;
  deliveryId: string | null;
  assignmentId: string | null;
  riderProfileId: string | null;
  customerAccountId: string | null;
  attemptCount: number;
  claimToken: string;
  createdAt: Date;
};

type PushDeviceRow = {
  id: string;
  fcmToken: string;
};

type FailureReason = 'provider_timeout' | 'provider_unavailable';

// A provider acceptance followed by a crash before SENT is committed can be
// delivered again after the claim lease. Exactly-once push delivery is not guaranteed.
@Injectable()
export class V2OutboxSender {
  private readonly logger = new Logger(V2OutboxSender.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sender: V2PushSender,
  ) {}

  async drain(now = new Date(), limit = V2_NOTICE_BATCH): Promise<number> {
    if (!v2MarketplaceEnabled()) {
      return 0;
    }
    const timing = v2NoticeConfig();
    await this.releaseStaleClaims(now, timing.leaseMs);
    await remindLateV2Deliveries(this.prisma, now);
    const claimed = await this.claim(now, limit, timing.leaseMs);
    for (const row of claimed) {
      try {
        await this.deliver(row, now, timing);
      } catch (error) {
        const name = error instanceof Error ? error.name : 'Error';
        this.logger.error(`V2 notice failed: ${name}`);
        await this.markFailure(row, now, 'provider_unavailable', timing).catch(() => undefined);
      }
    }
    return claimed.length;
  }

  private async releaseStaleClaims(now: Date, leaseMs: number): Promise<void> {
    const staleBefore = new Date(now.getTime() - leaseMs);
    await this.prisma.$executeRawUnsafe(
      `UPDATE "v2_outbox_events"
       SET "claimed_at" = NULL,
           "claim_token" = NULL
       WHERE "status" = 'PENDING'::"v2_outbox_status"
         AND "claimed_at" IS NOT NULL
         AND "claimed_at" < $1`,
      staleBefore,
    );
  }

  private async claim(now: Date, limit: number, leaseMs: number): Promise<ClaimedNotice[]> {
    const staleBefore = new Date(now.getTime() - leaseMs);
    const rows = await this.prisma.$queryRawUnsafe<Array<ClaimedNotice>>(
      `WITH due AS (
         SELECT "id"
         FROM "v2_outbox_events"
         WHERE "status" = 'PENDING'::"v2_outbox_status"
           AND ("next_attempt_at" IS NULL OR "next_attempt_at" <= $1)
           AND ("claimed_at" IS NULL OR "claimed_at" < $2)
         ORDER BY
           CASE
             WHEN "event_type" = 'RIDER_OPPORTUNITY'::"v2_outbox_event_type" AND EXISTS (
               SELECT 1 FROM "rider_push_devices" AS device
               WHERE device."invalidated_at" IS NULL
             ) THEN 0
             WHEN "rider_profile_id" IS NOT NULL AND EXISTS (
               SELECT 1 FROM "rider_push_devices" AS device
               WHERE device."rider_profile_id" = "v2_outbox_events"."rider_profile_id"
                 AND device."invalidated_at" IS NULL
             ) THEN 0
             WHEN "customer_account_id" IS NOT NULL AND EXISTS (
               SELECT 1 FROM "customer_fcm_devices" AS device
               WHERE device."customer_account_id" = "v2_outbox_events"."customer_account_id"
                 AND device."invalidated_at" IS NULL
             ) THEN 0
             ELSE 1
           END,
           "created_at"
         LIMIT $3
         FOR UPDATE SKIP LOCKED
       )
       UPDATE "v2_outbox_events" AS event
       SET "claimed_at" = $1,
           "claim_token" = gen_random_uuid()
       FROM due
       WHERE event."id" = due."id"
       RETURNING event."id",
                 event."event_type" AS "eventType",
                 event."delivery_id" AS "deliveryId",
                 event."assignment_id" AS "assignmentId",
                 event."rider_profile_id" AS "riderProfileId",
                 event."customer_account_id" AS "customerAccountId",
                 event."attempt_count" AS "attemptCount",
                 event."claim_token" AS "claimToken",
                 event."created_at" AS "createdAt"`,
      now,
      staleBefore,
      limit,
    );
    return rows.map((row) => ({
      ...row,
      attemptCount: Number(row.attemptCount),
      createdAt: row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt),
    }));
  }

  private async deliver(row: ClaimedNotice, now: Date, timing: V2NoticeConfig): Promise<void> {
    if (!row.claimToken) {
      return;
    }
    const idleUntil = tokenlessDeferAt(now);
    const type = v2PushType(row.eventType);
    if (!this.sender.configured() || !type) {
      await this.releaseWithoutFailure(row, idleUntil);
      return;
    }
    const openOpportunity = row.eventType === 'RIDER_OPPORTUNITY'
      ? await this.openOpportunity(row.deliveryId, now)
      : null;
    if (row.eventType === 'RIDER_OPPORTUNITY' && !openOpportunity) {
      await this.finishWithoutDelivery(row, now, 'not_available');
      return;
    }
    const devices = await this.devicesFor(row);
    const results = await Promise.all(devices.map(async (device) => {
      try {
        const outcome = await this.sender.send({
          token: device.fcmToken,
          type,
          deliveryId: row.deliveryId ?? '',
          assignmentId: row.assignmentId ?? '',
          audience: v2PushAudience(row.eventType),
          ttlSeconds: v2PushTtlSeconds(type),
          collapseKey: v2PushCollapseKey(type, row.deliveryId),
          expiresAt: openOpportunity?.expiresAt,
          approvedAt: row.eventType === 'ACCOUNT_APPROVED' ? row.createdAt.toISOString() : undefined,
        }, timing.timeoutMs);
        return { device, outcome };
      } catch (error) {
        const outcome: V2PushOutcome = error instanceof Error && error.name === 'TimeoutError'
          ? 'timeout'
          : 'temporary';
        return { device, outcome };
      }
    }));
    for (const result of results) {
      if (result.outcome === 'invalid') {
        await this.invalidate(row, result.device.id, now);
      }
    }
    const decision = noticeDisposition({
      configured: true,
      knownType: true,
      deviceCount: devices.length,
      outcomes: results.map((result) => result.outcome),
    });
    if (decision.disposition === 'sent') {
      await this.markSent(row, now);
      return;
    }
    if (decision.disposition === 'retry' && decision.failure) {
      await this.markFailure(row, now, decision.failure, timing);
      return;
    }
    await this.releaseWithoutFailure(row, idleUntil);
  }

  private async devicesFor(row: ClaimedNotice): Promise<PushDeviceRow[]> {
    if (row.eventType === 'RIDER_OPPORTUNITY') {
      const devices = await this.prisma.riderPushDevice.findMany({
        where: { invalidatedAt: null },
        select: {
          id: true,
          fcmToken: true,
          riderProfile: {
            select: {
              approvalStatus: true,
              availability: true,
              receivingRequests: true,
              verificationStatus: true,
              user: { select: { accountStatus: true, phoneVerifiedAt: true } },
              motorcycles: { select: { isActive: true, verificationStatus: true } },
            },
          },
        },
      });
      return devices.filter((device) => mayReceiveDeliveryOpportunity({
        approvalStatus: device.riderProfile.approvalStatus,
        accountStatus: device.riderProfile.user.accountStatus,
        phoneVerified: device.riderProfile.user.phoneVerifiedAt != null,
        licenceVerified: device.riderProfile.verificationStatus === 'VERIFIED',
        receivingRequests: device.riderProfile.receivingRequests === true,
        activeVerifiedMotorcycle: hasActiveVerifiedMotorcycle(device.riderProfile.motorcycles),
        availability: device.riderProfile.availability,
      })).map((device) => ({ id: device.id, fcmToken: device.fcmToken }));
    }
    if (row.eventType === 'BID_ACCEPTED' || row.eventType === 'ACCOUNT_APPROVED') {
      if (!row.riderProfileId) {
        return [];
      }
      return this.prisma.riderPushDevice.findMany({
        where: { riderProfileId: row.riderProfileId, invalidatedAt: null },
        select: { id: true, fcmToken: true },
      });
    }
    if (!row.customerAccountId) {
      return [];
    }
    return this.prisma.customerFcmDevice.findMany({
      where: { customerAccountId: row.customerAccountId, invalidatedAt: null },
      select: { id: true, fcmToken: true },
    });
  }

  private async openOpportunity(deliveryId: string | null, now: Date): Promise<{ expiresAt: string } | null> {
    if (!deliveryId) {
      return null;
    }
    const delivery = await this.prisma.delivery.findUnique({
      where: { id: deliveryId },
      select: { status: true, searchGeneration: true, deliverBy: true, serviceClass: true },
    });
    if (!delivery || delivery.status !== 'CREATED' || delivery.searchGeneration !== 0 || delivery.serviceClass == null) {
      return null;
    }
    if (delivery.deliverBy && delivery.deliverBy.getTime() <= now.getTime()) {
      return null;
    }
    return { expiresAt: delivery.deliverBy?.toISOString() ?? '' };
  }

  private async finishWithoutDelivery(row: ClaimedNotice, now: Date, reason: 'not_available'): Promise<void> {
    await this.prisma.$executeRawUnsafe(
      `UPDATE "v2_outbox_events"
       SET "status" = 'FAILED'::"v2_outbox_status",
           "last_failure" = $4,
           "last_attempt_at" = $3::timestamptz,
           "failed_at" = $3::timestamptz,
           "claimed_at" = NULL,
           "claim_token" = NULL,
           "next_attempt_at" = NULL
       WHERE "id" = $1::uuid
         AND "claim_token" = $2::uuid
         AND "status" = 'PENDING'::"v2_outbox_status"`,
      row.id,
      row.claimToken,
      now,
      reason,
    );
  }

  private async invalidate(row: ClaimedNotice, deviceId: string, now: Date): Promise<void> {
    if (row.eventType === 'BID_ACCEPTED' || row.eventType === 'ACCOUNT_APPROVED' || row.eventType === 'RIDER_OPPORTUNITY') {
      await this.prisma.riderPushDevice.updateMany({
        where: {
          id: deviceId,
          ...(row.riderProfileId ? { riderProfileId: row.riderProfileId } : {}),
        },
        data: { invalidatedAt: now },
      });
      return;
    }
    await this.prisma.customerFcmDevice.updateMany({
      where: { id: deviceId, customerAccountId: row.customerAccountId ?? undefined },
      data: { invalidatedAt: now },
    });
  }

  private async markSent(row: ClaimedNotice, now: Date): Promise<void> {
    await this.prisma.$executeRawUnsafe(
      `UPDATE "v2_outbox_events"
       SET "status" = 'SENT'::"v2_outbox_status",
           "sent_at" = $3,
           "claimed_at" = NULL,
           "claim_token" = NULL
       WHERE "id" = $1::uuid
         AND "claim_token" = $2::uuid
         AND "status" = 'PENDING'::"v2_outbox_status"`,
      row.id,
      row.claimToken,
      now,
    );
  }

  private async markFailure(
    row: ClaimedNotice,
    now: Date,
    reason: FailureReason,
    timing: V2NoticeConfig,
  ): Promise<void> {
    const exhausted = row.attemptCount + 1 >= timing.maxAttempts;
    await this.prisma.$executeRawUnsafe(
      `UPDATE "v2_outbox_events"
       SET "attempt_count" = "attempt_count" + 1,
           "last_failure" = $4,
           "last_attempt_at" = $5::timestamptz,
           "claimed_at" = NULL,
           "claim_token" = NULL,
           "next_attempt_at" = $3::timestamptz,
           "failed_at" = CASE WHEN "attempt_count" + 1 >= $6::int THEN $5::timestamptz ELSE NULL::timestamptz END,
           "status" = CASE
             WHEN "attempt_count" + 1 >= $6::int THEN 'FAILED'::"v2_outbox_status"
             ELSE "status"
           END
       WHERE "id" = $1::uuid
         AND "claim_token" = $2::uuid
         AND "status" = 'PENDING'::"v2_outbox_status"`,
      row.id,
      row.claimToken,
      exhausted ? null : v2RetryAt(row.attemptCount + 1, now),
      reason,
      now,
      timing.maxAttempts,
    );
  }

  private async releaseWithoutFailure(row: ClaimedNotice, nextAttemptAt: Date): Promise<void> {
    await this.prisma.$executeRawUnsafe(
      `UPDATE "v2_outbox_events"
       SET "claimed_at" = NULL,
           "claim_token" = NULL,
           "next_attempt_at" = $3
       WHERE "id" = $1::uuid
         AND "claim_token" = $2::uuid
         AND "status" = 'PENDING'::"v2_outbox_status"`,
      row.id,
      row.claimToken,
      nextAttemptAt,
    );
  }
}
