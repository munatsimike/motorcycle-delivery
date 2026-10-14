import { readFileSync } from 'node:fs';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { describe, expect, it } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import { straightLineMetres } from './straight-line.js';
import {
  DISPATCH_ROUND_DELAYS_MS,
  DISPATCH_ROUND_RADII_METRES,
  GPS_FRESH_MS,
  OFFER_TTL_MS,
  gpsIsFresh,
  offerIsOpen,
} from './dispatch.constants.js';
import { DispatchService } from './dispatch.service.js';
import { formatSignedCents } from '../rider/wallet-money.js';

const NOW = new Date('2026-10-14T12:00:00.000Z');
const CUSTOMER = { userId: 'user-customer', role: 'CUSTOMER' as const, customerAccountId: 'account-1' };

describe('progressive dispatch', () => {
  it('does not retry after a rider accepts the delivery', async () => {
    const ctx = context();
    const { delivery } = await acceptJob(ctx, 'retry-stop');

    expect(ctx.deliveries[0].status).toBe('ASSIGNED');

    const later = new Date(NOW.getTime() + 120_000);

    await drain(ctx.service, later);

    expect(await ctx.service.processAutoRetry(later)).toBe(false);

    expect(ctx.deliveries[0].status).toBe('ASSIGNED');
    expect(ctx.deliveries[0].searchGeneration).toBe(1);
    expect(ctx.deliveries[0].autoRetryCount).toBe(0);
    expect(ctx.deliveries[0].nextRetryAt).toBeNull();

    expect(ctx.rounds.filter(
      (round) => round.deliveryId === delivery.id,
    )).toHaveLength(3);
  });

  it('does not retry after the customer cancels during the retry countdown', async () => {
    const ctx = context();
    const delivery = addDelivery(ctx);

    await ctx.service.search(CUSTOMER, delivery.id, NOW);

    const exhaustedAt = new Date(NOW.getTime() + 40_000);
    await drain(ctx.service, exhaustedAt);

    expect(await ctx.service.processAutoRetry(exhaustedAt)).toBe(true);
    expect(ctx.deliveries[0].nextRetryAt).toEqual(
      new Date(exhaustedAt.getTime() + 10_000),
    );

    await ctx.service.cancel(
      CUSTOMER,
      delivery.id,
      new Date(exhaustedAt.getTime() + 5_000),
    );

    expect(ctx.deliveries[0].status).toBe('CANCELLED');

    expect(
      await ctx.service.processAutoRetry(
        new Date(exhaustedAt.getTime() + 10_000),
      ),
    ).toBe(false);

    expect(ctx.deliveries[0].searchGeneration).toBe(1);
    expect(ctx.deliveries[0].autoRetryCount).toBe(0);
    expect(ctx.rounds).toHaveLength(3);
  });

  it('stops after five automatic retries and allows a manual restart', async () => {
    const ctx = context();
    const delivery = addDelivery(ctx);

    await ctx.service.search(CUSTOMER, delivery.id, NOW);

    for (let attempt = 0; attempt <= 5; attempt += 1) {
      const searchStart = new Date(NOW.getTime() + attempt * 50_000);
      const exhaustedAt = new Date(searchStart.getTime() + 40_000);

      await drain(ctx.service, exhaustedAt);

      expect(ctx.deliveries[0].searchGeneration).toBe(attempt + 1);
      expect(ctx.deliveries[0].autoRetryCount).toBe(attempt);

      expect(await ctx.service.processAutoRetry(exhaustedAt)).toBe(true);

      if (attempt < 5) {
        expect(ctx.deliveries[0].nextRetryAt).toEqual(
          new Date(exhaustedAt.getTime() + 10_000),
        );

        expect(
          await ctx.service.processAutoRetry(
            new Date(exhaustedAt.getTime() + 10_000),
          ),
        ).toBe(true);
      }
    }

    expect(ctx.deliveries[0].status).toBe('NO_RIDER_FOUND');
    expect(ctx.deliveries[0].autoRetryCount).toBe(5);
    expect(ctx.deliveries[0].searchGeneration).toBe(6);
    expect(ctx.deliveries[0].nextRetryAt).toBeNull();

    expect(await ctx.service.processAutoRetry(
      new Date(NOW.getTime() + 400_000),
    )).toBe(false);

    const restarted = await ctx.service.search(
      CUSTOMER,
      delivery.id,
      new Date(NOW.getTime() + 400_000),
    );

    expect(restarted.searchGeneration).toBe(7);
    expect(restarted.status).toBe('SEARCHING');
    expect(ctx.deliveries[0].autoRetryCount).toBe(0);
  });

  it('starts an automatic retry only after the 10-second delay', async () => {
    const ctx = context();
    const delivery = addDelivery(ctx);

    await ctx.service.search(CUSTOMER, delivery.id, NOW);
    await drain(ctx.service, new Date(NOW.getTime() + 40_000));

    const exhaustedAt = new Date(NOW.getTime() + 40_000);

    expect(await ctx.service.processAutoRetry(exhaustedAt)).toBe(true);
    expect(ctx.deliveries[0].autoRetryCount).toBe(0);
    expect(ctx.deliveries[0].nextRetryAt).toEqual(
      new Date(exhaustedAt.getTime() + 10_000),
    );

    expect(
      await ctx.service.processAutoRetry(new Date(exhaustedAt.getTime() + 9_999)),
    ).toBe(false);

    expect(ctx.deliveries[0].searchGeneration).toBe(1);

    expect(
      await ctx.service.processAutoRetry(new Date(exhaustedAt.getTime() + 10_000)),
    ).toBe(true);

    expect(ctx.deliveries[0].searchGeneration).toBe(2);
    expect(ctx.deliveries[0].autoRetryCount).toBe(1);
    expect(ctx.deliveries[0].nextRetryAt).toBeNull();
    expect(ctx.rounds.filter((round) => round.searchGeneration === 2)).toHaveLength(3);
  });

  it('keeps offers inside each radius and on the 20 and 40 second marks', async () => {
    const ctx = context();
    const near = addRider(ctx, 'near', longitudeFor(2_000), NOW);
    const secondRing = addRider(ctx, 'second', longitudeFor(2_001), NOW);
    const thirdRing = addRider(ctx, 'third', longitudeFor(7_000), NOW);
    const beyond = addRider(ctx, 'beyond', longitudeFor(10_001), NOW);
    const stale = addRider(ctx, 'stale', longitudeFor(100), new Date(NOW.getTime() - GPS_FRESH_MS));
    const ineligible = addRider(ctx, 'ineligible', longitudeFor(100), NOW, { approvalStatus: 'PENDING' });
    const delivery = addDelivery(ctx);

    expect(gpsIsFresh(stale.updatedAt, NOW)).toBe(false);
    expect(gpsIsFresh(new Date(NOW.getTime() - GPS_FRESH_MS + 1), NOW)).toBe(true);
    expect(offerIsOpen(new Date(NOW.getTime() + OFFER_TTL_MS), new Date(NOW.getTime() + OFFER_TTL_MS))).toBe(false);

    const started = await ctx.service.search(CUSTOMER, delivery.id, NOW);
    expect(started).toEqual({ deliveryId: delivery.id, status: 'SEARCHING', searchGeneration: 1 });
    expect(ctx.rounds.map((round) => [round.roundNumber, round.radiusMetres, round.dueAt.getTime() - NOW.getTime()]))
      .toEqual([
        [1, 2_000, 0],
        [2, 5_000, 20_000],
        [3, 10_000, 40_000],
      ]);
    await expect(ctx.service.search(CUSTOMER, delivery.id, NOW)).rejects.toBeInstanceOf(ConflictException);

    await drain(ctx.service, NOW);
    expect(offeredRiders(ctx, delivery.id)).toEqual([near.id]);
    expect(offeredRiders(ctx, delivery.id)).not.toContain(stale.id);
    expect(offeredRiders(ctx, delivery.id)).not.toContain(ineligible.id);

    await drain(ctx.service, new Date(NOW.getTime() + 19_000));
    expect(offeredRiders(ctx, delivery.id)).toEqual([near.id]);
    await drain(ctx.service, new Date(NOW.getTime() + DISPATCH_ROUND_DELAYS_MS[1]));
    expect(offeredRiders(ctx, delivery.id).sort()).toEqual([near.id, secondRing.id].sort());
    await drain(ctx.service, new Date(NOW.getTime() + DISPATCH_ROUND_DELAYS_MS[2]));
    expect(offeredRiders(ctx, delivery.id).sort()).toEqual([near.id, secondRing.id, thirdRing.id].sort());
    expect(offeredRiders(ctx, delivery.id)).not.toContain(beyond.id);
    expect(ctx.rounds.every((round) => round.status === 'COMPLETED')).toBe(true);

    const offers = await ctx.service.listOffers(rider(secondRing.id), new Date(NOW.getTime() + 20_000));
    expect(offers.offers[0]).toMatchObject({ offeredPrice: '4.50', payer: 'SENDER', paymentMethod: 'CASH' });
    expect(offers.offers[0]).not.toHaveProperty('suggestedPrice');
    expect(JSON.stringify(offers)).not.toContain('8.88');
    expect(JSON.stringify(offers)).not.toContain(secondRing.location.longitude);
    expect(JSON.stringify(started)).not.toContain(secondRing.location.longitude);

    await expect(ctx.service.search(CUSTOMER, delivery.id, new Date(NOW.getTime() + 99_000)))
      .rejects.toBeInstanceOf(ConflictException);
    await expect(ctx.service.search(CUSTOMER, delivery.id, new Date(NOW.getTime() + 100_000)))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('lets two workers claim different rounds and still offers each rider once', async () => {
    const ctx = context();
    const first = addRider(ctx, 'first', longitudeFor(2_000), NOW);
    const second = addRider(ctx, 'second', longitudeFor(2_001), NOW);
    const delivery = addDelivery(ctx);
    await ctx.service.search(CUSTOMER, delivery.id, NOW);
    const later = new Date(NOW.getTime() + 40_000);
    const other = new DispatchService(ctx.prisma);
    const claimed = await Promise.allSettled([
      ctx.service.processDueRound(later),
      other.processDueRound(later),
    ]);
    expect(claimed.filter((result) => result.status === 'fulfilled').length).toBe(2);
    await drain(ctx.service, later);
    const riders = ctx.assignments
      .filter((row) => row.deliveryId === delivery.id && row.status === 'OFFERED')
      .map((row) => row.riderProfileId);
    expect(riders.sort()).toEqual([first.id, second.id].sort());
    expect(new Set(riders).size).toBe(riders.length);
  });

  it('reserves only the platform fee and keeps acceptance idempotent', async () => {
    const ctx = context();
    const winner = addRider(ctx, 'winner', longitudeFor(500), fresh(NOW));
    const loser = addRider(ctx, 'loser', longitudeFor(600), fresh(NOW));
    const delivery = addDelivery(ctx);
    await ctx.service.search(CUSTOMER, delivery.id, NOW);
    await drain(ctx.service, NOW);
    const winnerOffer = offerFor(ctx, winner.id);
    const loserOffer = offerFor(ctx, loser.id);

    const accepted = await Promise.allSettled([
      ctx.service.accept(rider(winner.id), winnerOffer.id, 'accept-1', NOW),
      ctx.service.accept(rider(loser.id), loserOffer.id, 'accept-2', NOW),
    ]);
    const won = accepted.find((result) => result.status === 'fulfilled');
    const lost = accepted.find((result) => result.status === 'rejected');
    expect(won?.status).toBe('fulfilled');
    expect(lost?.status).toBe('rejected');
    if (won?.status === 'fulfilled') {
      expect(won.value.reservedFee).toBe('0.30');
      expect(won.value.configVersion).toBe(3);
      expect(won.value.replayed).toBe(false);
    }
    expect(ctx.reservations).toHaveLength(1);
    expect(ctx.reservations[0]).toMatchObject({ amount: '0.30', status: 'OPEN', configVersion: 3 });
    expect(ctx.entries).toHaveLength(0);
    expect(ctx.wallets.every((wallet) => wallet.balance === '0.00')).toBe(true);
    expect(ctx.profiles.find((profile) => profile.id === winner.id)?.availability).toBe('BUSY');
    expect(ctx.assignments.filter((row) => row.status === 'ACCEPTED')).toHaveLength(1);
    expect(ctx.assignments.find((row) => row.status === 'ACCEPTED')).toMatchObject({
      acceptedPlatformFee: '0.30',
      acceptedFeeConfigVersion: 3,
    });
    expect(ctx.assignments.filter((row) => row.status !== 'ACCEPTED').every((row) => (
      row.acceptedPlatformFee == null && row.acceptedFeeConfigVersion == null
    ))).toBe(true);
    expect(ctx.deliveries[0]?.status).toBe('ASSIGNED');

    const replay = await ctx.service.accept(rider(winner.id), winnerOffer.id, 'accept-1', NOW);
    expect(replay.replayed).toBe(true);
    expect(replay.assignmentId).toBe(winnerOffer.id);
    expect(ctx.reservations).toHaveLength(1);
    ctx.configs[0]!.isActive = false;
    ctx.configs.push({
      id: 'config-8',
      configVersion: 8,
      isActive: true,
      platformFee: '0.80',
      defaultBorrowingLimit: '1.00',
      currency: 'USD',
      welcomeBonus: '1.00',
    });
    const pricedReplay = await ctx.service.accept(rider(winner.id), winnerOffer.id, 'accept-1', NOW);
    expect(pricedReplay).toMatchObject({ replayed: true, reservedFee: '0.30', configVersion: 3 });
    expect(ctx.reservations).toHaveLength(1);

    const other = addDelivery(ctx, 'delivery-2');
    await ctx.service.search(CUSTOMER, other.id, NOW);
    await drain(ctx.service, NOW);
    const secondOffer = ctx.assignments.find((row) => row.deliveryId === other.id && row.status === 'OFFERED');
    await expect(ctx.service.accept(rider(winner.id), secondOffer?.id ?? '', 'accept-1', NOW))
      .rejects.toBeInstanceOf(ConflictException);
    expect(ctx.reservations).toHaveLength(1);

    const locks = ctx.lockLog;
    expect(locks.indexOf('wallet')).toBeGreaterThan(locks.indexOf('assignment'));
    expect(locks.indexOf('assignment')).toBeGreaterThan(locks.indexOf('profile'));
    expect(locks.indexOf('profile')).toBeGreaterThan(locks.indexOf('delivery'));
  });

  it('rejects an expired, ineligible, or underfunded acceptance without reserving', async () => {
    const ctx = context();
    const riderRow = addRider(ctx, 'rider', longitudeFor(500), fresh(NOW));
    const delivery = addDelivery(ctx);
    await ctx.service.search(CUSTOMER, delivery.id, NOW);
    await drain(ctx.service, NOW);
    const offer = offerFor(ctx, riderRow.id);
    await expect(ctx.service.accept(rider(riderRow.id), offer.id, 'late', new Date(NOW.getTime() + OFFER_TTL_MS)))
      .rejects.toBeInstanceOf(ConflictException);
    expect(ctx.assignments[0]?.status).toBe('EXPIRED');
    expect(ctx.reservations).toHaveLength(0);

    const funded = context();
    const rich = addRider(funded, 'rich', longitudeFor(500), fresh(NOW));
    rich.wallet.borrowingLimitOverride = '0.00';
    const job = addDelivery(funded);
    await funded.service.search(CUSTOMER, job.id, NOW);
    await drain(funded.service, NOW);
    await expect(funded.service.accept(rider(rich.id), offerFor(funded, rich.id).id, 'poor', NOW))
      .rejects.toBeInstanceOf(ConflictException);
    expect(funded.reservations).toHaveLength(0);
    expect(offerFor(funded, rich.id).status).toBe('OFFERED');
    expect(funded.wallets[0]?.balance).toBe('0.00');

    const free = context();
    const waived = addRider(free, 'waived', longitudeFor(500), fresh(NOW));
    free.configs[0]!.platformFee = '0.00';
    const waivedJob = addDelivery(free);
    await free.service.search(CUSTOMER, waivedJob.id, NOW);
    await drain(free.service, NOW);
    const waivedOfferId = offerFor(free, waived.id).id;
    const result = await free.service.accept(rider(waived.id), waivedOfferId, 'free', NOW);
    expect(result.reservedFee).toBe('0.00');
    expect(result.configVersion).toBe(3);
    expect(free.reservations).toHaveLength(0);
    expect(free.entries).toHaveLength(0);
    expect(free.assignments.find((row) => row.status === 'ACCEPTED')).toMatchObject({
      acceptedPlatformFee: '0.00',
      acceptedFeeConfigVersion: 3,
    });
    free.configs[0]!.isActive = false;
    free.configs.push({
      id: 'config-9',
      configVersion: 9,
      isActive: true,
      platformFee: '0.90',
      defaultBorrowingLimit: '1.00',
      currency: 'USD',
      welcomeBonus: '1.00',
    });
    const waivedReplay = await free.service.accept(rider(waived.id), waivedOfferId, 'free', NOW);
    expect(waivedReplay).toMatchObject({ replayed: true, reservedFee: '0.00', configVersion: 3 });
  });

  it('cancels before pickup, restores availability, and excludes a released rider', async () => {
    const ctx = context();
    const accepted = addRider(ctx, 'accepted', longitudeFor(500), NOW);
    const other = addRider(ctx, 'other', longitudeFor(700), NOW);
    const delivery = addDelivery(ctx);
    await ctx.service.search(CUSTOMER, delivery.id, NOW);
    await drain(ctx.service, NOW);
    const acceptedOfferId = offerFor(ctx, accepted.id).id;
    await ctx.service.accept(rider(accepted.id), acceptedOfferId, 'accept-1', NOW);

    const cancelled = context();
    const busy = addRider(cancelled, 'busy', longitudeFor(500), fresh(NOW));
    const cancelJob = addDelivery(cancelled);
    await cancelled.service.search(CUSTOMER, cancelJob.id, NOW);
    await drain(cancelled.service, NOW);
    await cancelled.service.accept(rider(busy.id), offerFor(cancelled, busy.id).id, 'accept-1', NOW);
    const busyProfile = cancelled.profiles.find((profile) => profile.id === busy.id);
    if (!busyProfile) {
      throw new Error('missing profile');
    }
    busyProfile.verificationStatus = 'REJECTED';
    await cancelled.service.cancel(CUSTOMER, cancelJob.id, NOW);
    expect(cancelled.deliveries[0]?.status).toBe('CANCELLED');
    expect(cancelled.profiles.find((profile) => profile.id === busy.id)?.availability).toBe('OFFLINE');
    expect(cancelled.reservations[0]?.status).toBe('RELEASED');
    expect(cancelled.assignments.find((row) => row.status === 'RELEASED')).toMatchObject({
      acceptedPlatformFee: '0.30',
      acceptedFeeConfigVersion: 3,
    });
    expect(cancelled.entries).toHaveLength(0);
    expect(cancelled.wallets[0]?.balance).toBe('0.00');

    const offline = context();
    const parked = addRider(offline, 'parked', longitudeFor(500), fresh(NOW));
    const parkedJob = addDelivery(offline);
    await offline.service.search(CUSTOMER, parkedJob.id, NOW);
    await drain(offline.service, NOW);
    await offline.service.accept(rider(parked.id), offerFor(offline, parked.id).id, 'accept-1', NOW);
    const parkedProfile = offline.profiles.find((profile) => profile.id === parked.id);
    if (!parkedProfile) {
      throw new Error('missing profile');
    }
    parkedProfile.availability = 'OFFLINE';
    await offline.service.cancel(CUSTOMER, parkedJob.id, NOW);
    expect(offline.profiles.find((profile) => profile.id === parked.id)?.availability).toBe('OFFLINE');

    await ctx.service.release(rider(accepted.id), acceptedOfferId, { reason: 'RIDER_CANCELLED' }, NOW);
    expect(ctx.deliveries[0]?.status).toBe('SEARCHING');
    expect(ctx.deliveries[0]?.searchGeneration).toBe(2);
    expect(ctx.assignments.find((row) => row.riderProfileId === accepted.id)?.status).toBe('RELEASED');
    expect(ctx.assignments.find((row) => row.riderProfileId === accepted.id)).toMatchObject({
      acceptedPlatformFee: '0.30',
      acceptedFeeConfigVersion: 3,
    });
    expect(ctx.reservations[0]?.status).toBe('RELEASED');
    expect(ctx.profiles.find((profile) => profile.id === accepted.id)?.availability).toBe('AVAILABLE');
    const acceptedLocation = ctx.locations.find((location) => location.riderProfileId === accepted.id);
    if (acceptedLocation) {
      acceptedLocation.updatedAt = fresh(NOW);
    }
    await drain(ctx.service, NOW);
    expect(offeredRiders(ctx, delivery.id)).toEqual([other.id]);
    expect(ctx.assignments.some((row) => row.riderProfileId === accepted.id && row.status === 'RELEASED')).toBe(true);
    expect(ctx.events.map((event) => event.newStatus)).toEqual(['SEARCHING', 'ASSIGNED', 'SEARCHING']);

    await expect(ctx.service.release(rider(other.id), 'missing', { reason: 'CUSTOMER_CANCELLED' }, NOW))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(ctx.service.release(rider(other.id), 'missing', { reason: 'RIDER_CANCELLED' }, NOW))
      .rejects.toBeInstanceOf(NotFoundException);
    ctx.deliveries[0]!.status = 'PICKED_UP';
    await expect(ctx.service.cancel(CUSTOMER, delivery.id, NOW)).rejects.toBeInstanceOf(ConflictException);
  });

  it('advances one status at a time and captures the reserved fee only when delivered', async () => {
    const ctx = context();
    const { riderRow, delivery } = await acceptJob(ctx, 'courier');
    const steps = ['ARRIVED_AT_PICKUP', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVED_AT_DROPOFF', 'DELIVERED'] as const;
    for (const status of steps) {
      const mark = ctx.lockLog.length;
      const result = await ctx.service.progress(rider(riderRow.id), delivery.id, { status, riderProfileId: 'other' }, NOW);
      expect(result).toMatchObject({
        deliveryId: delivery.id,
        status,
        availability: status === 'DELIVERED' ? 'AVAILABLE' : 'BUSY',
      });
      const locks = ctx.lockLog.slice(mark);
      if (status === 'DELIVERED') {
        expect(locks).toEqual(['delivery', 'profile', 'assignment', 'profile', 'wallet']);
      } else {
        expect(locks).toEqual(['delivery', 'profile', 'assignment']);
        expect(ctx.reservations[0]?.status).toBe('OPEN');
        expect(ctx.entries.filter((entry) => entry.entryType === 'PLATFORM_FEE')).toHaveLength(0);
        expect(ctx.wallets[0]?.balance).toBe('0.00');
      }
    }
    expect(ctx.deliveries.find((row) => row.id === delivery.id)?.status).toBe('DELIVERED');
    expect(ctx.assignments.find((row) => row.riderProfileId === riderRow.id)).toMatchObject({
      status: 'COMPLETED',
      acceptedPlatformFee: '0.30',
      acceptedFeeConfigVersion: 3,
    });
    expect(ctx.reservations[0]).toMatchObject({ status: 'CAPTURED', amount: '0.30', configVersion: 3 });
    expect(ctx.entries.filter((entry) => entry.entryType === 'PLATFORM_FEE')).toEqual([
      expect.objectContaining({
        amount: '-0.30',
        configVersion: 3,
        actorType: 'SYSTEM',
        walletPaymentId: null,
      }),
    ]);
    expect(ctx.wallets[0]?.balance).toBe('-0.30');
    expect(ctx.events.filter((event) => event.actorType === 'RIDER' && event.newStatus !== 'ASSIGNED').map((event) => ({
      previousStatus: event.previousStatus,
      newStatus: event.newStatus,
      actorId: event.actorId,
    }))).toEqual([
      { previousStatus: 'ASSIGNED', newStatus: 'ARRIVED_AT_PICKUP', actorId: 'user-courier' },
      { previousStatus: 'ARRIVED_AT_PICKUP', newStatus: 'PICKED_UP', actorId: 'user-courier' },
      { previousStatus: 'PICKED_UP', newStatus: 'IN_TRANSIT', actorId: 'user-courier' },
      { previousStatus: 'IN_TRANSIT', newStatus: 'ARRIVED_AT_DROPOFF', actorId: 'user-courier' },
      { previousStatus: 'ARRIVED_AT_DROPOFF', newStatus: 'DELIVERED', actorId: 'user-courier' },
    ]);
    await expect(ctx.service.progress(rider(riderRow.id), delivery.id, { status: 'DELIVERED' }, NOW))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(ctx.entries.filter((entry) => entry.entryType === 'PLATFORM_FEE')).toHaveLength(1);
  });

  it('rejects skipped, backward, cancelled, and failed status changes', async () => {
    const ctx = context();
    const { riderRow, delivery } = await acceptJob(ctx, 'courier');
    const other = addRider(ctx, 'other', longitudeFor(700), fresh(NOW));
    await expect(ctx.service.progress(rider(other.id), delivery.id, { status: 'ARRIVED_AT_PICKUP' }, NOW))
      .rejects.toBeInstanceOf(NotFoundException);
    await expect(ctx.service.progress(rider(riderRow.id), delivery.id, { status: 'PICKED_UP' }, NOW))
      .rejects.toBeInstanceOf(ConflictException);
    await expect(ctx.service.progress(rider(riderRow.id), delivery.id, { status: 'CANCELLED' }, NOW))
      .rejects.toBeInstanceOf(ConflictException);
    await expect(ctx.service.progress(rider(riderRow.id), delivery.id, { status: 'FAILED' }, NOW))
      .rejects.toBeInstanceOf(ConflictException);
    await expect(ctx.service.progress(rider(riderRow.id), delivery.id, { status: 'ELSEWHERE' }, NOW))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(ctx.deliveries.find((row) => row.id === delivery.id)?.status).toBe('ASSIGNED');
    expect(ctx.events.filter((event) => event.actorType === 'RIDER' && event.newStatus !== 'ASSIGNED')).toHaveLength(0);

    await ctx.service.progress(rider(riderRow.id), delivery.id, { status: 'ARRIVED_AT_PICKUP' }, NOW);
    await expect(ctx.service.progress(rider(riderRow.id), delivery.id, { status: 'ASSIGNED' }, NOW))
      .rejects.toBeInstanceOf(ConflictException);
    await ctx.service.release(rider(riderRow.id), ctx.assignments.find((row) => row.riderProfileId === riderRow.id)?.id ?? '', { reason: 'RIDER_CANCELLED' }, NOW);
    expect(ctx.reservations[0]?.status).toBe('RELEASED');
    expect(ctx.entries.filter((entry) => entry.entryType === 'PLATFORM_FEE')).toHaveLength(0);
    expect(ctx.assignments.find((row) => row.riderProfileId === riderRow.id)).toMatchObject({
      status: 'RELEASED',
      acceptedPlatformFee: '0.30',
      acceptedFeeConfigVersion: 3,
    });
  });

  it('lets one of two concurrent status updates win and keeps the fee until delivery', async () => {
    const ctx = context();
    const { riderRow, delivery } = await acceptJob(ctx, 'courier');
    const results = await Promise.allSettled([
      ctx.service.progress(rider(riderRow.id), delivery.id, { status: 'ARRIVED_AT_PICKUP' }, NOW),
      ctx.service.progress(rider(riderRow.id), delivery.id, { status: 'ARRIVED_AT_PICKUP' }, NOW),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(ctx.deliveries.find((row) => row.id === delivery.id)?.status).toBe('ARRIVED_AT_PICKUP');
    expect(ctx.events.filter((event) => event.newStatus === 'ARRIVED_AT_PICKUP')).toHaveLength(1);
    expect(ctx.reservations[0]?.status).toBe('OPEN');

    await ctx.service.progress(rider(riderRow.id), delivery.id, { status: 'PICKED_UP' }, NOW);
    await expect(ctx.service.release(
      rider(riderRow.id),
      ctx.assignments.find((row) => row.riderProfileId === riderRow.id)?.id ?? '',
      { reason: 'VEHICLE_PROBLEM' },
      NOW,
    )).rejects.toBeInstanceOf(ConflictException);
    await expect(ctx.service.cancel(CUSTOMER, delivery.id, NOW)).rejects.toBeInstanceOf(ConflictException);
    expect(ctx.reservations[0]?.status).toBe('OPEN');
    expect(ctx.deliveries.find((row) => row.id === delivery.id)?.status).toBe('PICKED_UP');
  });

  it('uses the accepted fee snapshot and rolls a failed delivery back', async () => {
    const changed = context();
    const changedJob = await acceptJob(changed, 'changed');
    changed.configs[0]!.isActive = false;
    changed.configs.push({
      id: 'config-8',
      configVersion: 8,
      isActive: true,
      platformFee: '0.80',
      defaultBorrowingLimit: '1.00',
      currency: 'USD',
      welcomeBonus: '1.00',
    });
    for (const status of ['ARRIVED_AT_PICKUP', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVED_AT_DROPOFF', 'DELIVERED'] as const) {
      await changed.service.progress(rider(changedJob.riderRow.id), changedJob.delivery.id, { status }, NOW);
    }
    expect(changed.entries.find((entry) => entry.entryType === 'PLATFORM_FEE')).toMatchObject({
      amount: '-0.30',
      configVersion: 3,
    });

    const free = context();
    free.configs.push({
      id: 'config-free',
      configVersion: 3,
      isActive: true,
      platformFee: '0.00',
      defaultBorrowingLimit: '1.00',
      currency: 'USD',
      welcomeBonus: '1.00',
    });
    const waived = await acceptJob(free, 'waived');
    for (const status of ['ARRIVED_AT_PICKUP', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVED_AT_DROPOFF', 'DELIVERED'] as const) {
      await free.service.progress(rider(waived.riderRow.id), waived.delivery.id, { status }, NOW);
    }
    expect(free.reservations).toHaveLength(0);
    expect(free.entries).toHaveLength(0);
    expect(free.wallets[0]?.balance).toBe('0.00');
    expect(free.assignments.find((row) => row.status === 'COMPLETED')).toMatchObject({
      acceptedPlatformFee: '0.00',
      acceptedFeeConfigVersion: 3,
    });

    const failed = context();
    const failedJob = await acceptJob(failed, 'failed');
    for (const status of ['ARRIVED_AT_PICKUP', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVED_AT_DROPOFF'] as const) {
      await failed.service.progress(rider(failedJob.riderRow.id), failedJob.delivery.id, { status }, NOW);
    }
    failed.entries.push({
      id: 'stray',
      riderWalletId: failedJob.riderRow.wallet.id,
      entryType: 'TOP_UP',
      amount: '1.00',
      balanceAfter: '1.00',
      currency: 'USD',
      configVersion: 3,
      idempotencyKey: 'stray',
      payloadHash: 'b'.repeat(64),
      walletPaymentId: null,
      reason: null,
      actorType: 'SYSTEM',
      actorId: null,
    });
    await expect(failed.service.progress(rider(failedJob.riderRow.id), failedJob.delivery.id, { status: 'DELIVERED' }, NOW))
      .rejects.toBeInstanceOf(ConflictException);
    expect(failed.deliveries.find((row) => row.id === failedJob.delivery.id)?.status).toBe('ARRIVED_AT_DROPOFF');
    expect(failed.assignments.find((row) => row.riderProfileId === failedJob.riderRow.id)?.status).toBe('ACCEPTED');
    expect(failed.reservations[0]?.status).toBe('OPEN');
    expect(failed.entries.filter((entry) => entry.entryType === 'PLATFORM_FEE')).toHaveLength(0);
    expect(failed.wallets[0]?.balance).toBe('0.00');
  });

  it('describes the geographic query and the round schedule', () => {
    const sql = readFileSync('src/delivery/dispatch-query.ts', 'utf8');
    expect(sql).toContain('ST_DWithin');
    expect(sql).toContain('ST_MakePoint');
    expect(sql).toContain('4326');
    expect(sql).toContain('RELEASED');
    expect(DISPATCH_ROUND_RADII_METRES).toEqual([2_000, 5_000, 10_000]);
    expect(DISPATCH_ROUND_DELAYS_MS).toEqual([0, 20_000, 40_000]);
    expect(OFFER_TTL_MS).toBe(60_000);
    expect(GPS_FRESH_MS).toBe(60_000);
  });
});

type Row = Record<string, any>;

function context() {
  const committed = emptyState();
  const lockLog: string[] = [];
  const heldRounds = new Set<string>();
  const mutexes = new Map<string, Mutex>();
  let sequence = 1;
  let txSeq = 1;

  function commit(base: State, draft: State): void {
    const changes: Array<{ rows: Row[]; id: string; row: Row; insert: boolean }> = [];
    for (const key of STATE_KEYS) {
      const idField = key === 'locations' ? 'riderProfileId' : 'id';
      for (const row of draft[key]) {
        const id = String(row[idField]);
        const before = base[key].find((item) => item[idField] === row[idField]);
        if (before && stable(before) === stable(row)) {
          continue;
        }
        const current = committed[key].find((item) => item[idField] === row[idField]);
        if (!before) {
          if (current) {
            throw new Error('commit conflict');
          }
          changes.push({ rows: committed[key], id, row, insert: true });
          continue;
        }
        if (!current || stable(current) !== stable(before)) {
          throw new Error('commit conflict');
        }
        changes.push({ rows: committed[key], id, row, insert: false });
      }
    }
    for (const change of changes) {
      if (change.insert) {
        change.rows.push(structuredClone(change.row));
      } else {
        const index = change.rows.findIndex((item) => String(item.id ?? item.riderProfileId) === change.id);
        change.rows[index] = structuredClone(change.row);
      }
    }
  }

  const prisma = {
    async $transaction(fn: (tx: unknown) => Promise<unknown>) {
      const txId = txSeq;
      txSeq += 1;
      let base = structuredClone(committed);
      let draft = structuredClone(committed);
      let dirty = false;
      const releases: Array<() => void> = [];
      const mark = () => {
        dirty = true;
      };
      const refresh = () => {
        if (dirty) {
          return;
        }
        base = structuredClone(committed);
        draft = structuredClone(committed);
      };
      const tx = {
        async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
          const sql = strings.join(' ');
          if (sql.includes('SKIP LOCKED') && sql.includes('FROM "deliveries" d')) {
            const now = values[0] as Date;
            const eligible = draft.deliveries
              .filter((delivery) => delivery.status === 'SEARCHING' && delivery.searchGeneration > 0)
              .filter((delivery) => !draft.rounds.some(
                (round) => round.deliveryId === delivery.id && round.status === 'PENDING',
              ))
              .filter((delivery) => !draft.assignments.some(
                (offer) => offer.deliveryId === delivery.id
                  && offer.status === 'OFFERED'
                  && offer.offerExpiresAt > now,
              ))
              .filter((delivery) => !delivery.nextRetryAt || delivery.nextRetryAt <= now)
              .sort((a, b) => String(a.id).localeCompare(String(b.id)));

            return eligible.length ? [{ id: eligible[0].id }] : [];
          }

          if (sql.includes('SKIP LOCKED')) {
            const now = values[0] as Date;
            const due = draft.rounds
              .filter((row) => row.status === 'PENDING' && row.dueAt <= now && !heldRounds.has(String(row.id)))
              .sort((left, right) => left.dueAt.getTime() - right.dueAt.getTime() || String(left.id).localeCompare(String(right.id)));
            const picked = due[0];
            if (!picked) {
              return [];
            }
            heldRounds.add(String(picked.id));
            releases.push(() => heldRounds.delete(String(picked.id)));
            return [{ id: picked.id }];
          }
          if (sql.includes('ST_DWithin')) {
            const freshAfter = values[0] as Date;
            const longitude = Number(values[1]);
            const latitude = Number(values[2]);
            const radius = Number(values[3]);
            return draft.locations
              .filter((location) => location.updatedAt > freshAfter)
              .filter((location) => straightLineMetres(
                latitude,
                longitude,
                Number(location.latitude),
                Number(location.longitude),
              ) <= radius)
              .map((location) => ({ riderProfileId: location.riderProfileId }));
          }
          if (sql.includes('FOR UPDATE') && sql.includes('"deliveries"')) {
            lockLog.push('delivery');
            await hold(mutexes, `delivery:${String(values[0])}`, txId, releases);
            refresh();
            return [];
          }
          if (sql.includes('FOR UPDATE') && sql.includes('"rider_profiles"')) {
            lockLog.push('profile');
            await hold(mutexes, `profile:${String(values[0])}`, txId, releases);
            refresh();
            return [];
          }
          if (sql.includes('FOR UPDATE') && sql.includes('"delivery_assignments"')) {
            lockLog.push('assignment');
            await hold(mutexes, `assignment:${String(values[0])}`, txId, releases);
            refresh();
            return [];
          }
          if (sql.includes('FOR UPDATE') && sql.includes('"rider_wallets"')) {
            lockLog.push('wallet');
            await hold(mutexes, `wallet:${String(values[0])}`, txId, releases);
            refresh();
            return [];
          }
          return [];
        },
        delivery: table(() => draft.deliveries, mark, () => sequence++),
        deliveryAssignment: assignmentTable(() => draft.assignments, mark, () => sequence++),
        deliveryDispatchRound: roundTable(() => draft.rounds, mark, () => sequence++),
        deliveryStatusEvent: table(() => draft.events, mark, () => sequence++),
        riderProfile: table(() => draft.profiles, mark, () => sequence++),
        riderLocation: table(() => draft.locations, mark, () => sequence++),
        user: table(() => draft.users, mark, () => sequence++),
        motorcycle: table(() => draft.motorcycles, mark, () => sequence++),
        riderWallet: table(() => draft.wallets, mark, () => sequence++),
        riderWalletEntry: {
          ...table(() => draft.entries, mark, () => sequence++),
          async aggregate({ where }: { where?: Row }) {
            const rows = draft.entries.filter((row) => matches(row, where));
            if (rows.length === 0) {
              return { _sum: { amount: null } };
            }
            const total = rows.reduce((sum, row) => sum + cents(row.amount), 0);
            return { _sum: { amount: formatSignedCents(total) } };
          },
        },
        walletConfig: table(() => draft.configs, mark, () => sequence++),
        walletFeeReservation: reservationTable(() => draft.reservations, mark, () => sequence++),
      };
      try {
        const result = await fn(tx);
        commit(base, draft);
        return result;
      } finally {
        for (const release of releases.reverse()) {
          release();
        }
      }
    },
  };

  return {
    service: new DispatchService(prisma as unknown as PrismaService),
    prisma: prisma as unknown as PrismaService,
    lockLog,
    get deliveries() { return committed.deliveries; },
    get assignments() { return committed.assignments; },
    get rounds() { return committed.rounds; },
    get profiles() { return committed.profiles; },
    get wallets() { return committed.wallets; },
    get reservations() { return committed.reservations; },
    get entries() { return committed.entries; },
    get events() { return committed.events; },
    get configs() { return committed.configs; },
    get locations() { return committed.locations; },
    get users() { return committed.users; },
    get motorcycles() { return committed.motorcycles; },
  };
}

function addDelivery(ctx: ReturnType<typeof context>, id = 'delivery-1') {
  const row = {
    id,
    customerId: CUSTOMER.customerAccountId,
    status: 'CREATED',
    searchGeneration: 0,
    autoRetryCount: 0,
    nextRetryAt: null,
    searchStartedAt: null,
    price: '4.50',
    suggestedPrice: '8.88',
    pricingVersion: 7,
    distanceMeters: 12_345,
    currency: 'USD',
    payer: 'SENDER',
    paymentMethod: 'CASH',
    parcelDescription: 'Documents',
    parcelSize: 'SMALL',
    parcelInstructions: null,
    pickupAddress: 'Pickup',
    pickupLatitude: '0.0000000',
    pickupLongitude: '0.0000000',
    pickupLandmark: null,
    pickupInstructions: null,
    pickupContactName: 'Ada',
    pickupContactPhone: '+263771111111',
    dropoffAddress: 'Dropoff',
    dropoffLatitude: '0.0200000',
    dropoffLongitude: '0.0200000',
    dropoffLandmark: null,
    dropoffInstructions: null,
    recipientName: 'Bo',
    recipientPhone: '+263772222222',
  };
  ctx.deliveries.push(row);
  return row;
}

function addRider(
  ctx: ReturnType<typeof context>,
  name: string,
  longitude: string,
  updatedAt: Date,
  extra: { approvalStatus?: string } = {},
) {
  const id = `profile-${name}`;
  const profile = {
    id,
    userId: `user-${name}`,
    approvalStatus: extra.approvalStatus ?? 'APPROVED',
    verificationStatus: 'VERIFIED',
    availability: 'AVAILABLE',
  };
  const user = {
    id: profile.userId,
    accountStatus: 'ACTIVE',
    phoneVerifiedAt: NOW,
  };
  const motorcycle = {
    id: `bike-${name}`,
    riderProfileId: id,
    verificationStatus: 'VERIFIED',
    isActive: true,
  };
  const wallet = {
    id: `wallet-${name}`,
    riderProfileId: id,
    balance: '0.00',
    borrowingLimitOverride: null,
    welcomeBonusAwardedAt: NOW,
    currency: 'USD',
  };
  const location = {
    riderProfileId: id,
    latitude: '0.0000000',
    longitude,
    updatedAt,
  };
  ctx.profiles.push(profile);
  ctx.users.push(user);
  ctx.motorcycles.push(motorcycle);
  ctx.wallets.push(wallet);
  ctx.locations.push(location);
  if (ctx.configs.length === 0) {
    ctx.configs.push({
      id: 'config-1',
      configVersion: 3,
      isActive: true,
      platformFee: '0.30',
      defaultBorrowingLimit: '1.00',
      currency: 'USD',
      welcomeBonus: '1.00',
    });
  }
  return { id, profile, wallet, location, latitude: location.latitude, updatedAt };
}

async function acceptJob(ctx: ReturnType<typeof context>, name: string) {
  const riderRow = addRider(ctx, name, longitudeFor(500), fresh(NOW));
  const delivery = addDelivery(ctx, `delivery-${name}`);
  await ctx.service.search(CUSTOMER, delivery.id, NOW);
  await drain(ctx.service, NOW);
  await ctx.service.accept(rider(riderRow.id), offerFor(ctx, riderRow.id).id, `accept-${name}`, NOW);
  return { riderRow, delivery };
}

function rider(riderProfileId: string) {
  return { userId: `user-${riderProfileId.replace('profile-', '')}`, riderProfileId };
}

function offeredRiders(ctx: ReturnType<typeof context>, deliveryId: string): string[] {
  return ctx.assignments
    .filter((row) => row.deliveryId === deliveryId && row.status === 'OFFERED')
    .map((row) => String(row.riderProfileId));
}

function offerFor(ctx: ReturnType<typeof context>, riderProfileId: string) {
  const offer = ctx.assignments.find((row) => row.riderProfileId === riderProfileId && row.status === 'OFFERED');
  if (!offer) {
    throw new Error('missing offer');
  }
  return offer;
}

async function drain(service: DispatchService, now: Date): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const worked = await service.processDueRound(now);
    if (!worked) {
      return;
    }
  }
  throw new Error('dispatch rounds did not finish');
}

function fresh(now: Date): Date {
  return new Date(now.getTime() - GPS_FRESH_MS + 1);
}

function longitudeFor(metres: number): string {
  const estimate = metres / 111_320;
  for (let step = -5_000; step <= 5_000; step += 1) {
    const text = (estimate + step / 10_000_000).toFixed(7);
    if (straightLineMetres(0, 0, 0, Number(text)) === metres) {
      return text;
    }
  }
  throw new Error(`no coordinate for ${metres} metres`);
}

type State = {
  deliveries: Row[];
  assignments: Row[];
  rounds: Row[];
  locations: Row[];
  profiles: Row[];
  users: Row[];
  motorcycles: Row[];
  wallets: Row[];
  entries: Row[];
  reservations: Row[];
  configs: Row[];
  events: Row[];
};

const STATE_KEYS = [
  'deliveries',
  'assignments',
  'rounds',
  'locations',
  'profiles',
  'users',
  'motorcycles',
  'wallets',
  'entries',
  'reservations',
  'configs',
  'events',
] as const;

function emptyState(): State {
  return {
    deliveries: [],
    assignments: [],
    rounds: [],
    locations: [],
    profiles: [],
    users: [],
    motorcycles: [],
    wallets: [],
    entries: [],
    reservations: [],
    configs: [],
    events: [],
  };
}

function table(read: () => Row[], mark: () => void, nextId: () => number) {
  return {
    async findUnique({ where }: { where: Row }) {
      return clone(read().find((row) => matches(row, where)));
    },
    async findFirst({ where }: { where: Row }) {
      return clone(read().find((row) => matches(row, where)));
    },
    async findMany(args?: { where?: Row }) {
      return read().filter((row) => matches(row, args?.where)).map((row) => structuredClone(row));
    },
    async create({ data }: { data: Row }) {
      const row = { id: data.id ?? `id-${nextId()}`, ...data };
      read().push(row);
      mark();
      return structuredClone(row);
    },
    async update({ where, data }: { where: Row; data: Row }) {
      const row = read().find((item) => matches(item, where));
      if (!row) {
        throw new Error('missing row');
      }
      for (const [key, value] of Object.entries(data)) {
        if (
          value !== null &&
          typeof value === 'object' &&
          'increment' in value &&
          typeof value.increment === 'number'
        ) {
          row[key] = Number(row[key] ?? 0) + value.increment;
        } else {
          row[key] = value;
        }
      }
      mark();
      return structuredClone(row);
    },
  };
}

function assignmentTable(read: () => Row[], mark: () => void, nextId: () => number) {
  const rows = table(read, mark, nextId);
  return {
    ...rows,
    async create({ data }: { data: Row }) {
      assertAssignment(read(), { id: data.id ?? `id-${nextId()}`, ...data }, null);
      return rows.create({ data });
    },
    async update({ where, data }: { where: Row; data: Row }) {
      const current = read().find((row) => matches(row, where));
      if (!current) {
        throw new Error('missing assignment');
      }
      assertAssignment(read(), { ...current, ...data }, current);
      return rows.update({ where, data });
    },
  };
}

function roundTable(read: () => Row[], mark: () => void, nextId: () => number) {
  const rows = table(read, mark, nextId);
  return {
    ...rows,
    async create({ data }: { data: Row }) {
      const row = { id: data.id ?? `id-${nextId()}`, ...data };
      if (read().some((item) => item.deliveryId === row.deliveryId && item.searchGeneration === row.searchGeneration && item.roundNumber === row.roundNumber)) {
        throw uniqueError();
      }
      return rows.create({ data: row });
    },
  };
}

function reservationTable(read: () => Row[], mark: () => void, nextId: () => number) {
  const rows = table(read, mark, nextId);
  return {
    ...rows,
    async create({ data }: { data: Row }) {
      if (data.status === 'OPEN' && read().some((row) => row.deliveryId === data.deliveryId && row.status === 'OPEN')) {
        throw uniqueError();
      }
      return rows.create({ data });
    },
  };
}

function assertAssignment(rows: Row[], next: Row, current: Row | null): void {
  const others = rows.filter((row) => row !== current);
  if (next.idempotencyKey && others.some((row) => row.idempotencyKey === next.idempotencyKey)) {
    throw uniqueError();
  }
  if (next.status === 'OFFERED' || next.status === 'ACCEPTED') {
    if (others.some((row) => row.deliveryId === next.deliveryId && row.riderProfileId === next.riderProfileId && (row.status === 'OFFERED' || row.status === 'ACCEPTED'))) {
      throw uniqueError();
    }
  }
  if (next.status === 'ACCEPTED') {
    if (others.some((row) => row.status === 'ACCEPTED' && (row.deliveryId === next.deliveryId || row.riderProfileId === next.riderProfileId))) {
      throw uniqueError();
    }
  }
}

function uniqueError(): Error {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '7.1.0',
  });
}

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) {
    return true;
  }
  return Object.entries(where).every(([key, value]) => row[key] === value);
}

function clone(row: Row | undefined): Row | null {
  return row ? structuredClone(row) : null;
}

function stable(row: Row): string {
  return JSON.stringify(row);
}

function cents(value: unknown): number {
  const text = String(value ?? '0.00');
  const negative = text.startsWith('-');
  const [whole, fraction] = (negative ? text.slice(1) : text).split('.');
  const amount = Number(whole) * 100 + Number(fraction ?? '0');
  return negative ? -amount : amount;
}

type Mutex = { owner: number | null; depth: number; waiters: Array<() => void> };

async function hold(mutexes: Map<string, Mutex>, key: string, txId: number, releases: Array<() => void>): Promise<void> {
  let mutex = mutexes.get(key);
  if (!mutex) {
    mutex = { owner: null, depth: 0, waiters: [] };
    mutexes.set(key, mutex);
  }
  if (mutex.owner === txId) {
    mutex.depth += 1;
  } else if (mutex.owner === null) {
    mutex.owner = txId;
    mutex.depth = 1;
  } else {
    await new Promise<void>((resolve) => {
      mutex.waiters.push(() => {
        mutex.owner = txId;
        mutex.depth = 1;
        resolve();
      });
    });
  }
  releases.push(() => {
    if (mutex.owner !== txId) {
      return;
    }
    mutex.depth -= 1;
    if (mutex.depth > 0) {
      return;
    }
    mutex.owner = null;
    const next = mutex.waiters.shift();
    if (next) {
      next();
    }
  });
}










