import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { readPushToken, RiderPushDeviceService } from './rider-push-device.service.js';

const rider = { userId: 'user-1', riderProfileId: '11111111-1111-4111-8111-111111111111' };

describe('rider push devices', () => {
  it('rejects a missing or oversized token', () => {
    expect(() => readPushToken('   ')).toThrow(BadRequestException);
    expect(() => readPushToken(12)).toThrow(BadRequestException);
    expect(() => readPushToken('x'.repeat(513))).toThrow(BadRequestException);
    expect(readPushToken('  device-token  ')).toBe('device-token');
  });

  it('moves token ownership in one statement and deletes only the signed-in rider', async () => {
    const calls: unknown[][] = [];
    const prisma = {
      async $executeRawUnsafe(...args: unknown[]) {
        calls.push(args);
        return 1;
      },
    };
    const service = new RiderPushDeviceService(prisma as never);
    await expect(service.register(rider, '  device-token  ')).resolves.toEqual({ registered: true });
    await service.remove(rider, 'device-token');

    const insert = String(calls[0]?.[0]);
    expect(insert).toContain('ON CONFLICT (fcm_token) DO UPDATE');
    expect(insert).toContain('rider_profile_id = EXCLUDED.rider_profile_id');
    expect(insert).toContain('invalidated_at = NULL');
    expect(insert).not.toContain('device-token');
    expect(insert).not.toContain(rider.riderProfileId);
    expect(calls[0]?.[2]).toBe(rider.riderProfileId);
    expect(calls[0]?.[3]).toBe('device-token');

    const wake = calls.map((call) => String(call[0])).find((sql) => sql.includes('RIDER_OPPORTUNITY'));
    expect(wake).toContain('next_attempt_at');
    const removeCall = calls.find((call) => String(call[0]).includes('DELETE FROM rider_push_devices'));
    const remove = String(removeCall?.[0]);
    expect(remove).toContain('rider_profile_id = $2::uuid');
    expect(remove).not.toContain('device-token');
    expect(removeCall?.[1]).toBe('device-token');
    expect(removeCall?.[2]).toBe(rider.riderProfileId);
  });
});
