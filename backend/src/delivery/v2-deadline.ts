import {
  AssignmentStatus,
  BidStatus,
  DeliveryActorType,
  DeliveryStatus,
  Prisma,
} from '../generated/prisma/client.js';

// Closes a V2 request that reached deliverBy with no committed assignment.
// OPEN bids become EXPIRED and stay in the table. An accepted delivery is
// left active. Callers already include the bid submit, list, withdraw, and
// accept paths, so this does not add a scheduler.
export async function closeUnassignedV2Deliveries(
  tx: Prisma.TransactionClient,
  now: Date,
  deliveryId?: string,
): Promise<void> {
  const due = await tx.delivery.findMany({
    where: {
      ...(deliveryId ? { id: deliveryId } : {}),
      status: DeliveryStatus.CREATED,
      searchGeneration: 0,
      serviceClass: { not: null },
      deliverBy: { lte: now },
    },
    orderBy: { id: 'asc' },
    select: { id: true },
  });
  for (const row of due) {
    await tx.$queryRaw`SELECT "id" FROM "deliveries" WHERE "id" = CAST(${row.id} AS uuid) FOR UPDATE`;
    const delivery = await tx.delivery.findUnique({ where: { id: row.id } });
    if (
      !delivery
      || delivery.status !== DeliveryStatus.CREATED
      || delivery.searchGeneration !== 0
      || delivery.serviceClass == null
      || delivery.deliverBy == null
      || delivery.deliverBy.getTime() > now.getTime()
    ) {
      continue;
    }
    const accepted = await tx.deliveryAssignment.findFirst({
      where: { deliveryId: delivery.id, status: AssignmentStatus.ACCEPTED },
    });
    if (accepted) {
      continue;
    }
    const liveAcceptance = await tx.bid.findFirst({
      where: { deliveryId: delivery.id, status: BidStatus.ACCEPTED, closedAt: null },
    });
    if (liveAcceptance) {
      continue;
    }
    await tx.bid.updateMany({
      where: { deliveryId: delivery.id, status: BidStatus.OPEN },
      data: { status: BidStatus.EXPIRED },
    });
    await tx.delivery.update({
      where: { id: delivery.id },
      data: { status: DeliveryStatus.CANCELLED, updatedAt: now },
    });
    await tx.deliveryStatusEvent.create({
      data: {
        deliveryId: delivery.id,
        previousStatus: DeliveryStatus.CREATED,
        newStatus: DeliveryStatus.CANCELLED,
        actorId: null,
        actorType: DeliveryActorType.SYSTEM,
        occurredAt: now,
      },
    });
  }
}
