import { Controller, ForbiddenException, Get, Query, Req, UseGuards } from '@nestjs/common';
import { RiderAccessGuard, type RiderRequest } from '../auth/rider-access.guard.js';
import type { RiderContext } from '../auth/rider-access.service.js';
import { WalletService } from './wallet.service.js';

@Controller('riders/me/wallet')
@UseGuards(RiderAccessGuard)
export class RiderWalletController {
  constructor(private readonly wallets: WalletService) {}

  @Get()
  summary(@Req() request: RiderRequest) {
    return this.wallets.summary(requiredRider(request).riderProfileId);
  }

  @Get('transactions')
  transactions(@Req() request: RiderRequest, @Query() query: unknown) {
    return this.wallets.transactions(requiredRider(request).riderProfileId, query);
  }
}

function requiredRider(request: RiderRequest): RiderContext {
  if (!request.rider) {
    throw new ForbiddenException('Rider access is required');
  }
  return request.rider;
}
