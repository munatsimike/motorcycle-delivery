import { BadRequestException, Controller, ForbiddenException, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiHeader, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { CustomerAccessGuard, type CustomerRequest } from '../auth/customer-access.guard.js';
import type { CustomerContext } from '../auth/customer-access.service.js';
import { BidAcceptanceService } from './bid-acceptance.service.js';
import { BidService } from './bid.service.js';

type BidRequest = CustomerRequest & {
  headers?: CustomerRequest['headers'] & { 'idempotency-key'?: string | string[] };
};

@ApiTags('Customer deliveries')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Authentication failed' })
@ApiForbiddenResponse({ description: 'Customer access is required' })
@Controller('customers/me/deliveries')
@UseGuards(CustomerAccessGuard)
export class CustomerBidController {
  constructor(
    private readonly bids: BidService,
    private readonly acceptance: BidAcceptanceService,
  ) {}

  @Get(':deliveryId/bids')
  @ApiOperation({ summary: 'List open bids for the signed-in customer delivery' })
  @ApiParam({ name: 'deliveryId', format: 'uuid' })
  @ApiOkResponse({ description: 'Open bids with amount and rider name.' })
  @ApiNotFoundResponse({ description: 'Delivery not found' })
  list(@Req() request: CustomerRequest, @Param('deliveryId') deliveryId: string) {
    return this.bids.listForCustomer(requiredCustomer(request), deliveryId);
  }

  @Post(':deliveryId/bids/:bidId/acceptance')
  @HttpCode(200)
  @ApiOperation({ summary: 'Accept one open bid and reserve its commission' })
  @ApiParam({ name: 'deliveryId', format: 'uuid' })
  @ApiParam({ name: 'bidId', format: 'uuid' })
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'Stable key for this acceptance. Reuse it if the response is lost.' })
  @ApiOkResponse({ description: 'The accepted assignment. A repeated key returns the same result.' })
  @ApiNotFoundResponse({ description: 'Bid not found' })
  accept(
    @Req() request: BidRequest,
    @Param('deliveryId') deliveryId: string,
    @Param('bidId') bidId: string,
  ) {
    return this.acceptance.accept(requiredCustomer(request), deliveryId, bidId, readIdempotencyKey(request));
  }
}

function readIdempotencyKey(request: BidRequest): string {
  const header = request.headers?.['idempotency-key'];
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== 'string' || !value.trim()) {
    throw new BadRequestException('Enter an idempotency key');
  }
  return value.trim();
}

function requiredCustomer(request: CustomerRequest): CustomerContext {
  if (!request.customer) {
    throw new ForbiddenException('Customer access is required');
  }
  return request.customer;
}
