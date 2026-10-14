import { Body, Controller, ForbiddenException, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { CustomerAccessGuard, type CustomerRequest } from '../auth/customer-access.guard.js';
import { DeliveryService } from './delivery.service.js';

@Controller('customers/me/deliveries')
@UseGuards(CustomerAccessGuard)
export class DeliveryController {
  constructor(private readonly deliveries: DeliveryService) {}

  @Post('quote')
  @HttpCode(200)
  quote(@Req() request: CustomerRequest, @Body() body: unknown) {
    requiredCustomer(request);
    return this.deliveries.quote(body);
  }

  @Post()
  create(@Req() request: CustomerRequest, @Body() body: unknown) {
    return this.deliveries.create(requiredCustomer(request), body);
  }
}

function requiredCustomer(request: CustomerRequest) {
  if (!request.customer) {
    throw new ForbiddenException('Customer access is required');
  }
  return request.customer;
}
