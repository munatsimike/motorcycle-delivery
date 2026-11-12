import { BadRequestException, Body, Controller, ForbiddenException, HttpCode, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiForbiddenResponse, ApiHeader, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { RiderAccessGuard, type RiderRequest } from '../auth/rider-access.guard.js';
import type { RiderContext } from '../auth/rider-access.service.js';
import { EcocashTopUpBody } from '../openapi/schemas.js';
import { EcocashTopUpService } from './ecocash-top-up.service.js';

@ApiTags('Rider wallet')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Authentication failed' })
@ApiForbiddenResponse({ description: 'Rider access is required' })
@Controller('riders/me/wallet')
@UseGuards(RiderAccessGuard)
export class EcocashTopUpController {
  constructor(private readonly topUps: EcocashTopUpService) {}

  @Post('ecocash-top-ups')
  @HttpCode(200)
  @ApiOperation({ summary: 'Start a sandbox EcoCash wallet top-up' })
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'Stable key for this top-up. Reuse it if the response is lost.' })
  @ApiBody({ type: EcocashTopUpBody })
  @ApiOkResponse({ description: 'The pending EcoCash payment. A verified provider status does not credit the wallet in this phase.' })
  initiate(@Req() request: RiderRequest, @Body() body: unknown) {
    return this.topUps.initiate(requiredRider(request), body, readIdempotencyKey(request));
  }

  @Post('ecocash-top-ups/:paymentId/lookup')
  @HttpCode(200)
  @ApiOperation({ summary: 'Look up a sandbox EcoCash top-up' })
  @ApiOkResponse({ description: 'The provider status. This does not credit the wallet.' })
  lookup(
    @Req() request: RiderRequest,
    @Param('paymentId', new ParseUUIDPipe({ version: '7' })) paymentId: string,
  ) {
    return this.topUps.lookup(requiredRider(request), paymentId);
  }
}

function requiredRider(request: RiderRequest): RiderContext {
  if (!request.rider) {
    throw new ForbiddenException('Rider access is required');
  }
  return request.rider;
}

function readIdempotencyKey(request: RiderRequest): string {
  const headers = request.headers as { ['idempotency-key']?: string | string[] } | undefined;
  const header = headers?.['idempotency-key'];
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== 'string' || !value.trim()) {
    throw new BadRequestException('Enter an idempotency key');
  }
  return value.trim();
}
