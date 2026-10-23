import { Injectable, Logger } from '@nestjs/common';
import { RiderOfferNotificationStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { OfferPushSender } from './fcm-offer-sender.js';
import {
  OFFER_NOTICE_BATCH,
  OFFER_NOTICE_CLAIM_STALE_MS,
  OFFER_NOTICE_DISCOVERY_SQL,
  androidTtlSeconds,
  decideAfterTemporaryFailure,
  decideBeforeSend,
  type OfferNoticeSkipReason,
} from './offer-notice.js';

@Injectable()
export class RiderOfferNotificationService {
  private readonly logger = new Logger(RiderOfferNotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sender: OfferPushSender,
  ) {}

  async drain(now = new Date()): Promise<number> {
    await this.releaseStaleClaims(now);
    await this.discover(now);
    const ids = await this.claim(now);
    await Promise.all(ids.map((id) => this.processClaim(id, now)));
    return ids.length;
  }

  private async discover(now: Date): Promise<void> {
    try {
      await this.prisma.$executeRawUnsafe(OFFER_NOTICE_DISCOVERY_SQL, now, OFFER_NOTICE_BATCH);
    } catch (error) {
      const name = error instanceof Error ? error.name : 'Error';
      this.logger.error(`Offer notification discovery failed: ${name}`);
    }
  }

  private async releaseStaleClaims(now: Date): Promise<void> {
    const staleBefore = new Date(now.getTime() - OFFER_NOTICE_CLAIM_STALE_MS);
    await this.prisma.$executeRawUnsafe(
      `UPDATE rider_offer_notifications
       SET status = 'PENDING'::rider_offer_notification_status,
           claimed_at = NULL,
           next_attempt_at = $1
       WHERE status = 'SENDING'::rider_offer_notification_status
         AND claimed_at IS NOT NULL
         AND claimed_at < $2`,
      now,
      staleBefore,
    );
  }

  private async claim(now: Date): Promise<string[]> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `WITH due AS (
         SELECT id
         FROM rider_offer_notifications
         WHERE status = 'PENDING'::rider_offer_notification_status
           AND next_attempt_at <= $1
         ORDER BY next_attempt_at
         LIMIT $2
         FOR UPDATE SKIP LOCKED
       )
       UPDATE rider_offer_notifications AS notice
       SET status = 'SENDING'::rider_offer_notification_status,
           claimed_at = $1
       FROM due
       WHERE notice.id = due.id
       RETURNING notice.id`,
      now,
      OFFER_NOTICE_BATCH,
    );
    return rows.map((row) => row.id);
  }

  private async processClaim(id: string, now: Date): Promise<void> {
    const row = await this.prisma.riderOfferNotification.findUnique({
      where: { id },
      include: {
        assignment: {
          include: {
            delivery: true,
            riderProfile: true,
          },
        },
      },
    });
    if (!row || row.status !== RiderOfferNotificationStatus.SENDING) {
      return;
    }
    const decision = decideBeforeSend({
      assignmentStatus: row.assignment.status,
      deliveryStatus: row.assignment.delivery.status,
      availability: row.assignment.riderProfile.availability,
      offerExpiresAt: row.assignment.offerExpiresAt,
      attemptCount: row.attemptCount,
      lastFailure: row.lastFailure,
    }, now, this.sender.configured());
    if (decision.action === 'skip') {
      await this.skip(id, decision.reason);
      return;
    }
    if (decision.action === 'defer') {
      await this.defer(id, decision.nextAttemptAt, decision.failure);
      return;
    }

    const devices = await this.prisma.riderPushDevice.findMany({
      where: { riderProfileId: row.riderProfileId, invalidatedAt: null },
    });
    if (devices.length === 0) {
      await this.skip(id, 'no_device');
      return;
    }

    const results = await Promise.all(devices.map((device) => this.sender.send({
      token: device.fcmToken,
      assignmentId: row.assignmentId,
      deliveryId: row.assignment.deliveryId,
      expiresAt: row.assignment.offerExpiresAt.toISOString(),
      ttlSeconds: androidTtlSeconds(row.assignment.offerExpiresAt, now),
    }).catch(() => ({ outcome: 'temporary' as const }))));

    const invalidTokens = devices
      .filter((_, index) => results[index]?.outcome === 'invalid')
      .map((device) => device.fcmToken);
    if (invalidTokens.length > 0) {
      await this.prisma.riderPushDevice.updateMany({
        where: { fcmToken: { in: invalidTokens } },
        data: { invalidatedAt: now },
      });
    }
    if (results.some((result) => result.outcome === 'accepted')) {
      await this.prisma.riderOfferNotification.update({
        where: { id },
        data: {
          status: RiderOfferNotificationStatus.SENT,
          sentAt: now,
          claimedAt: null,
          lastFailure: null,
        },
      });
      return;
    }
    if (results.every((result) => result.outcome === 'invalid')) {
      await this.skip(id, 'invalid_token');
      return;
    }
    await this.afterTemporaryFailure(id, row.attemptCount, row.assignment.offerExpiresAt, now);
  }

  private async afterTemporaryFailure(
    id: string,
    attemptCount: number,
    offerExpiresAt: Date,
    now: Date,
  ): Promise<void> {
    const decision = decideAfterTemporaryFailure(attemptCount, offerExpiresAt, now);
    if (decision.action === 'skip') {
      await this.skip(id, decision.reason, 'firebase_unavailable');
      return;
    }
    if (decision.action === 'defer') {
      await this.defer(id, decision.nextAttemptAt, 'firebase_unavailable', attemptCount + 1);
    }
  }

  private async skip(id: string, reason: OfferNoticeSkipReason, lastFailure?: string): Promise<void> {
    await this.prisma.riderOfferNotification.update({
      where: { id },
      data: {
        status: RiderOfferNotificationStatus.SKIPPED,
        skipReason: reason,
        claimedAt: null,
        ...(lastFailure ? { lastFailure } : {}),
      },
    });
  }

  private async defer(
    id: string,
    nextAttemptAt: Date,
    lastFailure: string,
    attemptCount?: number,
  ): Promise<void> {
    await this.prisma.riderOfferNotification.update({
      where: { id },
      data: {
        status: RiderOfferNotificationStatus.PENDING,
        nextAttemptAt,
        lastFailure,
        claimedAt: null,
        ...(attemptCount === undefined ? {} : { attemptCount }),
      },
    });
  }
}
