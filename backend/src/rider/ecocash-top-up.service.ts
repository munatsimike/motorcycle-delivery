import { Injectable } from '@nestjs/common';
import type { RiderContext } from '../auth/rider-access.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { EcocashPaymentProvider } from './ecocash-client.js';
import { ecocashAutoCreditEnabled } from './ecocash-config.js';
import { initiateEcocashTopUp, lookupEcocashTopUp, type EcocashTopUpView, type PrismaClientLike } from './ecocash-top-up.js';

@Injectable()
export class EcocashTopUpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ecocash: EcocashPaymentProvider,
  ) {}

  initiate(rider: RiderContext, body: unknown, idempotencyKey: string, now = new Date()): Promise<EcocashTopUpView> {
    return initiateEcocashTopUp(this.prisma as unknown as PrismaClientLike, this.ecocash, rider, body, idempotencyKey, now);
  }

  lookup(rider: RiderContext, paymentId: string, now = new Date()): Promise<EcocashTopUpView> {
    return lookupEcocashTopUp(this.prisma as unknown as PrismaClientLike, this.ecocash, rider, paymentId, now, {
      credit: ecocashAutoCreditEnabled(),
    });
  }
}
