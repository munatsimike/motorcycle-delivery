import { ConflictException } from '@nestjs/common';
import {
  AssignmentStatus,
  BidStatus,
  DeliveryActorType,
  DeliveryStatus,
  Prisma,
} from '../generated/prisma/client.js';
import { v2RequestRemainsOpen } from './v2-deadline.js';

export const V2_SEARCH_WINDOW_MS = 360_000;

type SearchDelivery = {
  id: string;
  status: DeliveryStatus;
  serviceClass?: string | null;
  searchGeneration: number;
  searchStartedAt?: Date | null;
  deliverBy?: Date | null;
};

export function v2SearchExpiresAt(startedAt: Date): Date {
  return new Date(startedAt.getTime() + V2_SEARCH_WINDOW_MS);
}

export function v2SearchWindowElapsed(startedAt: Date | null | undefined, now: Date): boolean {
  return startedAt != null && startedAt.getTime() + V2_SEARCH_WINDOW_MS <= now.getTime();
}

export function v2SearchStartData(now: Date): {
  searchStartedAt: Date;
  nextRetryAt: Date;
  autoRetryCount: number;
  searchGeneration: number;
} {
  return {
    searchStartedAt: now,
    nextRetryAt: v2SearchExpiresAt(now),
    autoRetryCount: 0,
    searchGeneration: 0,
  };
}

// expire: the stored window has ended and nobody has a selectable bid.
// keep: the request stays CREATED, including when an OPEN bid arrived.
// ignore: this row is not the claimed window, or a stored deadline owns it.
export function v2SearchExpiryDecision(input: {
  status: DeliveryStatus;
  serviceClass: string | null;
  searchGeneration: number;
  searchStartedAt: Date | null;
  claimedStartedAt: Date | null;
  openBids: number;
  acceptedAssignments: number;
  deliverBy: Date | null;
  now: Date;
}): 'expire' | 'keep' | 'ignore' {
  if (
    input.status !== DeliveryStatus.CREATED
    || input.serviceClass == null
    || input.searchGeneration !== 0
    || input.claimedStartedAt == null
    || input.searchStartedAt == null
    || input.searchStartedAt.getTime() !== input.claimedStartedAt.getTime()
    || !v2RequestRemainsOpen(input.deliverBy, input.now)
  ) {
    return 'ignore';
  }
  if (input.acceptedAssignments > 0 || input.openBids > 0 || !v2SearchWindowElapsed(input.searchStartedAt, input.now)) {
    return 'keep';
  }
  return 'expire';
}

export async function expireDueV2Searches(tx: Prisma.TransactionClient, now: Date): Promise<number> {
  const candidates = await tx.delivery.findMany({
    where: {
      status: DeliveryStatus.CREATED,
      searchGeneration: 0,
      serviceClass: { not: null },
    },
    orderBy: [{ searchStartedAt: 'asc' }, { id: 'asc' }],
    select: { id: true, searchStartedAt: true },
  });
  let expired = 0;
  for (const candidate of candidates) {
    if (!v2SearchWindowElapsed(candidate.searchStartedAt, now)) {
      continue;
    }
    if (await expireLockedV2Search(tx, candidate.id, candidate.searchStartedAt, now)) {
      expired += 1;
    }
    if (expired >= 50) {
      break;
    }
  }
  return expired;
}

export async function expireLockedV2Search(
  tx: Prisma.TransactionClient,
  deliveryId: string,
  claimedStartedAt: Date | null,
  now: Date,
): Promise<boolean> {
  await tx.$queryRaw`SELECT "id" FROM "deliveries" WHERE "id" = CAST(${deliveryId} AS uuid) FOR UPDATE`;
  const delivery = await tx.delivery.findUnique({ where: { id: deliveryId } });
  if (!delivery) {
    return false;
  }
  const openBids = (await tx.bid.findMany({
    where: { deliveryId, status: BidStatus.OPEN },
    select: { id: true },
  })).length;
  const acceptedAssignments = (await tx.deliveryAssignment.findMany({
    where: { deliveryId, status: AssignmentStatus.ACCEPTED },
    select: { id: true },
  })).length;
  const decision = v2SearchExpiryDecision({
    status: delivery.status,
    serviceClass: delivery.serviceClass,
    searchGeneration: delivery.searchGeneration,
    searchStartedAt: delivery.searchStartedAt,
    claimedStartedAt,
    openBids,
    acceptedAssignments,
    deliverBy: delivery.deliverBy,
    now,
  });
  if (decision !== 'expire') {
    return false;
  }
  await tx.delivery.update({
    where: { id: delivery.id },
    data: { status: DeliveryStatus.NO_RIDER_FOUND, nextRetryAt: null, updatedAt: now },
  });
  await tx.deliveryStatusEvent.create({
    data: {
      deliveryId: delivery.id,
      previousStatus: DeliveryStatus.CREATED,
      newStatus: DeliveryStatus.NO_RIDER_FOUND,
      actorId: null,
      actorType: DeliveryActorType.SYSTEM,
      occurredAt: now,
    },
  });
  return true;
}

export async function restartV2Search(
  tx: Prisma.TransactionClient,
  delivery: SearchDelivery,
  actorId: string,
  now: Date,
): Promise<{ deliveryId: string; status: DeliveryStatus; searchGeneration: number }> {
  if (delivery.serviceClass !== 'EXPRESS' && delivery.serviceClass !== 'FLEXIBLE') {
    throw new ConflictException('This delivery cannot be searched');
  }
  if (!v2RequestRemainsOpen(delivery.deliverBy ?? null, now)) {
    throw new ConflictException('This delivery cannot be searched');
  }
  const accepted = await tx.deliveryAssignment.findMany({
    where: { deliveryId: delivery.id, status: AssignmentStatus.ACCEPTED },
    select: { id: true },
  });
  if (accepted.length > 0 || (delivery.status !== DeliveryStatus.NO_RIDER_FOUND && delivery.status !== DeliveryStatus.CREATED)) {
    throw new ConflictException('This delivery cannot be searched');
  }
  if (delivery.status === DeliveryStatus.CREATED) {
    return { deliveryId: delivery.id, status: DeliveryStatus.CREATED, searchGeneration: delivery.searchGeneration };
  }
  const started = v2SearchStartData(now);
  await tx.delivery.update({
    where: { id: delivery.id },
    data: { status: DeliveryStatus.CREATED, ...started, updatedAt: now },
  });
  await tx.deliveryStatusEvent.create({
    data: {
      deliveryId: delivery.id,
      previousStatus: DeliveryStatus.NO_RIDER_FOUND,
      newStatus: DeliveryStatus.CREATED,
      actorId,
      actorType: DeliveryActorType.CUSTOMER,
      occurredAt: now,
    },
  });
  return { deliveryId: delivery.id, status: DeliveryStatus.CREATED, searchGeneration: 0 };
}
