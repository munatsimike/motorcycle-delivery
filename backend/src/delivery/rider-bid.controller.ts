import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConflictResponse, ApiForbiddenResponse, ApiHeader, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { RiderAccessGuard, type RiderRequest } from '../auth/rider-access.guard.js';
import type { RiderContext } from '../auth/rider-access.service.js';
import { BidSubmissionBody } from '../openapi/schemas.js';
import { BidService } from './bid.service.js';

type BidRequest = RiderRequest & {
  headers?: RiderRequest['headers'] & { 'idempotency-key'?: string | string[] };
};

@ApiTags('Rider bids')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Authentication failed' })
@ApiForbiddenResponse({ description: 'Rider access is required' })
@Controller('riders/me')
@UseGuards(RiderAccessGuard)
export class RiderBidController {
  constructor(private readonly bids: BidService) {}

  @Get('bid-requests')
  @ApiOperation({ summary: 'List V2 deliveries that are still open for bids' })
  @ApiOkResponse({ description: 'Pickup, drop-off, parcel, suggested price, and deadline. Contact phones are omitted.' })
  listRequests(@Req() request: BidRequest) {
    requiredRider(request);
    return this.bids.listOpenRequests();
  }

  @Get('bids')
  @ApiOperation({ summary: 'List bids owned by the signed-in rider' })
  @ApiOkResponse({ description: 'The rider own bids, newest first, with the request class, addresses, and deadline.' })
  list(
    @Req() request: BidRequest,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.bids.listOwn(requiredRider(request), { limit, cursor });
  }

  @Post('bids')
  @HttpCode(200)
  @ApiOperation({ summary: 'Submit one open bid for a V2 delivery' })
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'Stable key for this bid. Reuse it if the response is lost.' })
  @ApiBody({ type: BidSubmissionBody })
  @ApiOkResponse({ description: 'The open bid. A repeated key returns the same bid.' })
  @ApiConflictResponse({ description: 'The rider cannot bid on this delivery' })
  submit(@Req() request: BidRequest, @Body() body: unknown) {
    return this.bids.submit(requiredRider(request), body, readIdempotencyKey(request));
  }

  @Post('bids/:bidId/withdrawal')
  @HttpCode(200)
  @ApiOperation({ summary: 'Withdraw the signed-in rider open bid' })
  @ApiParam({ name: 'bidId', format: 'uuid' })
  @ApiOkResponse({ description: 'The bid is withdrawn and the row is kept.' })
  @ApiNotFoundResponse({ description: 'Bid not found' })
  withdraw(@Req() request: BidRequest, @Param('bidId') bidId: string) {
    return this.bids.withdraw(requiredRider(request), bidId);
  }
}

function requiredRider(request: BidRequest): RiderContext {
  if (!request.rider) {
    throw new ForbiddenException('Rider access is required');
  }
  return request.rider;
}

function readIdempotencyKey(request: BidRequest): string {
  const header = request.headers?.['idempotency-key'];
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== 'string' || !value.trim()) {
    throw new BadRequestException('Enter an idempotency key');
  }
  return value.trim();
}
