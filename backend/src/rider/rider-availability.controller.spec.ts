import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { RiderAvailability } from '../generated/prisma/client.js';
import { RiderAvailabilityController } from './rider-availability.controller.js';
import { AVAILABILITY_NO_LONGER_ELIGIBLE_MESSAGE, AVAILABILITY_NO_LONGER_ELIGIBLE_REASON } from './rider-availability.service.js';

describe('rider availability controller', () => {
  const rider = { userId: 'user-1', riderProfileId: 'profile-1' };
  const controller = new RiderAvailabilityController({
    async online() {
      return {
        availability: RiderAvailability.OFFLINE,
        eligible: false,
        reason: AVAILABILITY_NO_LONGER_ELIGIBLE_REASON,
        message: AVAILABILITY_NO_LONGER_ELIGIBLE_MESSAGE,
      };
    },
    async offline(caller: { userId: string }) {
      return { availability: RiderAvailability.OFFLINE, caller };
    },
  } as never);

  it('requires the authenticated rider', () => {
    expect(() => controller.online({})).toThrow(ForbiddenException);
    expect(() => controller.offline({})).toThrow(ForbiddenException);
  });

  it('returns availability without reviewer or storage details', async () => {
    const online = await controller.online({ rider });
    const offline = await controller.offline({ rider });
    const json = JSON.stringify({ online, offline });
    expect(online).toMatchObject({
      availability: RiderAvailability.OFFLINE,
      eligible: false,
      reason: 'no_longer_eligible',
    });
    expect(json).not.toContain('reviewerId');
    expect(json).not.toContain('objectKey');
    expect(json).not.toContain('phone');
    expect(json).not.toContain('bucket');
  });
});