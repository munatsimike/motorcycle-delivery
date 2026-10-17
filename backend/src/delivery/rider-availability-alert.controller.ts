import { Body, Controller, Delete, ForbiddenException, Get, Post, Req, UseGuards } from '@nestjs/common';
import { CustomerAccessGuard, type CustomerRequest } from '../auth/customer-access.guard.js';
import { RiderAvailabilityAlertService } from './rider-availability-alert.service.js';

@Controller('customers/me/rider-availability-alert')
@UseGuards(CustomerAccessGuard)
export class RiderAvailabilityAlertController {
  constructor(private readonly alerts: RiderAvailabilityAlertService) {}

  @Get()
  current(@Req() request: CustomerRequest) {
    return this.alerts.current(customerAccountId(request));
  }

  @Post()
  create(@Req() request: CustomerRequest, @Body() body: unknown) {
    return this.alerts.subscribe(customerAccountId(request), body);
  }

  @Delete()
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
