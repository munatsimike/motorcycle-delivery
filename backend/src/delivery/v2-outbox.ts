import { DeliveryStatus, Prisma, V2OutboxEventType } from '../generated/prisma/client.js';
import { assignmentNoticeDedupe, insertMarketplaceNotice, opportunityDedupe, approvalDedupe, bidNoticeDedupe, customerBidNoticeType } from './v2-marketplace-notice.js';

// Writes the rider notice for a committed acceptance. The unique
// (assignment, event type) key rejects a second row. Call this in the
// acceptance transaction, after the assignment exists. A future worker
// reads PENDING rows; this function does not send a push.
export async function recordBidAccepted(
  tx: Prisma.TransactionClient,
  input: { deliveryId: string; assignmentId: string; riderProfileId: string },
): Promise<void> {
  await tx.v2OutboxEvent.create({
    data: {
      eventType: V2OutboxEventType.BID_ACCEPTED,
      dedupeKey: assignmentNoticeDedupe(input.assignmentId, V2OutboxEventType.BID_ACCEPTED),
      deliveryId: input.deliveryId,
      assignmentId: input.assignmentId,
      riderProfileId: input.riderProfileId,
    },
  });
}

// Writes the customer notice when a rider cancellation reopens the original
// request. A cancellation that closes the request after the deadline writes
// nothing. Call this in that same cancellation transaction.
export async function recordRequestReopened(
  tx: Prisma.TransactionClient,
  input: { deliveryId: string; assignmentId: string; customerAccountId: string },
): Promise<void> {
  await tx.v2OutboxEvent.create({
    data: {
      eventType: V2OutboxEventType.REQUEST_REOPENED,
      dedupeKey: assignmentNoticeDedupe(input.assignmentId, V2OutboxEventType.REQUEST_REOPENED),
      deliveryId: input.deliveryId,
      assignmentId: input.assignmentId,
      customerAccountId: input.customerAccountId,
    },
  });
}

const CUSTOMER_STATUS_EVENT: Partial<Record<DeliveryStatus, V2OutboxEventType>> = {
  [DeliveryStatus.COLLECTING]: V2OutboxEventType.COLLECTING,
  [DeliveryStatus.COLLECTED]: V2OutboxEventType.COLLECTED,
  [DeliveryStatus.OUT_FOR_DELIVERY]: V2OutboxEventType.OUT_FOR_DELIVERY,
  [DeliveryStatus.DELIVERED]: V2OutboxEventType.DELIVERED,
};

// Writes the customer notice for a committed V2 status step. Call this in
// the same transaction as the status change, after commission capture when
// the step is DELIVERED. A replay returns before this function runs. The
// unique (assignment, event type) key rejects a second row.
export async function recordV2CustomerStatus(
  tx: Prisma.TransactionClient,
  input: {
    status: DeliveryStatus;
    deliveryId: string;
    assignmentId: string;
    customerAccountId: string;
  },
): Promise<void> {
  const eventType = CUSTOMER_STATUS_EVENT[input.status];
  if (!eventType) {
    return;
  }
  await tx.v2OutboxEvent.create({
    data: {
      eventType,
      dedupeKey: assignmentNoticeDedupe(input.assignmentId, eventType),
      deliveryId: input.deliveryId,
      assignmentId: input.assignmentId,
      customerAccountId: input.customerAccountId,
    },
  });
}

export async function recordDeliveryOpportunity(
  tx: Prisma.TransactionClient,
  input: { deliveryId: string; openedAt: Date },
): Promise<void> {
  await insertMarketplaceNotice(tx, {
    eventType: 'RIDER_OPPORTUNITY',
    deliveryId: input.deliveryId,
    riderProfileId: null,
    customerAccountId: null,
    createdAt: input.openedAt,
    dedupeKey: opportunityDedupe(input.deliveryId, input.openedAt),
  });
}

export async function recordCustomerBidNotice(
  tx: Prisma.TransactionClient,
  input: {
    bidId: string;
    deliveryId: string;
    customerAccountId: string;
    amountCents: number;
    offeredCents: number;
    createdAt: Date;
  },
): Promise<void> {
  const eventType = customerBidNoticeType(input.amountCents, input.offeredCents);
  await insertMarketplaceNotice(tx, {
    eventType,
    deliveryId: input.deliveryId,
    riderProfileId: null,
    customerAccountId: input.customerAccountId,
    createdAt: input.createdAt,
    dedupeKey: bidNoticeDedupe(input.bidId, eventType),
  });
}

export async function recordRiderApproved(
  tx: Prisma.TransactionClient,
  input: { riderProfileId: string; approvedAt: Date },
): Promise<void> {
  await insertMarketplaceNotice(tx, {
    eventType: 'ACCOUNT_APPROVED',
    deliveryId: null,
    riderProfileId: input.riderProfileId,
    customerAccountId: null,
    createdAt: input.approvedAt,
    dedupeKey: approvalDedupe(input.riderProfileId, input.approvedAt),
  });
}
