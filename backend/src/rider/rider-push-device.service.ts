import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import type { RiderContext } from '../auth/rider-access.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const TOKEN_MAX_LENGTH = 512;

export function readPushToken(value: unknown): string {
  if (typeof value !== 'string') {
    throw new BadRequestException('FCM token is required');
  }
  const token = value.trim();
  if (token.length < 1 || token.length > TOKEN_MAX_LENGTH) {
    throw new BadRequestException('FCM token is required');
  }
  return token;
}

@Injectable()
export class RiderPushDeviceService {
  constructor(private readonly prisma: PrismaService) {}

  async register(rider: RiderContext, fcmToken: unknown): Promise<{ registered: true }> {
    const token = readPushToken(fcmToken);
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO rider_push_devices (id, rider_profile_id, fcm_token, created_at, updated_at)
       VALUES ($1::uuid, $2::uuid, $3, now(), now())
       ON CONFLICT (fcm_token) DO UPDATE
       SET rider_profile_id = EXCLUDED.rider_profile_id,
           invalidated_at = NULL,
           updated_at = now()`,
      randomUUID(),
      rider.riderProfileId,
      token,
    );
    return { registered: true };
  }

  async remove(rider: RiderContext, fcmToken: unknown): Promise<void> {
    const token = readPushToken(fcmToken);
    await this.prisma.$executeRawUnsafe(
      `DELETE FROM rider_push_devices
       WHERE fcm_token = $1
         AND rider_profile_id = $2::uuid`,
      token,
      rider.riderProfileId,
    );
  }
}
