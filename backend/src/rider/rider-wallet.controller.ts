import { Controller, ForbiddenException, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiQuery, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { RiderAccessGuard, type RiderRequest } from '../auth/rider-access.guard.js';
import type { RiderContext } from '../auth/rider-access.service.js';
import { WalletService } from './wallet.service.js';

@ApiTags('Rider wallet')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Authentication failed' })
@ApiForbiddenResponse({ description: 'Rider access is required' })
@Controller('riders/me/wallet')
@UseGuards(RiderAccessGuard)
export class RiderWalletController {
  constructor(private readonly wallets: WalletService) {}

  @Get()
  @ApiOperation({ summary: 'Read the rider wallet summary' })
  @ApiOkResponse({ description: 'Balance, borrowing limit, and welcome-bonus state.' })
  summary(@Req() request: RiderRequest) {
    return this.wallets.summary(requiredRider(request).riderProfileId);
  }

  @Get('transactions')
  @ApiOperation({ summary: 'List rider wallet transactions' })
  @ApiQuery({ name: 'limit', required: false, schema: { type: 'integer', minimum: 1 } })
  @ApiQuery({ name: 'cursor', required: false, schema: { type: 'string' }, description: 'Opaque cursor from the previous page.' })
  @ApiOkResponse({ description: 'A page of wallet transactions and the next cursor.' })
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
