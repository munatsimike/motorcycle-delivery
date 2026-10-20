import { Body, Controller, Delete, ForbiddenException, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { CustomerAccessGuard, type CustomerRequest } from '../auth/customer-access.guard.js';
import { RiderAvailabilityAlertBody } from '../openapi/schemas.js';
import { RiderAvailabilityAlertService } from './rider-availability-alert.service.js';

@ApiTags('Customer deliveries')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Authentication failed' })
@ApiForbiddenResponse({ description: 'Customer access is required' })
@Controller('customers/me/rider-availability-alert')
@UseGuards(CustomerAccessGuard)
export class RiderAvailabilityAlertController {
  constructor(private readonly alerts: RiderAvailabilityAlertService) {}

  @Get()
  @ApiOperation({ summary: 'Read the customer rider-availability alert' })
  @ApiOkResponse({ description: 'The current alert, or an empty result when none is active.' })
  current(@Req() request: CustomerRequest) {
    return this.alerts.current(customerAccountId(request));
  }

  @Post()
  @ApiOperation({ summary: 'Subscribe to a rider-availability alert' })
  @ApiBody({ type: RiderAvailabilityAlertBody })
  @ApiOkResponse({ description: 'The saved alert.' })
  create(@Req() request: CustomerRequest, @Body() body: unknown) {
    return this.alerts.subscribe(customerAccountId(request), body);
  }

  @Delete()
  @ApiOperation({ summary: 'Cancel the rider-availability alert' })
  @ApiOkResponse({ description: 'The alert was cancelled.' })
  remove(@Req() request: CustomerRequest) {
    return this.alerts.cancel(customerAccountId(request));
  }
}

function customerAccountId(request: CustomerRequest): string {
  if (!request.customer) {
    throw new ForbiddenException('Customer access is required');
  }
  return request.customer.customerAccountId;
}
