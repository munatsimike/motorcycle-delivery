import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { CoordinateSource, DeliveryStatus, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { createGooglePlacesClient } from './google-places.js';
import {
  ACTIVE_DELIVERY_STATUSES,
  COORDINATE_DELETION_BUFFER_MS,
  COORDINATE_REFRESH_LEAD_MS,
  COORDINATE_RETENTION_BATCH,
  COORDINATE_RETENTION_MS,
  type RetentionRunResult,
  type RetentionStore,
  type StopSide,
  type StoredRetentionDelivery,
  type StoredStop,
  runRetention,
} from './coordinate-retention.js';

@Injectable()
export class CoordinateRetentionService {
  private readonly logger = new Logger(CoordinateRetentionService.name);
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  async run(now = new Date()): Promise<RetentionRunResult> {
    if (this.running) {
      return { status: 'overlap', refreshed: 0, cleared: 0, refreshFailed: 0 };
    }
    this.running = true;
    try {
      const places = createGooglePlacesClient();
      return await runRetention(
        new PrismaRetentionStore(this.prisma),
        (placeId) => places.location(placeId),
        now,
        () => new Date(),
        (message) => this.logger.log(message),
        randomUUID(),
      );
    } finally {
      this.running = false;
    }
  }
}

type DeliveryRow = {
  id: string;
  status: DeliveryStatus;
  createdAt: Date;
  pickupPlaceId: string | null;
  pickupCoordinateSource: CoordinateSource;
  pickupLatitude: { toFixed(digits: number): string } | string | null;
  pickupLongitude: { toFixed(digits: number): string } | string | null;
  pickupCoordinateRetrievedAt: Date | null;
  pickupCoordinateRefreshAttemptedAt: Date | null;
  dropoffPlaceId: string | null;
  dropoffCoordinateSource: CoordinateSource;
  dropoffLatitude: { toFixed(digits: number): string } | string | null;
  dropoffLongitude: { toFixed(digits: number): string } | string | null;
  dropoffCoordinateRetrievedAt: Date | null;
  dropoffCoordinateRefreshAttemptedAt: Date | null;
};

export class PrismaRetentionStore implements RetentionStore {
  constructor(private readonly prisma: PrismaService) {}

  async claim(owner: string, now: Date, leaseMs: number): Promise<boolean> {
    const claimed = await this.prisma.coordinateRetentionLock.updateMany({
      where: {
        id: 1,
        OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
      },
      data: { owner, lockedUntil: new Date(now.getTime() + leaseMs) },
    });
    return claimed.count === 1;
  }

  async renew(owner: string, now: Date, leaseMs: number): Promise<boolean> {
    const renewed = await this.prisma.coordinateRetentionLock.updateMany({
      where: { id: 1, owner },
      data: { lockedUntil: new Date(now.getTime() + leaseMs) },
    });
    return renewed.count === 1;
  }

  async release(owner: string): Promise<void> {
    await this.prisma.coordinateRetentionLock.updateMany({
      where: { id: 1, owner },
      data: { owner: null, lockedUntil: null },
    });
  }

  async listCandidates(now: Date): Promise<StoredRetentionDelivery[]> {
    const expiry = new Date(now.getTime() - (COORDINATE_RETENTION_MS - COORDINATE_DELETION_BUFFER_MS));
    const horizon = new Date(now.getTime() - (COORDINATE_RETENTION_MS - COORDINATE_REFRESH_LEAD_MS));
    const rows = await this.prisma.delivery.findMany({
      where: {
        OR: [
          googleDue('pickup', expiry, horizon),
          googleDue('dropoff', expiry, horizon),
          unreviewedDue('pickup', expiry),
          unreviewedDue('dropoff', expiry),
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: COORDINATE_RETENTION_BATCH * 4,
      select: {
        id: true,
        status: true,
        createdAt: true,
        pickupPlaceId: true,
        pickupCoordinateSource: true,
        pickupLatitude: true,
        pickupLongitude: true,
        pickupCoordinateRetrievedAt: true,
        pickupCoordinateRefreshAttemptedAt: true,
        dropoffPlaceId: true,
        dropoffCoordinateSource: true,
        dropoffLatitude: true,
        dropoffLongitude: true,
        dropoffCoordinateRetrievedAt: true,
        dropoffCoordinateRefreshAttemptedAt: true,
      },
    });
    return rows.map(toDelivery);
  }

  async clearCoordinates(id: string, side: StopSide, expected: StoredStop): Promise<boolean> {
    const cleared = await this.prisma.delivery.updateMany({
      where: stopWhere(id, side, expected),
      data: side === 'pickup'
        ? { pickupLatitude: null, pickupLongitude: null }
        : { dropoffLatitude: null, dropoffLongitude: null },
    });
    return cleared.count === 1;
  }

  async recordRefreshFailure(id: string, side: StopSide, expected: StoredStop, attemptedAt: Date): Promise<boolean> {
    const recorded = await this.prisma.delivery.updateMany({
      where: {
        ...stopWhere(id, side, expected),
        ...(side === 'pickup'
          ? { pickupCoordinateRefreshAttemptedAt: null }
          : { dropoffCoordinateRefreshAttemptedAt: null }),
      },
      data: side === 'pickup'
        ? { pickupCoordinateRefreshAttemptedAt: attemptedAt }
        : { dropoffCoordinateRefreshAttemptedAt: attemptedAt },
    });
    return recorded.count === 1;
  }

  async saveRefresh(
    id: string,
    side: StopSide,
    expected: StoredStop,
    latitude: string,
    longitude: string,
    retrievedAt: Date,
  ): Promise<boolean> {
    const saved = await this.prisma.delivery.updateMany({
      where: stopWhere(id, side, expected),
      data: side === 'pickup'
        ? {
          pickupLatitude: latitude,
          pickupLongitude: longitude,
          pickupCoordinateRetrievedAt: retrievedAt,
          pickupCoordinateRefreshAttemptedAt: null,
        }
        : {
          dropoffLatitude: latitude,
          dropoffLongitude: longitude,
          dropoffCoordinateRetrievedAt: retrievedAt,
          dropoffCoordinateRefreshAttemptedAt: null,
        },
    });
    return saved.count === 1;
  }
}

function googleDue(side: StopSide, expiry: Date, horizon: Date): Prisma.DeliveryWhereInput {
  const source = side === 'pickup' ? 'pickupCoordinateSource' : 'dropoffCoordinateSource';
  const latitude = side === 'pickup' ? 'pickupLatitude' : 'dropoffLatitude';
  const longitude = side === 'pickup' ? 'pickupLongitude' : 'dropoffLongitude';
  const retrievedAt = side === 'pickup' ? 'pickupCoordinateRetrievedAt' : 'dropoffCoordinateRetrievedAt';
  const attemptedAt = side === 'pickup' ? 'pickupCoordinateRefreshAttemptedAt' : 'dropoffCoordinateRefreshAttemptedAt';
  return {
    [source]: CoordinateSource.GOOGLE_PLACES,
    OR: [{ [latitude]: { not: null } }, { [longitude]: { not: null } }],
    AND: [{
      OR: [
        { [retrievedAt]: null },
        { [retrievedAt]: { lte: expiry } },
        {
          [retrievedAt]: { lte: horizon },
          [attemptedAt]: null,
          status: { in: [...ACTIVE_DELIVERY_STATUSES] },
        },
      ],
    }],
  };
}

function unreviewedDue(side: StopSide, expiry: Date): Prisma.DeliveryWhereInput {
  const source = side === 'pickup' ? 'pickupCoordinateSource' : 'dropoffCoordinateSource';
  const latitude = side === 'pickup' ? 'pickupLatitude' : 'dropoffLatitude';
  const longitude = side === 'pickup' ? 'pickupLongitude' : 'dropoffLongitude';
  const retrievedAt = side === 'pickup' ? 'pickupCoordinateRetrievedAt' : 'dropoffCoordinateRetrievedAt';
  return {
    [source]: CoordinateSource.UNREVIEWED,
    OR: [{ [latitude]: { not: null } }, { [longitude]: { not: null } }],
    AND: [{
      OR: [
        { createdAt: { lte: expiry } },
        { [retrievedAt]: { lte: expiry } },
      ],
    }],
  };
}

function stopWhere(id: string, side: StopSide, expected: StoredStop): Prisma.DeliveryWhereInput {
  const latitude = side === 'pickup' ? 'pickupLatitude' : 'dropoffLatitude';
  const longitude = side === 'pickup' ? 'pickupLongitude' : 'dropoffLongitude';
  const source = side === 'pickup' ? 'pickupCoordinateSource' : 'dropoffCoordinateSource';
  const retrievedAt = side === 'pickup' ? 'pickupCoordinateRetrievedAt' : 'dropoffCoordinateRetrievedAt';
  return {
    id,
    [source]: expected.source,
    [retrievedAt]: expected.retrievedAt,
    OR: [{ [latitude]: { not: null } }, { [longitude]: { not: null } }],
  };
}

function toDelivery(row: DeliveryRow): StoredRetentionDelivery {
  return {
    id: row.id,
    status: row.status,
    createdAt: row.createdAt,
    pickup: toStop(row, 'pickup'),
    dropoff: toStop(row, 'dropoff'),
  };
}

function toStop(row: DeliveryRow, side: StopSide): StoredStop {
  if (side === 'pickup') {
    return {
      source: row.pickupCoordinateSource,
      placeId: row.pickupPlaceId,
      latitude: coordinateText(row.pickupLatitude),
      longitude: coordinateText(row.pickupLongitude),
      retrievedAt: row.pickupCoordinateRetrievedAt,
      refreshAttemptedAt: row.pickupCoordinateRefreshAttemptedAt,
    };
  }
  return {
    source: row.dropoffCoordinateSource,
    placeId: row.dropoffPlaceId,
    latitude: coordinateText(row.dropoffLatitude),
    longitude: coordinateText(row.dropoffLongitude),
    retrievedAt: row.dropoffCoordinateRetrievedAt,
    refreshAttemptedAt: row.dropoffCoordinateRefreshAttemptedAt,
  };
}

function coordinateText(value: { toFixed(digits: number): string } | string | null): string | null {
  if (value == null) {
    return null;
  }
  return typeof value === 'string' ? value : value.toFixed(7);
}
