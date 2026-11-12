import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { RiderAvailability } from '../generated/prisma/client.js';
import { RiderReceivingController } from './rider-receiving.controller.js';

describe('rider receiving controller', () => {
  const rider = { userId: 'user-1', riderProfileId: 'profile-1' };

  it('requires the authenticated rider', () => {
    const controller = new RiderReceivingController({
      async setReceiving() {
        return { availability: RiderAvailability.AVAILABLE, receiving: false };
      },
    } as never);
    expect(() => controller.receiving({}, { receiving: false })).toThrow(ForbiddenException);
  });

  it('passes the body to the availability service', async () => {
    const calls: unknown[] = [];
    const controller = new RiderReceivingController({
      async setReceiving(_rider: unknown, body: unknown) {
        calls.push(body);
        return { availability: RiderAvailability.AVAILABLE, receiving: false };
      },
    } as never);
    await expect(controller.receiving({ rider }, { receiving: false })).resolves.toEqual({
      availability: RiderAvailability.AVAILABLE,
      receiving: false,
    });
    expect(calls).toEqual([{ receiving: false }]);
  });

  it('leaves the endpoint unavailable when the service rejects the flag', async () => {
    const controller = new RiderReceivingController({
      async setReceiving() {
        throw new NotFoundException('Bidding is not available');
      },
    } as never);
    await expect(controller.receiving({ rider }, { receiving: true })).rejects.toBeInstanceOf(NotFoundException);
  });
});
